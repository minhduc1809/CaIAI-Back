import { isTransientGeminiError, modelChain, parseFallbackModels, resetModelCooldowns, withModelFallback } from './gemini-resilience';

describe('gemini-resilience', () => {
  beforeEach(() => resetModelCooldowns());

  it('nhận diện lỗi tạm thời và lỗi do yêu cầu', () => {
    expect(isTransientGeminiError(new Error('[503 Service Unavailable] This model is currently experiencing high demand'))).toBe(true);
    expect(isTransientGeminiError(new Error('fetch failed'))).toBe(true);
    expect(isTransientGeminiError(new Error('[400 Bad Request] Request contains an invalid argument'))).toBe(false);
  });

  it('chuỗi mô hình không trùng và tối đa 3', () => {
    expect(modelChain('a', ['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd']);
    expect(parseFallbackModels(undefined).length).toBeGreaterThan(0);
    expect(parseFallbackModels(' x , y ')).toEqual(['x', 'y']);
  });

  it('503 ở mô hình chính thì dùng mô hình dự phòng', async () => {
    const calls: string[] = [];
    const out = await withModelFallback(['m1', 'm2'], async (n) => {
      calls.push(n);
      if (n === 'm1') throw new Error('[503] high demand');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toEqual(['m1', 'm2']);
  });

  it('lỗi 400 ném ngay, không thử mô hình khác', async () => {
    const calls: string[] = [];
    await expect(withModelFallback(['m1', 'm2'], async (n) => { calls.push(n); throw new Error('[400] invalid argument'); })).rejects.toThrow('400');
    expect(calls).toEqual(['m1']);
  });

  it('hết chuỗi vẫn lỗi thì ném lỗi cuối', async () => {
    await expect(withModelFallback(['m1', 'm2'], async (n) => { throw new Error(`[503] ${n}`); })).rejects.toThrow('m2');
  });

  it('mô hình vừa lỗi tạm thời được xếp xuống cuối ở lần gọi sau', async () => {
    await withModelFallback(['m1', 'm2'], async (n) => { if (n === 'm1') throw new Error('[503] high demand'); return 'ok'; });
    expect(modelChain('m1', ['m2', 'm3'])).toEqual(['m2', 'm3', 'm1']);
  });
});
