import { AiService } from './ai.service';
import { detectRiskTopic, detectRestrictedTopic, evaluateChatSafety, safetyAudience, safetyPromptBlock } from './chat-safety';

const NOW = new Date('2026-10-12T03:00:00Z');
const adult = { dateOfBirth: '1996-04-12', pregnancyStatus: 'NONE' };

describe('Phát hiện chủ đề rủi ro (BR-11.6)', () => {
  it.each([
    ['Mình nhịn ăn hoàn toàn 3 ngày để giảm cân nhanh được không', 'EXTREME_FASTING'],
    ['nhịn ăn liên tục cả tuần có sao không', 'EXTREME_FASTING'],
    ['Có nên uống detox nhịn ăn không?', 'EXTREME_FASTING'],
    ['Sau khi ăn xong mình nôn ra để không tăng cân', 'PURGING'],
    ['Cách ép nôn sau bữa tối', 'PURGING'],
    ['uống thuốc xổ giảm cân có hiệu quả không', 'PURGING'],
    ['Cho mình hỏi về thuốc giảm cân an toàn', 'WEIGHT_LOSS_DRUGS'],
    ['tiêm giảm cân Ozempic giá bao nhiêu', 'WEIGHT_LOSS_DRUGS'],
    ['mình muốn ăn 800 calo mỗi ngày', 'BELOW_CALORIE_FLOOR'],
    ['Chỉ ăn 600 kcal thôi được không', 'BELOW_CALORIE_FLOOR'],
    ['làm sao giảm 5kg trong 1 tuần', 'EXTREME_WEIGHT_LOSS'],
    ['giảm 4 kg trong 3 ngày', 'EXTREME_WEIGHT_LOSS'],
  ])('"%s" → %s', (message, flag) => {
    expect(detectRiskTopic(message)).toBe(flag);
  });

  it.each([
    'Nhịn ăn gián đoạn 16:8 có tốt không?',
    'Tối nay mình nên ăn gì để đủ đạm?',
    'Mình muốn ăn 1800 calo mỗi ngày để giữ cân',
    'Giảm 2kg trong 1 tháng có hợp lý không',
    'Giảm 1 kg trong 1 tuần có được không',
    'Phở bò bao nhiêu calo',
    'Mình ăn xong thấy buồn nôn là sao?',
    'Uống nước ép táo có tốt không',
    'Ăn trứng luộc mỗi sáng có sao không',
    '',
  ])('câu hỏi bình thường "%s" không bị chặn', (message) => {
    expect(detectRiskTopic(message)).toBeNull();
  });

  it('gõ không dấu hay viết hoa vẫn bắt được', () => {
    expect(detectRiskTopic('NHIN AN HOAN TOAN 2 NGAY')).toBe('EXTREME_FASTING');
    expect(detectRiskTopic('an xong non ra')).toBe('PURGING');
  });
});

describe('Đối tượng cần bảo vệ', () => {
  it('dưới 18 tuổi → MINOR; đúng 18 tuổi → GENERAL', () => {
    expect(safetyAudience({ dateOfBirth: '2011-06-01' }, NOW)).toBe('MINOR'); // 15 tuổi
    expect(safetyAudience({ dateOfBirth: '2008-10-13' }, NOW)).toBe('MINOR'); // 17 tuổi, sinh nhật ngày mai
    expect(safetyAudience({ dateOfBirth: '2008-10-12' }, NOW)).toBe('GENERAL'); // vừa tròn 18
    expect(safetyAudience(adult, NOW)).toBe('GENERAL');
  });

  it('mang thai hoặc cho con bú → PREGNANT (ưu tiên hơn tuổi)', () => {
    expect(safetyAudience({ ...adult, pregnancyStatus: 'PREGNANT' }, NOW)).toBe('PREGNANT');
    expect(safetyAudience({ ...adult, pregnancyStatus: 'LACTATING' }, NOW)).toBe('PREGNANT');
  });

  it('thiếu hoặc sai ngày sinh không làm lỗi', () => {
    expect(safetyAudience({}, NOW)).toBe('GENERAL');
    expect(safetyAudience({ dateOfBirth: 'không phải ngày' }, NOW)).toBe('GENERAL');
  });
});

