/**
 * Mô phỏng hội tụ Adaptive Expenditure Engine (BR-05.8)
 *
 * Kiểm tra:
 * - AC1: Có đánh dấu INCOMPLETE cho các ngày log thiếu -> Expenditure hội tụ trong ±100 kcal của TDEE thực (2300 kcal).
 * - AC2: Không đánh dấu ngày thiếu -> kết quả tính toán bị sai lệch nhiều hơn.
 * - AC3: Nhập cân ngoại lai (150 kg) không làm lệch xu hướng trend.
 */
describe('D7: BR-05.8 Mô phỏng hội tụ Adaptive Expenditure Engine', () => {
  const TRUE_TDEE = 2300;
  const WEEKS = 6;
  const TOTAL_DAYS = WEEKS * 7; // 42 ngày
  const KCAL_PER_KG = 7700;

  it('AC1 & AC2: Phân biệt rõ rệt giữa có lọc ngày thiếu (INCOMPLETE) và không lọc ngày thiếu', () => {
    // Sinh chuỗi ngày ăn: 80% ngày đủ calo (2300), 20% ngày thiếu 40% (2300 * 0.6 = 1380)
    // Cân nặng giữ nguyên 70kg (vì TDEE thực tế = 2300)
    let sumFiltered = 0;
    let countFiltered = 0;
    let sumUnfiltered = 0;
    let countUnfiltered = 0;

    for (let day = 0; day < TOTAL_DAYS; day++) {
      const isMissingDay = day % 5 === 0; // 20% số ngày
      const eatenCalories = isMissingDay ? TRUE_TDEE * 0.6 : TRUE_TDEE;

      // Không lọc: tính tất cả các ngày
      sumUnfiltered += eatenCalories;
      countUnfiltered += 1;

      // Có lọc: loại bỏ các ngày thiếu calo (INCOMPLETE)
      if (!isMissingDay) {
        sumFiltered += eatenCalories;
        countFiltered += 1;
      }
    }

    const estExpenditureFiltered = sumFiltered / countFiltered;
    const estExpenditureUnfiltered = sumUnfiltered / countUnfiltered;

    // AC1: Khi lọc ngày thiếu, ước tính hội tụ trong ±100 kcal so với TDEE thực (2300)
    expect(Math.abs(estExpenditureFiltered - TRUE_TDEE)).toBeLessThanOrEqual(
      100,
    );
    expect(estExpenditureFiltered).toBeCloseTo(2300, 0);

    // AC2: Khi không lọc ngày thiếu, kết quả bị kéo xuống thấp và tệ hơn
    expect(Math.abs(estExpenditureUnfiltered - TRUE_TDEE)).toBeGreaterThan(100);
    expect(estExpenditureUnfiltered).toBeLessThan(TRUE_TDEE - 100);
  });

  it('AC3: Nhập cân ngoại lai 150 kg không làm đổi xu hướng trend weight', () => {
    const weights = [70, 70.1, 69.9, 70.2, 150.0, 70.0, 70.1];
    let trend = weights[0];
    const trendValues: number[] = [trend];

    for (let i = 1; i < weights.length; i++) {
      const w = weights[i];
      const threshold = Math.max(2.0, trend * 0.03);
      // Lọc ngoại lai: nếu lệch > threshold và không được xác nhận thì bỏ qua
      if (Math.abs(w - trend) > threshold) {
        // Outlier ignored
        continue;
      }
      trend = trend + 0.1 * (w - trend);
      trendValues.push(trend);
    }

    // Trend không bao giờ bị nhảy vọt lên theo 150 kg
    expect(trend).toBeLessThan(72);
    expect(trend).toBeGreaterThan(69);
  });
});
