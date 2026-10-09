import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SubStatus } from '@prisma/client';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

/** Trạng thái subscription đã chuẩn hoá từ Google Play Developer API. */
export interface PlaySubscription {
  productId: string;
  orderId?: string;
  purchaseTime: Date;
  expiryTime: Date;
  status: SubStatus;
  autoRenewing: boolean;
  isTrial: boolean;
  acknowledged: boolean;
  obfuscatedAccountId?: string;
  linkedPurchaseToken?: string;
  raw: unknown;
}

/** Token không tồn tại / bị giả (Google trả 400/404/410). */
export class InvalidPurchaseTokenError extends Error {}

/**
 * Lớp bọc Google Play. Tách thành lớp trừu tượng để test dùng bản giả và để không bao giờ cấp quyền
 * khi chưa xác minh được với Google (BR-16.5).
 */
export abstract class GooglePlayClient {
  abstract getSubscription(purchaseToken: string): Promise<PlaySubscription>;
  abstract acknowledge(productId: string, purchaseToken: string): Promise<void>;
  /** Xác thực JWT của Pub/Sub push; ném UnauthorizedException nếu sai. */
  abstract verifyPushAuth(authorizationHeader?: string): Promise<void>;
}

const STATE_MAP: Record<string, SubStatus> = {
  SUBSCRIPTION_STATE_PENDING: SubStatus.PENDING,
  SUBSCRIPTION_STATE_ACTIVE: SubStatus.ACTIVE,
  SUBSCRIPTION_STATE_CANCELED: SubStatus.CANCELED,
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: SubStatus.IN_GRACE_PERIOD,
  SUBSCRIPTION_STATE_ON_HOLD: SubStatus.ON_HOLD,
  SUBSCRIPTION_STATE_PAUSED: SubStatus.PAUSED,
  SUBSCRIPTION_STATE_EXPIRED: SubStatus.EXPIRED,
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: SubStatus.EXPIRED,
};

/** Chuyển phản hồi `purchases.subscriptionsv2.get` sang PlaySubscription. Hàm thuần để dễ test. */
export function parseSubscriptionV2(body: any): PlaySubscription {
  const line = body?.lineItems?.[0];
  const status = STATE_MAP[body?.subscriptionState];
  if (!line || !status || !line.productId) {
    throw new InvalidPurchaseTokenError('Phản hồi Google không hợp lệ');
  }
  return {
    productId: line.productId,
    orderId: body.latestOrderId,
    purchaseTime: new Date(body.startTime ?? Date.now()),
    expiryTime: new Date(line.expiryTime),
    status,
    autoRenewing: line.autoRenewingPlan?.autoRenewEnabled === true,
    // ⚠️ Cần xác minh trên bản thử thật: pha dùng thử nằm ở offerPhase.freeTrial
    isTrial: !!line.offerDetails?.offerTags?.includes?.('trial') || !!line.offerPhase?.freeTrial,
    acknowledged: body.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    obfuscatedAccountId: body.externalAccountIdentifiers?.obfuscatedExternalAccountId,
    linkedPurchaseToken: body.linkedPurchaseToken,
    raw: body,
  };
}

@Injectable()
export class HttpGooglePlayClient extends GooglePlayClient {
  private readonly logger = new Logger(HttpGooglePlayClient.name);
  private auth?: GoogleAuth;

  private get packageName(): string {
    const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    if (!pkg) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Chưa cấu hình GOOGLE_PLAY_PACKAGE_NAME',
      });
    }
    return pkg;
  }

  private async token(): Promise<string> {
    const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Chưa cấu hình GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      });
    }
    if (!this.auth) {
      const credentials = JSON.parse(raw.trim().startsWith('{') ? raw : require('fs').readFileSync(raw, 'utf-8'));
      this.auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });
    }
    const t = await this.auth.getAccessToken();
    if (!t) throw new ServiceUnavailableException({ code: 'BILLING_UNAVAILABLE' });
    return t;
  }

  async getSubscription(purchaseToken: string): Promise<PlaySubscription> {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.token()}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.logger.warn(`Google Play lỗi mạng: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ code: 'BILLING_UNAVAILABLE' });
    }
    if (res.status === 400 || res.status === 404 || res.status === 410) {
      throw new InvalidPurchaseTokenError(`Google trả ${res.status}`);
    }
    if (!res.ok) {
      this.logger.warn(`Google Play trả ${res.status}`);
      throw new ServiceUnavailableException({ code: 'BILLING_UNAVAILABLE' });
    }
    return parseSubscriptionV2(await res.json());
  }

  async acknowledge(productId: string, purchaseToken: string): Promise<void> {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.packageName}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`acknowledge thất bại: ${res.status}`);
  }

  async verifyPushAuth(authorizationHeader?: string): Promise<void> {
    const idToken = authorizationHeader?.replace(/^Bearer\s+/i, '');
    const audience = process.env.PUBSUB_PUSH_AUDIENCE;
    const expectedEmail = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT;
    if (!idToken || !audience || !expectedEmail) throw new UnauthorizedException();
    try {
      const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.email_verified || payload.email !== expectedEmail) throw new Error('sai tài khoản');
    } catch {
      throw new UnauthorizedException();
    }
  }
}