describe('Quyết định chặn', () => {
  it('chủ đề rủi ro: chặn mọi đối tượng, trả văn bản khuyên gặp chuyên gia và nêu số cấp cứu', () => {
    const d = evaluateChatSafety('nhịn ăn hoàn toàn 3 ngày', adult, NOW);
    expect(d.blocked).toBe(true);
    expect(d.flag).toBe('EXTREME_FASTING');
    expect(d.reply).toMatch(/bác sĩ|chuyên gia dinh dưỡng/);
    expect(d.reply).toMatch(/115/);
  });

  it('người 15 tuổi hỏi giảm cân → chặn, khuyên hỏi bố mẹ và bác sĩ', () => {
    const d = evaluateChatSafety('Làm sao để giảm cân nhanh', { dateOfBirth: '2011-06-01' }, NOW);
    expect(d).toMatchObject({ blocked: true, flag: 'MINOR_RESTRICTED' });
    expect(d.reply).toMatch(/bố mẹ|người giám hộ/);
  });

  it('người đang mang thai hỏi ăn kiêng → chặn, khuyên hỏi bác sĩ sản khoa', () => {
    const d = evaluateChatSafety('Mình muốn ăn kiêng', { ...adult, pregnancyStatus: 'PREGNANT' }, NOW);
    expect(d).toMatchObject({ blocked: true, flag: 'PREGNANCY_RESTRICTED' });
    expect(d.reply).toMatch(/bác sĩ sản khoa/);
  });

  it('người lớn hỏi giảm cân bình thường → không chặn', () => {
    expect(evaluateChatSafety('Làm sao để giảm cân lành mạnh', adult, NOW).blocked).toBe(false);
  });

  it('người 15 tuổi hỏi ăn uống thông thường → không chặn nhưng AI nhận chỉ dẫn an toàn', () => {
    const minor = { dateOfBirth: '2011-06-01' };
    expect(evaluateChatSafety('Bữa sáng nên ăn gì để có sức học bài', minor, NOW).blocked).toBe(false);
    const block = safetyPromptBlock(safetyAudience(minor, NOW));
    expect(block).toMatch(/dưới 18 tuổi/);
    expect(block).toMatch(/KHÔNG khuyên giảm cân/);
    expect(safetyPromptBlock('GENERAL')).toBe('');
    expect(safetyPromptBlock('PREGNANT')).toMatch(/mang thai/);
  });

  it('chủ đề nhạy cảm của nhóm cần bảo vệ', () => {
    for (const m of ['uống whey được không', 'ăn ít calo để giảm mỡ', 'có nên dùng vitamin viên uống', 'thực phẩm chức năng giảm cân']) {
      expect(detectRestrictedTopic(m)).toBe(true);
    }
    expect(detectRestrictedTopic('cơm gà hôm nay ăn gì')).toBe(false);
  });
});

describe('AI Chat: chế độ an toàn không gọi AI và không tính lượt', () => {
  function build(user: any) {
    const row: Record<string, number> = { chatMessages: 0, chatTokens: 0, aiPhoto: 0, menuScans: 0, suggestMeals: 0, barcodeLookups: 0 };
    const saved: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', purchasedChatQuota: 0, name: 'T', ...user })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      usageCounter: {
        upsert: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }: any) => {
          for (const [k, v] of Object.entries<any>(data)) row[k] += v.increment;
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const col = Object.keys(data)[0];
          const cond = where[col];
          if (cond?.lt !== undefined && !(row[col] < cond.lt)) return { count: 0 };
          row[col] += data[col].increment ?? -data[col].decrement;
          return { count: 1 };
        }),
      },
      subscriptionState: { findUnique: jest.fn(async () => null) },
      manualGrant: { findFirst: jest.fn(async () => null) },
      apiUsageLog: { create: jest.fn(async () => ({})) },
      meal: { findMany: jest.fn(async () => []) },
      aiMessage: {
        deleteMany: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
        createMany: jest.fn(async ({ data }: any) => saved.push(...data)),
      },
    };
    const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
    const generateContent = jest.fn(async () => ({ response: { text: () => 'Trả lời của AI' } }));
    svc.genAI = { getGenerativeModel: () => ({ generateContent }) };
    return { svc, row, saved, generateContent };
  }

  it('chủ đề rủi ro: không gọi AI, không trừ lượt, lưu tin nhắn kèm safetyFlag', async () => {
    const { svc, row, saved, generateContent } = build({ dateOfBirth: new Date('1996-04-12'), pregnancyStatus: 'NONE', targetCalories: 2000 });
    const res = await svc.chat('u1', 'Mình nhịn ăn hoàn toàn 3 ngày được không');
    expect(generateContent).not.toHaveBeenCalled();
    expect(res.safetyFlag).toBe('EXTREME_FASTING');
    expect(res.reply).toMatch(/bác sĩ/);
    expect(row.chatMessages).toBe(0);
    expect(row.chatTokens).toBe(0);
    expect(saved.map((m) => m.safetyFlag)).toEqual(['EXTREME_FASTING', 'EXTREME_FASTING']);
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('người 15 tuổi hỏi giảm cân: không gọi AI; hỏi ăn uống thường thì gọi AI kèm chỉ dẫn an toàn', async () => {
    const minor = { dateOfBirth: new Date('2011-06-01'), pregnancyStatus: 'NONE', targetCalories: 2000 };
    const a = build(minor);
    const blocked = await a.svc.chat('u1', 'Làm sao giảm cân nhanh');
    expect(a.generateContent).not.toHaveBeenCalled();
    expect(blocked.safetyFlag).toBe('MINOR_RESTRICTED');

    const b = build(minor);
    const ok = await b.svc.chat('u1', 'Bữa sáng nên ăn gì');
    expect(b.generateContent).toHaveBeenCalledTimes(1);
    expect(ok.safetyFlag).toBeUndefined();
    const prompt = String((b.generateContent.mock.calls[0] as any[])[0]);
    expect(prompt).toMatch(/CHẾ ĐỘ AN TOÀN/);
    expect(b.row.chatMessages).toBe(1); // tin nhắn thường vẫn tính lượt
  });

  it('người lớn hỏi bình thường: không có chỉ dẫn an toàn trong prompt', async () => {
    const { svc, generateContent } = build({ dateOfBirth: new Date('1996-04-12'), pregnancyStatus: 'NONE', targetCalories: 2000 });
    await svc.chat('u1', 'Tối nay ăn gì');
    expect(String((generateContent.mock.calls[0] as any[])[0])).not.toMatch(/CHẾ ĐỘ AN TOÀN/);
  });
});
