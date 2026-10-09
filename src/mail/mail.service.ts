import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress =
      this.configService.get<string>('SMTP_FROM') ||
      'NutriWise <no-reply@nutriwise.app>';

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: Number(this.configService.get<string>('SMTP_PORT') || 587),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  /**
   * Gửi email chứa mã OTP xác thực tài khoản.
   * Nếu SMTP chưa được cấu hình (thiếu SMTP_HOST), chỉ log mã ra console để không chặn luồng dev.
   */
  async sendVerificationCode(toEmail: string, code: string): Promise<void> {
    if (!this.configService.get<string>('SMTP_HOST')) {
      this.logger.warn(
        `SMTP chưa được cấu hình — mã xác thực cho ${toEmail} là: ${code} (chỉ hiển thị ở log, không gửi email thật)`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: 'Mã xác thực email NutriWise',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Xác thực địa chỉ email</h2>
          <p>Mã xác thực của bạn là:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${code}</p>
          <p>Mã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.</p>
        </div>
      `,
    });
  }

  /**
   * Gửi email chứa mã OTP đặt lại mật khẩu.
   * Nếu SMTP chưa được cấu hình (thiếu SMTP_HOST), chỉ log mã ra console để không chặn luồng dev.
   */
  async sendPasswordResetCode(toEmail: string, code: string): Promise<void> {
    if (!this.configService.get<string>('SMTP_HOST')) {
      this.logger.warn(
        `SMTP chưa được cấu hình — mã đặt lại mật khẩu cho ${toEmail} là: ${code} (chỉ hiển thị ở log, không gửi email thật)`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: 'Mã đặt lại mật khẩu NutriWise',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Đặt lại mật khẩu</h2>
          <p>Mã đặt lại mật khẩu của bạn là:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${code}</p>
          <p>Mã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
        </div>
      `,
    });
  }

  /**
   * Báo cho chủ email biết tài khoản chưa xác thực đã được liên kết Google và mật khẩu cũ đã bị vô hiệu
   * (BR-01.2). Nếu SMTP chưa cấu hình thì chỉ ghi log.
   */
  async sendGoogleLinkedNotice(toEmail: string): Promise<void> {
    if (!this.configService.get<string>('SMTP_HOST')) {
      this.logger.warn(
        `SMTP chưa được cấu hình — không gửi email báo liên kết Google tới ${toEmail}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: 'Tài khoản NutriWise đã được liên kết với Google',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Tài khoản đã được liên kết với Google</h2>
          <p>Tài khoản NutriWise dùng email này vừa được liên kết với đăng nhập Google. Vì email chưa từng được xác thực, mật khẩu cũ đã bị vô hiệu và mọi phiên đăng nhập trước đó đã bị đăng xuất.</p>
          <p>Nếu bạn muốn dùng mật khẩu, hãy chọn "Quên mật khẩu" để đặt lại. Nếu bạn không thực hiện việc này, vui lòng liên hệ hỗ trợ.</p>
        </div>
      `,
    });
  }
}
