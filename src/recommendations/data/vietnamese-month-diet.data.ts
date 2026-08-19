import { GoalType, WorkoutLevel } from '@prisma/client';
import { VietnameseMealItem } from './vietnamese-diet.data';

export interface MonthDietPlanItem {
  dayNumber: number;
  dayTitle: string;
  goal: GoalType;
  experienceLevel: WorkoutLevel; // BEGINNER (Giai đoạn 1: Giảm mỡ / Tăng cân cơ bản), INTERMEDIATE (Giai đoạn 2: Tăng cơ giảm mỡ Recomp), ADVANCED (Giai đoạn 3: Siết cơ / Tăng cơ chuyên sâu)
  suitableForWho: string;        // 👉 TRƯỜNG MỚI: Chỉ định rõ thực đơn này dành riêng cho ai
  phaseName: string;             // Tên giai đoạn (VD: "Giai đoạn 1: Thích nghi & Giảm mỡ nền tảng")
  focusMessage: string;
  targetCalories: number;
  macroSummary: {
    proteinGrams: number;
    carbGrams: number;
    fatGrams: number;
    proteinRatio: number;
    carbRatio: number;
    fatRatio: number;
  };
  meals: {
    breakfast: { title: string; items: VietnameseMealItem[]; totalCalories: number };
    lunch: { title: string; items: VietnameseMealItem[]; totalCalories: number };
    dinner: { title: string; items: VietnameseMealItem[]; totalCalories: number };
    snack: { title: string; items: VietnameseMealItem[]; totalCalories: number };
    prePostWorkoutSnack?: { title: string; items: VietnameseMealItem[]; totalCalories: number };
  };
}

// =========================================================================================
// 1. TRỌN BỘ 30 NGÀY THỰC ĐƠN GIẢM CÂN (LOSE WEIGHT - 30 NGÀY RIÊNG BIỆT)
// =========================================================================================
export const DISTINCT_30_DAYS_LOSE_WEIGHT = [
  {
    dayNumber: 1,
    title: 'Ngày 1: Thanh đạm mở đầu - Ức gà nấm & Khoai lang',
    breakfast: { title: 'Khoai lang luộc + Trứng gà luộc + Sữa đậu nành', items: [{ name: 'Khoai lang luộc', serving: '1 củ (150g)', calories: 130, protein: 2.5, carb: 30, fat: 0.2 }, { name: 'Trứng gà luộc', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }, { name: 'Sữa đậu nành không đường', serving: '1 ly (200ml)', calories: 65, protein: 6.0, carb: 3.5, fat: 3.0 }] },
    lunch: { title: 'Ức gà xào súp lơ xanh nấm đùi gà + Cơm gạo lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén vơi (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Ức gà xào súp lơ nấm', serving: '150g', calories: 200, protein: 32, carb: 5.0, fat: 4.5 }, { name: 'Canh bí xanh nấu tôm băm', serving: '1 bát', calories: 50, protein: 5.0, carb: 4.0, fat: 1.0 }] },
    dinner: { title: 'Cá hồi áp chảo sốt chanh leo + Salad dầu giấm', items: [{ name: 'Cá hồi áp chảo chanh leo', serving: '130g', calories: 220, protein: 25, carb: 3.0, fat: 10 }, { name: 'Salad xà lách dưa chuột', serving: '1 đĩa lớn', calories: 45, protein: 1.2, carb: 6.0, fat: 2.0 }, { name: 'Canh rau cải nấm rơm', serving: '1 bát', calories: 35, protein: 2.0, carb: 5.0, fat: 0.4 }] },
    snack: { title: 'Sữa chua không đường + Ổi tươi', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }, { name: 'Ổi tươi giòn', serving: '1/2 quả (150g)', calories: 45, protein: 1.0, carb: 10, fat: 0.3 }] },
  },
  {
    dayNumber: 2,
    title: 'Ngày 2: Đậm đà vị Bắc - Phở bò tái nạc & Cá lóc hấp',
    breakfast: { title: 'Phở bò tái nạc nhiều hành giá nước trong', items: [{ name: 'Bánh phở tươi chần ít', serving: '100g', calories: 130, protein: 2.5, carb: 28, fat: 0.5 }, { name: 'Thịt bò thăn nạc tái', serving: '110g', calories: 155, protein: 28, carb: 0, fat: 4.0 }, { name: 'Rau giá hành ngò', serving: '1 đĩa', calories: 25, protein: 1.5, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Cá lóc phi lê hấp hành gừng sả + Rau muống luộc', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá lóc hấp gừng hành', serving: '160g', calories: 180, protein: 32, carb: 1.0, fat: 4.0 }, { name: 'Rau muống luộc dầm sấu', serving: '1 đĩa lớn', calories: 35, protein: 3.0, carb: 5.0, fat: 0.3 }] },
    dinner: { title: 'Gà ta bỏ da hấp lá chanh + Mướp xào nấm', items: [{ name: 'Gà hấp lá chanh', serving: '150g', calories: 200, protein: 32, carb: 0.5, fat: 6.0 }, { name: 'Mướp hương xào nấm đông cô', serving: '1 đĩa', calories: 55, protein: 2.5, carb: 6.0, fat: 1.5 }, { name: 'Canh bầu nấu tôm khô', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }] },
    snack: { title: 'Táo tươi giòn + Hạt hạnh nhân', items: [{ name: 'Táo tươi', serving: '1 quả nhỏ', calories: 65, protein: 0.5, carb: 16, fat: 0.2 }, { name: 'Hạt hạnh nhân sấy mộc', serving: '5-6 hạt', calories: 60, protein: 2.0, carb: 2.0, fat: 5.0 }] },
  },
  {
    dayNumber: 3,
    title: 'Ngày 3: Dồi dào năng lượng - Bánh mì ốp la & Bò xào cần tỏi',
    breakfast: { title: 'Bánh mì đen ốp la + Dưa chuột cà chua bi', items: [{ name: 'Bánh mì ngũ cốc/đen', serving: '1 lát lớn', calories: 110, protein: 4.0, carb: 20, fat: 1.2 }, { name: 'Trứng gà ốp la ít dầu', serving: '1 quả', calories: 90, protein: 6.5, carb: 0.8, fat: 7.0 }, { name: 'Dưa leo cà chua bi', serving: '1 phần', calories: 20, protein: 0.8, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Thịt bò xào cần tây tỏi tía + Canh rau ngót', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Thịt bò thăn xào cần tỏi', serving: '130g', calories: 210, protein: 28, carb: 4.0, fat: 8.0 }, { name: 'Canh rau ngót thịt nạc', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.0, fat: 1.5 }] },
    dinner: { title: 'Thịt thăn heo luộc chấm mắm tỏi + Rau củ luộc', items: [{ name: 'Thịt thăn heo nạc luộc', serving: '130g', calories: 185, protein: 29, carb: 0, fat: 6.0 }, { name: 'Rau củ luộc (su su, cà rốt, bắp cải)', serving: '1 đĩa lớn', calories: 50, protein: 1.8, carb: 10, fat: 0.3 }, { name: 'Nước luộc rau vắt chanh', serving: '1 bát', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    snack: { title: 'Thanh long ruột đỏ thái miếng', items: [{ name: 'Thanh long đỏ', serving: '150g', calories: 65, protein: 1.5, carb: 14, fat: 0.4 }] },
  },
  {
    dayNumber: 4,
    title: 'Ngày 4: Nhẹ bụng êm dịu - Cháo yến mạch gà & Tôm rim thăn',
    breakfast: { title: 'Cháo yến mạch ức gà xé nấm hương', items: [{ name: 'Yến mạch nấu cháo', serving: '40g khô', calories: 150, protein: 5.0, carb: 27, fat: 2.5 }, { name: 'Ức gà xé sợi', serving: '90g', calories: 110, protein: 24, carb: 0, fat: 1.5 }, { name: 'Hành hoa tiêu nấm', serving: '1 phần', calories: 20, protein: 1.0, carb: 3.5, fat: 0.2 }] },
    lunch: { title: 'Tôm tươi rim thịt thăn nạc + Canh cua mồng tơi', items: [{ name: 'Cơm trắng vừa', serving: '1 chén (120g)', calories: 150, protein: 3.0, carb: 33, fat: 0.3 }, { name: 'Tôm nõn rim thịt thăn', serving: '140g', calories: 210, protein: 31, carb: 2.5, fat: 6.5 }, { name: 'Canh cua mồng tơi rau đay', serving: '1 bát', calories: 55, protein: 5.5, carb: 4.0, fat: 1.2 }] },
    dinner: { title: 'Canh chua cá lóc Nam Bộ + Đậu hũ non sốt cà', items: [{ name: 'Cá lóc canh chua nhiều rau', serving: '1 tô lớn', calories: 190, protein: 25, carb: 8.0, fat: 4.5 }, { name: 'Đậu hũ non sốt cà chua hành', serving: '1 miếng (100g)', calories: 85, protein: 8.5, carb: 3.0, fat: 4.5 }] },
    snack: { title: 'Chuối tiêu chín + Trà xanh ấm', items: [{ name: 'Chuối chín vừa', serving: '1 quả (100g)', calories: 90, protein: 1.2, carb: 23, fat: 0.3 }] },
  },
  {
    dayNumber: 5,
    title: 'Ngày 5: Hương vị biển cả - Bún sườn chua & Mực ống xào dứa',
    breakfast: { title: 'Bún sườn chua mọc thịt thăn nạc', items: [{ name: 'Bún tươi chần', serving: '120g', calories: 130, protein: 2.5, carb: 28, fat: 0.4 }, { name: 'Thịt mọc thăn nạc viên', serving: '80g', calories: 115, protein: 18, carb: 1.0, fat: 4.0 }, { name: 'Canh dọc mùng chua me', serving: '1 tô', calories: 60, protein: 2.0, carb: 6.0, fat: 1.5 }] },
    lunch: { title: 'Mực ống xào cần dứa chua ngọt + Canh rong biển', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Mực ống xào cần dứa ớt chuông', serving: '160g', calories: 180, protein: 26, carb: 8.0, fat: 3.5 }, { name: 'Canh rong biển đậu hũ thịt nạc', serving: '1 bát', calories: 65, protein: 6.5, carb: 3.5, fat: 2.0 }] },
    dinner: { title: 'Trứng cuộn rau củ sắc màu + Canh cải cúc cá rô', items: [{ name: 'Trứng cuộn cà rốt nấm hương', serving: '2 quả', calories: 180, protein: 14, carb: 4.0, fat: 11 }, { name: 'Canh cải cúc nấu cá rô đồng', serving: '1 bát', calories: 65, protein: 7.0, carb: 3.5, fat: 2.0 }, { name: 'Bông cải trắng luộc', serving: '1 đĩa', calories: 35, protein: 2.0, carb: 5.0, fat: 0.3 }] },
    snack: { title: 'Sữa chua không đường + Hạt chia ngâm', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }, { name: 'Hạt chia hữu cơ', serving: '1 thìa cà phê', calories: 30, protein: 1.0, carb: 2.0, fat: 2.0 }] },
  },
  {
    dayNumber: 6,
    title: 'Ngày 6: Thuần chay thanh lọc - Bánh cuốn nạc & Đậu hũ nấm rơm',
    breakfast: { title: 'Bánh cuốn nóng tráng mỏng + Chả lụa nạc', items: [{ name: 'Bánh cuốn tráng mỏng', serving: '4 cuốn (130g)', calories: 170, protein: 3.5, carb: 36, fat: 1.0 }, { name: 'Chả lụa nạc quế', serving: '50g', calories: 110, protein: 10, carb: 2.0, fat: 6.5 }, { name: 'Dưa leo chần ngò rí', serving: '1 phần', calories: 20, protein: 0.8, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Đậu phụ sốt cà chua nấm rơm + Canh cải ngọt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Đậu hũ sốt cà chua nấm rơm thịt nạc', serving: '180g', calories: 210, protein: 20, carb: 6.0, fat: 9.5 }, { name: 'Canh cải ngọt nấu gừng', serving: '1 bát', calories: 30, protein: 1.8, carb: 4.0, fat: 0.3 }, { name: 'Đậu cove luộc', serving: '1 đĩa', calories: 40, protein: 2.0, carb: 6.0, fat: 0.2 }] },
    dinner: { title: 'Chả cá Lã Vọng áp chảo thì là + Bún tươi ít', items: [{ name: 'Bún tươi chần', serving: '80g', calories: 95, protein: 1.8, carb: 20, fat: 0.2 }, { name: 'Cá phi lê ướp nghệ thì là áp chảo', serving: '150g', calories: 200, protein: 29, carb: 2.0, fat: 7.0 }, { name: 'Xà lách hành hoa ngò rí', serving: '1 rổ nhỏ', calories: 30, protein: 1.5, carb: 5.0, fat: 0.2 }] },
    snack: { title: 'Quả lê tươi ngọt mọng nước', items: [{ name: 'Lê tươi', serving: '1 quả nhỏ (150g)', calories: 75, protein: 0.6, carb: 18, fat: 0.2 }] },
  },
  {
    dayNumber: 7,
    title: 'Ngày 7: Tổng kết tuần 1 - Bắp ngô ngọt luộc & Thịt kho cút nạc',
    breakfast: { title: 'Bắp ngô ngọt luộc + Trứng gà + Sữa tươi không đường', items: [{ name: 'Ngô ngọt luộc', serving: '1 bắp vừa (150g)', calories: 130, protein: 4.5, carb: 28, fat: 1.8 }, { name: 'Trứng gà luộc', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }, { name: 'Sữa tươi không đường', serving: '1 hộp (180ml)', calories: 110, protein: 5.5, carb: 8.5, fat: 5.8 }] },
    lunch: { title: 'Thịt thăn heo kho trứng cút nạc + Rau lang luộc', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Thịt thăn kho 3 quả trứng cút ít mỡ', serving: '130g', calories: 215, protein: 26, carb: 3.0, fat: 9.5 }, { name: 'Rau lang luộc chấm mắm tỏi', serving: '1 đĩa lớn', calories: 35, protein: 2.5, carb: 5.0, fat: 0.3 }, { name: 'Nước rau lang vắt chanh', serving: '1 bát', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    dinner: { title: 'Bò xào măng tây giòn ngọt + Canh củ dền đỏ', items: [{ name: 'Khoai lang hấp', serving: '1/2 củ (100g)', calories: 90, protein: 1.8, carb: 20, fat: 0.2 }, { name: 'Thịt bò nạc xào măng tây', serving: '130g', calories: 210, protein: 28, carb: 5.0, fat: 7.5 }, { name: 'Canh củ dền đỏ nấu sườn nạc', serving: '1 bát', calories: 65, protein: 4.0, carb: 7.0, fat: 1.8 }] },
    snack: { title: 'Dưa hấu đỏ ướp lạnh', items: [{ name: 'Dưa hấu tươi thái lát', serving: '200g', calories: 60, protein: 1.2, carb: 14, fat: 0.3 }] },
  },
  {
    dayNumber: 8,
    title: 'Ngày 8: Năng lượng xanh - Trứng chiên nấm & Ức gà xé lá chanh',
    breakfast: { title: 'Khoai lang tím luộc + Trứng chiên nấm ít dầu', items: [{ name: 'Khoai lang tím', serving: '1 củ (150g)', calories: 130, protein: 2.0, carb: 30, fat: 0.2 }, { name: 'Trứng gà chiên nấm kim châm', serving: '1 quả trứng', calories: 100, protein: 7.5, carb: 2.5, fat: 7.0 }] },
    lunch: { title: 'Ức gà hấp xé phay trộn hành tây rau răm + Cơm lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Gà xé trộn hành tây dấm ớt', serving: '160g', calories: 210, protein: 34, carb: 4.0, fat: 4.5 }, { name: 'Canh bí đỏ nấu tôm', serving: '1 bát', calories: 60, protein: 5.0, carb: 6.0, fat: 1.2 }] },
    dinner: { title: 'Cá điêu hồng hấp xì dầu hành gừng + Rau cải luộc', items: [{ name: 'Cá điêu hồng phi lê hấp xì dầu', serving: '160g', calories: 185, protein: 30, carb: 3.0, fat: 4.5 }, { name: 'Cải thìa luộc chấm gừng', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }, { name: 'Canh mướp hương mồng tơi', serving: '1 bát', calories: 40, protein: 2.0, carb: 5.0, fat: 0.5 }] },
    snack: { title: 'Bưởi da xanh tép hồng', items: [{ name: 'Bưởi da xanh', serving: '3 múi lớn (150g)', calories: 60, protein: 1.0, carb: 14, fat: 0.2 }] },
  },
  {
    dayNumber: 9,
    title: 'Ngày 9: Tinh hoa đồng quê - Miến gà nạc & Bò áp chảo hương thảo',
    breakfast: { title: 'Miến dong nấu ức gà mộc nhĩ nấm hương', items: [{ name: 'Miến dong chần', serving: '40g khô', calories: 135, protein: 0.5, carb: 33, fat: 0.1 }, { name: 'Thịt ức gà luộc xé', serving: '90g', calories: 110, protein: 24, carb: 0, fat: 1.5 }, { name: 'Nước dùng nấm hành ngò', serving: '1 tô', calories: 30, protein: 1.5, carb: 3.0, fat: 0.5 }] },
    lunch: { title: 'Thịt bò áp chảo tiêu xanh + Khoai tây nghiền', items: [{ name: 'Khoai tây hấp nghiền', serving: '1 củ vừa (140g)', calories: 110, protein: 2.5, carb: 25, fat: 0.2 }, { name: 'Thịt bò thăn áp chảo tiêu', serving: '140g', calories: 220, protein: 30, carb: 1.0, fat: 8.5 }, { name: 'Canh cải xoong nấu thịt nạc', serving: '1 bát', calories: 55, protein: 5.5, carb: 3.5, fat: 1.2 }] },
    dinner: { title: 'Tôm hấp nước dừa sả ớt + Salad dưa chuột cà chua', items: [{ name: 'Tôm tươi hấp sả', serving: '160g', calories: 165, protein: 34, carb: 1.5, fat: 1.8 }, { name: 'Salad sốt sữa chua chanh', serving: '1 đĩa lớn', calories: 50, protein: 2.0, carb: 7.0, fat: 1.5 }, { name: 'Canh chua dứa giá đỗ', serving: '1 bát', calories: 45, protein: 2.0, carb: 6.0, fat: 0.5 }] },
    snack: { title: 'Sữa đậu đen óc chó', items: [{ name: 'Sữa đậu đen không đường', serving: '1 ly (200ml)', calories: 70, protein: 5.5, carb: 6.0, fat: 2.5 }] },
  },
  {
    dayNumber: 10,
    title: 'Ngày 10: Vững vàng giữa chặng - Yến mạch chuối & Thịt bò xào nấm',
    breakfast: { title: 'Yến mạch ngâm sữa chua hạt chia + 1/2 quả chuối', items: [{ name: 'Yến mạch cán dẹt', serving: '35g', calories: 130, protein: 4.5, carb: 24, fat: 2.0 }, { name: 'Sữa chua không đường', serving: '1/2 hộp', calories: 30, protein: 2.0, carb: 2.5, fat: 1.2 }, { name: 'Chuối thái lát', serving: '1/2 quả', calories: 45, protein: 0.6, carb: 11, fat: 0.1 }] },
    lunch: { title: 'Thịt bò xào nấm rơm ớt chuông + Cơm gạo lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Bò xào nấm rơm ớt chuông', serving: '140g', calories: 215, protein: 29, carb: 5.0, fat: 8.0 }, { name: 'Canh rau đay nấu mướp tôm băm', serving: '1 bát', calories: 55, protein: 5.0, carb: 4.5, fat: 1.0 }] },
    dinner: { title: 'Đậu phụ nướng nồi chiên không dầu + Canh ngao mồng tơi', items: [{ name: 'Đậu hũ nướng giòn chấm tương ớt', serving: '2 bìa (160g)', calories: 170, protein: 17, carb: 4.0, fat: 9.0 }, { name: 'Canh ngao nấu mồng tơi', serving: '1 bát lớn', calories: 70, protein: 8.0, carb: 5.0, fat: 1.0 }, { name: 'Rau dền đỏ luộc', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }] },
    snack: { title: 'Cam sành vắt nguyên chất', items: [{ name: 'Nước cam tươi không đường', serving: '1 ly (200ml)', calories: 70, protein: 1.2, carb: 16, fat: 0.2 }] },
  },
  {
    dayNumber: 11,
    title: 'Ngày 11: Thanh nhiệt cơ thể - Bánh mì bơ đậu phộng & Cá basa nướng',
    breakfast: { title: 'Bánh mì đen phết bơ đậu phộng nguyên chất + Trứng luộc', items: [{ name: 'Bánh mì đen', serving: '1 lát', calories: 95, protein: 3.5, carb: 18, fat: 1.0 }, { name: 'Bơ đậu phộng mộc', serving: '1 thìa cà phê', calories: 60, protein: 2.5, carb: 2.0, fat: 5.0 }, { name: 'Trứng gà luộc', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }] },
    lunch: { title: 'Cá basa phi lê nướng giấy bạc sả ớt + Cơm lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá basa nướng sả ớt ít dầu', serving: '150g', calories: 210, protein: 27, carb: 2.0, fat: 9.5 }, { name: 'Canh cải bẹ xanh nấu gừng', serving: '1 bát', calories: 35, protein: 2.0, carb: 4.0, fat: 0.3 }, { name: 'Cà rốt su su luộc', serving: '1 đĩa', calories: 45, protein: 1.5, carb: 9.0, fat: 0.2 }] },
    dinner: { title: 'Ức gà cuộn măng tây nướng + Canh bí đỏ thịt băm', items: [{ name: 'Ức gà cuộn măng tây', serving: '160g', calories: 195, protein: 33, carb: 3.0, fat: 4.5 }, { name: 'Canh bí đỏ thịt nạc', serving: '1 bát vừa', calories: 65, protein: 4.5, carb: 7.0, fat: 1.5 }, { name: 'Dưa leo chấm muối tiêu chanh', serving: '1 quả', calories: 15, protein: 0.7, carb: 3.0, fat: 0.1 }] },
    snack: { title: 'Sữa chua hạt lanh sấy', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }] },
  },
  {
    dayNumber: 12,
    title: 'Ngày 12: Đậm đà xứ Huế - Bún bò giò nạc & Gà xào sả ớt',
    breakfast: { title: 'Bún bò thăn nạc không mỡ nước trong', items: [{ name: 'Bún tươi', serving: '100g', calories: 110, protein: 2.0, carb: 24, fat: 0.3 }, { name: 'Bắp bò nạc luộc thái mỏng', serving: '100g', calories: 145, protein: 27, carb: 0, fat: 3.5 }, { name: 'Hành ngò rau sống bắp chuối', serving: '1 rổ', calories: 25, protein: 1.2, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Gà ta kho sả ớt ít đường + Canh mướp nấm', items: [{ name: 'Cơm trắng', serving: '1 chén vơi (110g)', calories: 140, protein: 2.8, carb: 30, fat: 0.3 }, { name: 'Thịt gà kho sả ớt rút xương', serving: '150g', calories: 220, protein: 32, carb: 3.0, fat: 7.0 }, { name: 'Canh mướp nấu nấm đùi gà', serving: '1 bát', calories: 45, protein: 2.5, carb: 5.0, fat: 0.8 }] },
    dinner: { title: 'Tôm nõn xào đậu cove + Canh cua rau đay', items: [{ name: 'Tôm sú bóc nõn xào đậu cove', serving: '160g', calories: 175, protein: 28, carb: 6.0, fat: 3.5 }, { name: 'Canh cua đồng mồng tơi', serving: '1 bát', calories: 55, protein: 5.5, carb: 4.0, fat: 1.2 }, { name: 'Cà chua dưa chuột', serving: '1 đĩa nhỏ', calories: 20, protein: 0.8, carb: 4.0, fat: 0.1 }] },
    snack: { title: 'Táo giòn gọt vỏ', items: [{ name: 'Táo tươi', serving: '1 quả nhỏ', calories: 65, protein: 0.5, carb: 16, fat: 0.2 }] },
  },
  {
    dayNumber: 13,
    title: 'Ngày 13: Đổi gió cuối tuần - Trứng tráng cuộn rong biển & Cá thu sốt',
    breakfast: { title: 'Trứng tráng cuộn rong biển mè rang + Khoai luộc', items: [{ name: 'Trứng gà cuộn lá rong biển', serving: '2 quả', calories: 175, protein: 13.5, carb: 1.5, fat: 11.5 }, { name: 'Khoai lang vàng luộc', serving: '1/2 củ (80g)', calories: 70, protein: 1.2, carb: 16, fat: 0.1 }] },
    lunch: { title: 'Cá thu Nhật sốt cà chua thì là + Cơm gạo lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá thu sốt cà chua hành thì là', serving: '140g', calories: 215, protein: 26, carb: 4.0, fat: 9.0 }, { name: 'Canh rau má nấu thịt nạc', serving: '1 bát', calories: 50, protein: 5.0, carb: 3.0, fat: 1.0 }] },
    dinner: { title: 'Thịt bò xào ớt chuông hành tây + Canh bí xanh', items: [{ name: 'Bò nạc xào ớt chuông ngũ sắc', serving: '140g', calories: 205, protein: 28, carb: 5.5, fat: 7.0 }, { name: 'Canh bí xanh nấu gừng', serving: '1 bát', calories: 30, protein: 1.5, carb: 4.0, fat: 0.2 }, { name: 'Xà lách trộn dầu giấm', serving: '1 đĩa', calories: 35, protein: 1.0, carb: 5.0, fat: 1.5 }] },
    snack: { title: 'Hạt điều rang sấy mộc', items: [{ name: 'Hạt điều rang muối mộc', serving: '6-8 hạt (12g)', calories: 70, protein: 2.5, carb: 3.5, fat: 5.5 }] },
  },
  {
    dayNumber: 14,
    title: 'Ngày 14: Khép lại tuần 2 - Bánh cuốn thanh mát & Tôm hấp bia',
    breakfast: { title: 'Bánh cuốn chả quế ít mỡ + Giá đỗ chần', items: [{ name: 'Bánh cuốn nóng', serving: '4 cuốn nhỏ (120g)', calories: 160, protein: 3.0, carb: 34, fat: 0.8 }, { name: 'Chả lụa nạc', serving: '40g', calories: 90, protein: 8.5, carb: 1.5, fat: 5.5 }, { name: 'Giá đỗ chần dưa góp', serving: '1 đĩa', calories: 20, protein: 1.0, carb: 3.5, fat: 0.1 }] },
    lunch: { title: 'Tôm hấp sả ớt bia + Canh cải ngọt thịt băm + Cơm', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Tôm tươi hấp sả bia', serving: '160g', calories: 170, protein: 35, carb: 1.5, fat: 1.8 }, { name: 'Canh cải ngọt nấu thịt nạc', serving: '1 bát', calories: 55, protein: 5.5, carb: 3.5, fat: 1.2 }, { name: 'Mướp luộc', serving: '1 đĩa', calories: 30, protein: 1.2, carb: 5.0, fat: 0.2 }] },
    dinner: { title: 'Ức gà áp chảo sốt tiêu đen + Salad cà chua bi', items: [{ name: 'Ức gà phi lê áp chảo tiêu đen', serving: '160g', calories: 200, protein: 35, carb: 2.0, fat: 4.5 }, { name: 'Salad dưa leo cà chua bi', serving: '1 đĩa lớn', calories: 40, protein: 1.2, carb: 6.0, fat: 1.5 }, { name: 'Nước canh rau luộc dầm sấu', serving: '1 bát', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    snack: { title: 'Ổi gọt vỏ chấm muối ớt nhẹ', items: [{ name: 'Ổi tươi', serving: '1/2 quả', calories: 45, protein: 1.0, carb: 10, fat: 0.3 }] },
  },
  {
    dayNumber: 15,
    title: 'Ngày 15: Năng lượng bứt phá - Bún riêu cua ốc nạc & Bò bít tết',
    breakfast: { title: 'Bún riêu cua ốc thanh mát (nhiều rau muống chẻ)', items: [{ name: 'Bún tươi', serving: '100g', calories: 110, protein: 2.0, carb: 24, fat: 0.3 }, { name: 'Riêu cua đồng + ốc nhồi luộc', serving: '120g', calories: 140, protein: 24, carb: 2.0, fat: 3.5 }, { name: 'Rau muống chẻ hoa chuối', serving: '1 rổ lớn', calories: 30, protein: 1.5, carb: 5.0, fat: 0.2 }] },
    lunch: { title: 'Bò bít tết nạc sốt tiêu đen + Bông cải xanh luộc', items: [{ name: 'Khoai tây hấp', serving: '1 củ vừa (130g)', calories: 105, protein: 2.5, carb: 24, fat: 0.2 }, { name: 'Thịt bò thăn bít tết tiêu đen', serving: '150g', calories: 230, protein: 32, carb: 2.0, fat: 9.0 }, { name: 'Bông cải xanh luộc giòn', serving: '1 đĩa (150g)', calories: 45, protein: 3.5, carb: 7.0, fat: 0.5 }] },
    dinner: { title: 'Cá hồi nướng măng tây + Canh rong biển đậu non', items: [{ name: 'Cá hồi nướng muối tiêu chanh', serving: '140g', calories: 230, protein: 27, carb: 1.0, fat: 11 }, { name: 'Măng tây nướng giòn', serving: '100g', calories: 35, protein: 2.5, carb: 5.0, fat: 0.3 }, { name: 'Canh rong biển đậu hũ non', serving: '1 bát', calories: 55, protein: 5.0, carb: 3.0, fat: 1.8 }] },
    snack: { title: 'Sữa chua không đường + Hạt bí xanh', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }, { name: 'Hạt bí xanh tách vỏ', serving: '1 thìa (10g)', calories: 55, protein: 3.0, carb: 1.5, fat: 4.5 }] },
  },
  {
    dayNumber: 16,
    title: 'Ngày 16: Nhẹ nhàng thanh tao - Cháo yến mạch tôm nấm & Gà cuộn lá lốt',
    breakfast: { title: 'Cháo yến mạch tôm tươi nấm rơm', items: [{ name: 'Yến mạch nấu cháo', serving: '40g', calories: 150, protein: 5.0, carb: 27, fat: 2.5 }, { name: 'Tôm tươi băm nhỏ', serving: '80g', calories: 85, protein: 18, carb: 0.8, fat: 0.8 }, { name: 'Hành ngò tiêu cay', serving: '1 phần', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    lunch: { title: 'Thịt ức gà băm cuộn lá lốt nướng + Cơm gạo lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Gà cuộn lá lốt nướng thơm lừng', serving: '150g', calories: 210, protein: 31, carb: 3.0, fat: 6.5 }, { name: 'Canh rau ngót nấu suông', serving: '1 bát', calories: 35, protein: 2.5, carb: 4.0, fat: 0.3 }, { name: 'Dưa leo thái mỏng', serving: '1 quả', calories: 15, protein: 0.7, carb: 3.0, fat: 0.1 }] },
    dinner: { title: 'Cá chim hấp hành nấm + Canh bí xanh tôm khô', items: [{ name: 'Cá chim phi lê hấp gừng nấm', serving: '160g', calories: 190, protein: 30, carb: 2.0, fat: 5.5 }, { name: 'Rau cải ngồng luộc', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }, { name: 'Canh bí xanh tôm khô', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }] },
    snack: { title: 'Thanh long ruột trắng', items: [{ name: 'Thanh long', serving: '150g', calories: 60, protein: 1.2, carb: 13, fat: 0.3 }] },
  },
  {
    dayNumber: 17,
    title: 'Ngày 17: Dinh dưỡng toàn diện - Bánh mì bơ trứng & Cá chép om dưa nạc',
    breakfast: { title: 'Bánh mì ngũ cốc kẹp trứng luộc nghiền bơ', items: [{ name: 'Bánh mì đen', serving: '1 lát', calories: 95, protein: 3.5, carb: 18, fat: 1.0 }, { name: 'Trứng gà nghiền', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }, { name: 'Bơ sáp nghiền mịn', serving: '1 thìa (30g)', calories: 50, protein: 0.6, carb: 2.5, fat: 4.5 }] },
    lunch: { title: 'Cá chép phi lê om dưa cải chua ít mỡ + Cơm lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá chép om dưa chua cà chua', serving: '160g cá + dưa', calories: 215, protein: 28, carb: 5.0, fat: 8.0 }, { name: 'Rau sống dưa góp', serving: '1 đĩa', calories: 25, protein: 1.0, carb: 4.0, fat: 0.1 }] },
    dinner: { title: 'Thịt bò xào đậu Hà Lan + Canh mồng tơi cua', items: [{ name: 'Thịt bò nạc xào đậu Hà Lan', serving: '140g', calories: 215, protein: 29, carb: 6.0, fat: 7.5 }, { name: 'Canh cua đồng mồng tơi', serving: '1 bát', calories: 55, protein: 5.5, carb: 4.0, fat: 1.2 }, { name: 'Bắp cải hấp ngọt', serving: '1 đĩa', calories: 35, protein: 1.5, carb: 6.0, fat: 0.2 }] },
    snack: { title: 'Sữa tươi tiệt trùng không đường', items: [{ name: 'Sữa tươi không đường', serving: '1 hộp (180ml)', calories: 110, protein: 5.5, carb: 8.5, fat: 5.8 }] },
  },
  {
    dayNumber: 18,
    title: 'Ngày 18: Thơm lừng vị quê - Ngô luộc trứng & Mực nhồi thịt nạc hấp',
    breakfast: { title: 'Ngô ngọt luộc + Trứng gà luộc + Sữa đậu nành', items: [{ name: 'Ngô ngọt', serving: '1 bắp', calories: 130, protein: 4.5, carb: 28, fat: 1.8 }, { name: 'Trứng gà luộc', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }, { name: 'Sữa đậu nành không đường', serving: '1 ly (200ml)', calories: 65, protein: 6.0, carb: 3.5, fat: 3.0 }] },
    lunch: { title: 'Mực ống nhồi thịt nạc mộc nhĩ hấp gừng + Cơm trắng', items: [{ name: 'Cơm trắng', serving: '1 chén vơi (110g)', calories: 140, protein: 2.8, carb: 30, fat: 0.3 }, { name: 'Mực nhồi thịt nạc hấp gừng', serving: '160g', calories: 210, protein: 30, carb: 4.0, fat: 7.0 }, { name: 'Canh cải cúc cá rô đồng', serving: '1 bát', calories: 60, protein: 6.5, carb: 3.5, fat: 1.8 }] },
    dinner: { title: 'Ức gà nướng xá xíu ít mật ong + Salad bắp cải tím', items: [{ name: 'Ức gà ướp sốt xá xíu nướng', serving: '160g', calories: 210, protein: 35, carb: 3.5, fat: 5.0 }, { name: 'Salad bắp cải tím sốt dấm táo', serving: '1 đĩa lớn', calories: 45, protein: 1.5, carb: 7.0, fat: 1.5 }, { name: 'Canh bí xanh nấu tôm', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }] },
    snack: { title: 'Ổi tươi gọt vỏ', items: [{ name: 'Ổi tươi', serving: '1/2 quả', calories: 45, protein: 1.0, carb: 10, fat: 0.3 }] },
  },
  {
    dayNumber: 19,
    title: 'Ngày 19: Thanh khiết tự nhiên - Phở gà nạc & Tôm rang thịt nạc',
    breakfast: { title: 'Phở ức gà xé nhiều lá chanh hành ngò', items: [{ name: 'Bánh phở tươi chần ít', serving: '100g', calories: 130, protein: 2.5, carb: 28, fat: 0.5 }, { name: 'Ức gà luộc xé lá chanh', serving: '100g', calories: 130, protein: 27, carb: 0, fat: 2.0 }, { name: 'Nước dùng gà thanh trong', serving: '1 tô', calories: 50, protein: 2.5, carb: 2.5, fat: 1.5 }] },
    lunch: { title: 'Tôm nõn rang thịt thăn tiêu ớt + Canh rau ngót', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Tôm rim thịt thăn tiêu', serving: '140g', calories: 210, protein: 31, carb: 2.5, fat: 6.5 }, { name: 'Canh rau ngót thịt băm', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.0, fat: 1.5 }, { name: 'Rau muống luộc', serving: '1 đĩa', calories: 30, protein: 2.5, carb: 4.5, fat: 0.2 }] },
    dinner: { title: 'Cá hồi áp chảo sốt bơ tỏi nhẹ + Măng tây luộc', items: [{ name: 'Cá hồi áp chảo bơ tỏi', serving: '130g', calories: 230, protein: 26, carb: 2.0, fat: 11 }, { name: 'Măng tây luộc chấm muối tiêu', serving: '1 đĩa', calories: 35, protein: 2.5, carb: 5.0, fat: 0.3 }, { name: 'Canh nấm đậu hũ non', serving: '1 bát', calories: 50, protein: 4.5, carb: 3.5, fat: 1.5 }] },
    snack: { title: 'Táo Envy giòn ngọt', items: [{ name: 'Táo tươi', serving: '1 quả nhỏ', calories: 65, protein: 0.5, carb: 16, fat: 0.2 }] },
  },
  {
    dayNumber: 20,
    title: 'Ngày 20: Tăng cường chất xơ - Bánh mì kẹp chả lụa & Bò xào bông thiên lý',
    breakfast: { title: 'Bánh mì đen kẹp chả lụa nạc + Dưa chuột', items: [{ name: 'Bánh mì đen', serving: '1 lát', calories: 95, protein: 3.5, carb: 18, fat: 1.0 }, { name: 'Chả lụa nạc', serving: '50g', calories: 110, protein: 10, carb: 2.0, fat: 6.5 }, { name: 'Dưa chuột ngò rí', serving: '1 phần', calories: 15, protein: 0.5, carb: 3.0, fat: 0.1 }] },
    lunch: { title: 'Thịt bò xào bông thiên lý tỏi + Canh chua cá bông lau', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Bò nạc xào bông thiên lý', serving: '140g bò', calories: 215, protein: 29, carb: 5.0, fat: 7.5 }, { name: 'Canh chua cá bông lau', serving: '1 bát', calories: 80, protein: 9.0, carb: 5.0, fat: 2.0 }] },
    dinner: { title: 'Đậu phụ dồn thịt nạc sốt cà chua + Canh cải xanh', items: [{ name: 'Đậu nhồi thịt nạc sốt cà', serving: '2 miếng (160g)', calories: 210, protein: 21, carb: 6.0, fat: 9.5 }, { name: 'Canh cải xanh nấu gừng', serving: '1 bát', calories: 30, protein: 1.8, carb: 4.0, fat: 0.3 }, { name: 'Bí ngòi hấp', serving: '1 đĩa', calories: 30, protein: 1.5, carb: 5.0, fat: 0.2 }] },
    snack: { title: 'Chuối chín vừa', items: [{ name: 'Chuối tiêu', serving: '1 quả (100g)', calories: 90, protein: 1.2, carb: 23, fat: 0.3 }] },
  },
  {
    dayNumber: 21,
    title: 'Ngày 21: Hoàn tất tuần 3 - Cháo yến mạch sườn nạc & Gà hấp muối tiêu',
    breakfast: { title: 'Cháo yến mạch sườn nạc băm nấm hương', items: [{ name: 'Yến mạch nấu cháo', serving: '40g', calories: 150, protein: 5.0, carb: 27, fat: 2.5 }, { name: 'Thịt sườn thăn nạc băm', serving: '70g', calories: 105, protein: 16, carb: 0.5, fat: 4.0 }, { name: 'Hành hoa tiêu', serving: '1 phần', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    lunch: { title: 'Gà ta hấp muối tiêu lá chanh + Canh cua mồng tơi', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Gà hấp muối tiêu', serving: '160g', calories: 210, protein: 33, carb: 0.5, fat: 6.5 }, { name: 'Canh cua mồng tơi mướp', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.5, fat: 1.2 }, { name: 'Rau muống luộc', serving: '1 đĩa', calories: 30, protein: 2.5, carb: 4.5, fat: 0.2 }] },
    dinner: { title: 'Cá lóc phi lê kho tiêu ớt + Rau củ luộc ngũ sắc', items: [{ name: 'Cá lóc kho tiêu nạc', serving: '150g', calories: 190, protein: 29, carb: 2.5, fat: 5.5 }, { name: 'Rau củ luộc (súp lơ, cà rốt, bắp bao tử)', serving: '1 đĩa lớn', calories: 50, protein: 2.0, carb: 9.0, fat: 0.3 }, { name: 'Nước luộc rau vắt chanh', serving: '1 bát', calories: 15, protein: 0.5, carb: 2.5, fat: 0.1 }] },
    snack: { title: 'Sữa chua không đường', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }] },
  },
  {
    dayNumber: 22,
    title: 'Ngày 22: Thon gọn vóc dáng - Bún mọc nạc & Bò xào măng tây',
    breakfast: { title: 'Bún mọc thịt nạc nấm hương nước trong', items: [{ name: 'Bún tươi', serving: '100g', calories: 110, protein: 2.0, carb: 24, fat: 0.3 }, { name: 'Mọc nạc nấm hương viên', serving: '80g', calories: 115, protein: 18, carb: 1.0, fat: 4.0 }, { name: 'Rau diếp thơm hành ngò', serving: '1 rổ', calories: 20, protein: 1.0, carb: 3.5, fat: 0.1 }] },
    lunch: { title: 'Thịt bò thăn xào măng tây nấm đùi gà + Cơm lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Bò xào măng tây nấm', serving: '140g', calories: 210, protein: 29, carb: 5.0, fat: 7.5 }, { name: 'Canh rau ngót thịt nạc', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.0, fat: 1.5 }] },
    dinner: { title: 'Tôm nõn hấp bia sả + Salad xà lách dưa chuột', items: [{ name: 'Tôm tươi hấp sả', serving: '160g', calories: 165, protein: 34, carb: 1.5, fat: 1.8 }, { name: 'Salad dưa chuột cà chua dầu giấm', serving: '1 đĩa lớn', calories: 45, protein: 1.2, carb: 6.0, fat: 2.0 }, { name: 'Canh cải ngọt nấu tôm', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }] },
    snack: { title: 'Dưa lưới thơm ngọt', items: [{ name: 'Dưa lưới thái miếng', serving: '150g', calories: 55, protein: 1.0, carb: 12, fat: 0.2 }] },
  },
  {
    dayNumber: 23,
    title: 'Ngày 23: Tươi trẻ làn da - Khoai lang tím & Cá chẽm nướng nghệ',
    breakfast: { title: 'Khoai lang tím + 2 trứng gà luộc', items: [{ name: 'Khoai lang tím', serving: '1 củ (150g)', calories: 130, protein: 2.0, carb: 30, fat: 0.2 }, { name: 'Trứng gà luộc', serving: '2 quả', calories: 155, protein: 13, carb: 1.2, fat: 10 }] },
    lunch: { title: 'Cá chẽm phi lê nướng nghệ thì là + Cơm gạo lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá chẽm nướng nghệ thì là', serving: '150g', calories: 195, protein: 29, carb: 2.0, fat: 6.5 }, { name: 'Canh mồng tơi nấu ngao', serving: '1 bát', calories: 65, protein: 7.5, carb: 4.0, fat: 1.0 }, { name: 'Đậu bắp luộc', serving: '1 đĩa', calories: 35, protein: 2.0, carb: 6.0, fat: 0.3 }] },
    dinner: { title: 'Ức gà xào ớt chuông cần tây + Canh bí đỏ', items: [{ name: 'Ức gà xào ớt chuông', serving: '150g', calories: 195, protein: 33, carb: 4.5, fat: 4.5 }, { name: 'Canh bí đỏ thịt nạc', serving: '1 bát', calories: 60, protein: 4.5, carb: 6.0, fat: 1.5 }, { name: 'Xà lách trộn dấm', serving: '1 đĩa', calories: 30, protein: 1.0, carb: 4.5, fat: 1.0 }] },
    snack: { title: 'Ổi tươi gọt vỏ', items: [{ name: 'Ổi tươi', serving: '1/2 quả', calories: 45, protein: 1.0, carb: 10, fat: 0.3 }] },
  },
  {
    dayNumber: 24,
    title: 'Ngày 24: Hương vị miền Trung - Bánh mì chả cá & Bò xào hoa thiên lý',
    breakfast: { title: 'Bánh mì đen kẹp chả cá thu hấp + Rau thơm', items: [{ name: 'Bánh mì đen', serving: '1 lát', calories: 95, protein: 3.5, carb: 18, fat: 1.0 }, { name: 'Chả cá thu hấp', serving: '60g', calories: 115, protein: 14, carb: 2.0, fat: 4.5 }, { name: 'Rau thơm ngò rí xì dầu', serving: '1 phần', calories: 15, protein: 0.5, carb: 3.0, fat: 0.1 }] },
    lunch: { title: 'Thịt bò xào hoa thiên lý tỏi + Canh sườn chua dọc mùng', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Thịt bò thăn xào thiên lý', serving: '140g bò', calories: 215, protein: 29, carb: 5.0, fat: 7.5 }, { name: 'Canh chua dọc mùng sườn nạc', serving: '1 bát', calories: 75, protein: 7.0, carb: 6.0, fat: 2.0 }] },
    dinner: { title: 'Đậu phụ sốt cà nấm rơm + Canh cua rau đay', items: [{ name: 'Đậu phụ sốt cà nấm', serving: '160g', calories: 180, protein: 16, carb: 5.0, fat: 8.5 }, { name: 'Canh cua đồng rau đay mồng tơi', serving: '1 bát lớn', calories: 60, protein: 6.0, carb: 4.5, fat: 1.2 }, { name: 'Rau cải ngồng luộc', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }] },
    snack: { title: 'Sữa đậu nành không đường', items: [{ name: 'Sữa đậu nành', serving: '1 ly (200ml)', calories: 65, protein: 6.0, carb: 3.5, fat: 3.0 }] },
  },
  {
    dayNumber: 25,
    title: 'Ngày 25: Tái tạo năng lượng - Yến mạch hoa quả & Gà nướng mật ong ít ngọt',
    breakfast: { title: 'Yến mạch ngâm sữa tươi táo đỏ hạt chia', items: [{ name: 'Yến mạch cán dẹt', serving: '35g', calories: 130, protein: 4.5, carb: 24, fat: 2.0 }, { name: 'Sữa tươi không đường', serving: '100ml', calories: 60, protein: 3.0, carb: 4.5, fat: 3.0 }, { name: 'Táo tươi thái hạt lựu', serving: '1/2 quả', calories: 35, protein: 0.3, carb: 8.5, fat: 0.1 }] },
    lunch: { title: 'Ức gà nướng thảo mộc sả ớt + Canh rau dền thịt băm', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Ức gà ướp nướng sả ớt', serving: '160g', calories: 205, protein: 34, carb: 2.5, fat: 5.0 }, { name: 'Canh rau dền nấu thịt nạc', serving: '1 bát', calories: 55, protein: 5.5, carb: 3.5, fat: 1.2 }, { name: 'Dưa chuột', serving: '1 quả', calories: 15, protein: 0.7, carb: 3.0, fat: 0.1 }] },
    dinner: { title: 'Cá hồi áp chảo sốt cam tươi + Salad xà lách xoong', items: [{ name: 'Cá hồi phi lê áp chảo sốt cam', serving: '130g', calories: 225, protein: 25, carb: 4.0, fat: 10.5 }, { name: 'Salad xà lách xoong cà chua', serving: '1 đĩa lớn', calories: 40, protein: 1.5, carb: 5.5, fat: 1.5 }, { name: 'Canh nấm bí xanh', serving: '1 bát', calories: 35, protein: 2.0, carb: 4.5, fat: 0.3 }] },
    snack: { title: 'Thanh long ruột đỏ', items: [{ name: 'Thanh long', serving: '150g', calories: 65, protein: 1.5, carb: 14, fat: 0.4 }] },
  },
  {
    dayNumber: 26,
    title: 'Ngày 26: Thanh lọc gan thận - Phở bò thăn & Tôm rim mặn ngọt thanh',
    breakfast: { title: 'Phở bò thăn tái nạc hành hoa thơm nồng', items: [{ name: 'Bánh phở tươi chần ít', serving: '100g', calories: 130, protein: 2.5, carb: 28, fat: 0.5 }, { name: 'Thịt bò thăn nạc tái', serving: '110g', calories: 155, protein: 28, carb: 0, fat: 4.0 }, { name: 'Rau húng quế giá đỗ', serving: '1 đĩa', calories: 25, protein: 1.5, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Tôm nõn rim thịt thăn nạc mặn ngọt + Canh mướp hương', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Tôm rim thịt thăn', serving: '140g', calories: 210, protein: 31, carb: 2.5, fat: 6.5 }, { name: 'Canh mướp nấu tôm khô', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }, { name: 'Rau muống luộc', serving: '1 đĩa', calories: 30, protein: 2.5, carb: 4.5, fat: 0.2 }] },
    dinner: { title: 'Trứng cuộn nấm đùi gà + Canh cải cúc cá rô', items: [{ name: 'Trứng gà cuộn nấm đùi gà', serving: '2 quả', calories: 180, protein: 14, carb: 3.5, fat: 11 }, { name: 'Canh cải cúc cá rô đồng', serving: '1 bát', calories: 65, protein: 7.0, carb: 3.5, fat: 2.0 }, { name: 'Su su luộc', serving: '1 đĩa', calories: 30, protein: 1.0, carb: 6.0, fat: 0.2 }] },
    snack: { title: 'Sữa chua không đường + Hạt điều', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }, { name: 'Hạt điều rang mộc', serving: '5 hạt', calories: 50, protein: 1.8, carb: 2.5, fat: 4.0 }] },
  },
  {
    dayNumber: 27,
    title: 'Ngày 27: Nhẹ nhàng chuẩn dáng - Bún sườn chua mọc & Cá lóc kho tộ',
    breakfast: { title: 'Bún mọc thịt nạc nấu sấu chua dọc mùng', items: [{ name: 'Bún tươi', serving: '100g', calories: 110, protein: 2.0, carb: 24, fat: 0.3 }, { name: 'Mọc nạc băm viên', serving: '80g', calories: 115, protein: 18, carb: 1.0, fat: 4.0 }, { name: 'Canh chua sấu', serving: '1 tô', calories: 55, protein: 2.0, carb: 5.0, fat: 1.2 }] },
    lunch: { title: 'Cá lóc phi lê kho tiêu ớt ít mỡ + Canh rau ngót', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá lóc kho tiêu nạc', serving: '150g', calories: 195, protein: 30, carb: 2.5, fat: 5.5 }, { name: 'Canh rau ngót thịt băm', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.0, fat: 1.5 }, { name: 'Bắp cải luộc', serving: '1 đĩa', calories: 35, protein: 1.5, carb: 6.0, fat: 0.2 }] },
    dinner: { title: 'Gà ta bỏ da hấp sả lá chanh + Canh bầu tôm tươi', items: [{ name: 'Gà hấp sả lá chanh', serving: '160g', calories: 210, protein: 34, carb: 0.5, fat: 6.5 }, { name: 'Canh bầu nấu tôm tươi', serving: '1 bát', calories: 50, protein: 5.5, carb: 4.0, fat: 0.8 }, { name: 'Rau dền luộc', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }] },
    snack: { title: 'Bưởi da xanh tép hồng', items: [{ name: 'Bưởi da xanh', serving: '3 múi', calories: 60, protein: 1.0, carb: 14, fat: 0.2 }] },
  },
  {
    dayNumber: 28,
    title: 'Ngày 28: Đỉnh cao thể trạng - Bánh cuốn chả lụa & Bò xào cần tây',
    breakfast: { title: 'Bánh cuốn nóng tráng mỏng chả lụa nạc', items: [{ name: 'Bánh cuốn tráng mỏng', serving: '4 cuốn (120g)', calories: 160, protein: 3.0, carb: 34, fat: 0.8 }, { name: 'Chả lụa nạc quế', serving: '50g', calories: 110, protein: 10, carb: 2.0, fat: 6.5 }, { name: 'Rau mùi dưa góp', serving: '1 phần', calories: 20, protein: 0.8, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Thịt bò xào cần tây tỏi tía + Canh bí đỏ tôm', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Bò nạc xào cần tỏi', serving: '140g bò', calories: 215, protein: 29, carb: 4.5, fat: 7.5 }, { name: 'Canh bí đỏ nấu tôm', serving: '1 bát', calories: 60, protein: 5.0, carb: 6.0, fat: 1.2 }, { name: 'Dưa chuột', serving: '1 quả', calories: 15, protein: 0.7, carb: 3.0, fat: 0.1 }] },
    dinner: { title: 'Mực ống xào dưa leo dứa + Canh rong biển', items: [{ name: 'Mực ống xào cần dưa', serving: '160g', calories: 180, protein: 26, carb: 8.0, fat: 3.5 }, { name: 'Canh rong biển đậu hũ thịt nạc', serving: '1 bát', calories: 65, protein: 6.5, carb: 3.5, fat: 2.0 }, { name: 'Bông cải trắng luộc', serving: '1 đĩa', calories: 35, protein: 2.0, carb: 5.0, fat: 0.3 }] },
    snack: { title: 'Táo tươi giòn', items: [{ name: 'Táo tươi', serving: '1 quả nhỏ', calories: 65, protein: 0.5, carb: 16, fat: 0.2 }] },
  },
  {
    dayNumber: 29,
    title: 'Ngày 29: Chuẩn bị về đích - Khoai lang trứng & Cá hấp xì dầu',
    breakfast: { title: 'Khoai lang luộc + Trứng gà + Sữa hạt mè đen', items: [{ name: 'Khoai lang luộc', serving: '1 củ (150g)', calories: 130, protein: 2.5, carb: 30, fat: 0.2 }, { name: 'Trứng gà luộc', serving: '1 quả', calories: 80, protein: 7.0, carb: 0.6, fat: 5.0 }, { name: 'Sữa mè đen không đường', serving: '1 ly (200ml)', calories: 70, protein: 5.0, carb: 4.5, fat: 3.5 }] },
    lunch: { title: 'Cá quả phi lê hấp xì dầu gừng + Rau cải luộc + Cơm lứt', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Cá quả hấp xì dầu hành gừng', serving: '160g', calories: 185, protein: 30, carb: 3.0, fat: 4.5 }, { name: 'Canh cua rau đay mồng tơi', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.5, fat: 1.2 }, { name: 'Cải ngồng luộc', serving: '1 đĩa', calories: 30, protein: 2.0, carb: 4.0, fat: 0.2 }] },
    dinner: { title: 'Ức gà xé phay bóp gỏi rau răm hành tây + Canh bí xanh', items: [{ name: 'Gỏi ức gà xé phay dấm ớt', serving: '170g', calories: 215, protein: 35, carb: 4.5, fat: 5.0 }, { name: 'Canh bí xanh nấu tôm băm', serving: '1 bát', calories: 45, protein: 4.5, carb: 4.0, fat: 0.8 }, { name: 'Xà lách dưa leo', serving: '1 đĩa', calories: 25, protein: 1.0, carb: 4.0, fat: 0.2 }] },
    snack: { title: 'Sữa chua không đường + Ổi tươi', items: [{ name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }, { name: 'Ổi tươi', serving: '1/2 quả', calories: 45, protein: 1.0, carb: 10, fat: 0.3 }] },
  },
  {
    dayNumber: 30,
    title: 'Ngày 30: Chinh phục mục tiêu vóc dáng - Bữa tiệc Eat Clean hoàn mỹ',
    breakfast: { title: 'Phở bò thăn tái nạc đặc biệt hành ngò ngập tràn', items: [{ name: 'Bánh phở tươi chần ít', serving: '100g', calories: 130, protein: 2.5, carb: 28, fat: 0.5 }, { name: 'Thịt bò thăn nạc tái', serving: '120g', calories: 170, protein: 30, carb: 0, fat: 4.5 }, { name: 'Rau sống giá hành', serving: '1 đĩa', calories: 25, protein: 1.5, carb: 4.0, fat: 0.1 }] },
    lunch: { title: 'Thịt thăn heo luộc mắm tỏi + Cá lóc hấp + Canh rau ngót', items: [{ name: 'Cơm gạo lứt', serving: '1 chén (120g)', calories: 140, protein: 3.0, carb: 30, fat: 1.0 }, { name: 'Thịt thăn nạc luộc', serving: '100g', calories: 145, protein: 23, carb: 0, fat: 5.0 }, { name: 'Cá lóc hấp gừng', serving: '80g', calories: 95, protein: 16, carb: 0.5, fat: 2.0 }, { name: 'Canh rau ngót thịt nạc', serving: '1 bát', calories: 60, protein: 6.0, carb: 4.0, fat: 1.5 }, { name: 'Rau muống luộc dầm sấu', serving: '1 đĩa', calories: 35, protein: 3.0, carb: 5.0, fat: 0.3 }] },
    dinner: { title: 'Cá hồi áp chảo sốt chanh leo + Tôm nõn luộc + Salad', items: [{ name: 'Cá hồi áp chảo chanh leo', serving: '120g', calories: 205, protein: 24, carb: 3.0, fat: 9.5 }, { name: 'Tôm nõn hấp', serving: '60g', calories: 65, protein: 13, carb: 0.5, fat: 0.7 }, { name: 'Salad xà lách dầu giấm', serving: '1 đĩa lớn', calories: 45, protein: 1.2, carb: 6.0, fat: 2.0 }, { name: 'Canh rong biển nấm đậu', serving: '1 bát', calories: 50, protein: 4.5, carb: 3.5, fat: 1.5 }] },
    snack: { title: 'Thanh long ruột đỏ + Sữa chua không đường', items: [{ name: 'Thanh long đỏ', serving: '150g', calories: 65, protein: 1.5, carb: 14, fat: 0.4 }, { name: 'Sữa chua không đường', serving: '1 hộp', calories: 60, protein: 3.5, carb: 5.0, fat: 2.5 }] },
  },
];

/**
 * THUẬT TOÁN TỔ HỢP THỰC ĐƠN 30 NGÀY THÔNG MINH - ĐẦY ĐỦ TRƯỜNG DÀNH CHO AI VÀ CHUYỂN GIAI ĐOẠN TĂNG CƠ
 */
export function generateAdvancedMonthDiet(
  userTargetCalories: number,
  goal: GoalType,
  level: WorkoutLevel = WorkoutLevel.BEGINNER,
): MonthDietPlanItem[] {
  const plans: MonthDietPlanItem[] = [];
  const isGainWeight = goal === GoalType.GAIN_WEIGHT;

  // 1. Xác định Trường "suitableForWho" và "phaseName" theo Goal & Level
  let suitableWho = '';
  let phase = '';
  let levelMultiplier = 1.0;
  let focusMsg = '';

  if (goal === GoalType.LOSE_WEIGHT) {
    if (level === WorkoutLevel.BEGINNER) {
      suitableWho = 'Dành cho Người mới bắt đầu giảm cân (Thừa cân, mỡ bụng, ít vận động) - Cần thực đơn dễ nấu, nhẹ bụng, thâm hụt calo an toàn';
      phase = 'Giai đoạn 1: Làm quen & Thâm hụt calo khởi động';
      levelMultiplier = 1.0;
      focusMsg = 'Tập trung ăn sạch, kiểm soát khẩu phần tinh bột nhanh, bổ sung nhiều chất xơ để cơ thể làm quen với việc đốt mỡ.';
    } else if (level === WorkoutLevel.INTERMEDIATE) {
      suitableWho = 'Dành cho Người đã giảm mỡ ổn định, đang tập luyện đều đặn - Cần thực đơn duy trì vóc dáng và săn chắc cơ bắp';
      phase = 'Giai đoạn 2: Tăng cơ giảm mỡ (Body Recomposition)';
      levelMultiplier = 1.08;
      focusMsg = 'Nâng cao lượng protein bảo toàn khối cơ nạc, tối ưu hóa năng lượng cho các buổi tập kháng lực.';
    } else {
      suitableWho = 'Dành cho Người tập luyện cường độ cao / Vận động viên siết cơ - Cần dinh dưỡng tối đa hóa phục hồi sợi cơ';
      phase = 'Giai đoạn 3: Siết cơ chuyên sâu (Cutting & Muscle Recovery)';
      levelMultiplier = 1.15;
      focusMsg = 'Bổ sung thêm bữa phụ Pre/Post Workout giàu protein và glycogen nhanh, giúp xé mỡ tầng sâu mà không mất cơ.';
    }
  } else if (goal === GoalType.GAIN_WEIGHT) {
    if (level === WorkoutLevel.BEGINNER) {
      suitableWho = 'Dành cho Người gầy mới bắt đầu muốn tăng cân lành mạnh - Cần thực đơn giàu năng lượng sạch, dễ hấp thu, không tích mỡ bụng';
      phase = 'Giai đoạn 1: Tăng hấp thu & Nạp dư thừa calo sạch';
      levelMultiplier = 1.0;
      focusMsg = 'Bổ sung các bữa ăn giàu dưỡng chất từ thịt nạc, trứng, sữa hạt, tinh bột phức giúp tăng cân đều đặn.';
    } else if (level === WorkoutLevel.INTERMEDIATE) {
      suitableWho = 'Dành cho Người gầy đã tập gym ổn định - Cần thực đơn xây dựng khối cơ bắp nạc (Lean Bulk)';
      phase = 'Giai đoạn 2: Tăng cơ nạc (Hypertrophy Nutrition)';
      levelMultiplier = 1.1;
      focusMsg = 'Tăng cường protein nạc và carb phức hợp trước buổi tập để bùng nổ sức mạnh đẩy tạ.';
    } else {
      suitableWho = 'Dành cho Người tập thể hình chuyên sâu muốn xả cơ bắp cực đại (Heavy Bulking)';
      phase = 'Giai đoạn 3: Xả cơ chuyên sâu & Tối đa hóa sức mạnh';
      levelMultiplier = 1.2;
      focusMsg = 'Nạp năng lượng tối đa, chia 5-6 bữa trong ngày với bữa phụ Pre/Post Workout giúp cơ bắp phát triển vượt bậc.';
    }
  } else {
    suitableWho = 'Dành cho Người có cân nặng chuẩn muốn duy trì sức khỏe, thể lực dẻo dai và vóc dáng cân đối';
    phase = 'Giai đoạn: Duy trì vóc dáng & Sức khỏe bền vững (Healthy Lifestyle)';
    levelMultiplier = 1.0;
    focusMsg = 'Duy trì chế độ ăn Eat Clean thuần Việt cân bằng hoàn hảo giữa Protein, Carb và Fat.';
  }

  const effectiveCalories = Math.round(userTargetCalories * levelMultiplier);
  const baseScale = effectiveCalories / (isGainWeight ? 2200 : 1400);

  for (let day = 1; day <= 30; day++) {
    const rawDay = DISTINCT_30_DAYS_LOSE_WEIGHT[day - 1];

    const bfItems = rawDay.breakfast.items.map((it) => scaleItem(it, baseScale));
    const lunchItems = rawDay.lunch.items.map((it) => scaleItem(it, baseScale));
    const dinnerItems = rawDay.dinner.items.map((it) => scaleItem(it, baseScale));
    const snackItems = rawDay.snack.items.map((it) => scaleItem(it, baseScale));

    const bfCal = bfItems.reduce((acc, cur) => acc + cur.calories, 0);
    const lunchCal = lunchItems.reduce((acc, cur) => acc + cur.calories, 0);
    const dinnerCal = dinnerItems.reduce((acc, cur) => acc + cur.calories, 0);
    const snackCal = snackItems.reduce((acc, cur) => acc + cur.calories, 0);

    let totalCal = bfCal + lunchCal + dinnerCal + snackCal;
    let prePostWorkoutMeal: any = undefined;

    // Nếu người tập nặng (ADVANCED), bổ sung thêm bữa phụ Pre/Post Workout
    if (level === WorkoutLevel.ADVANCED) {
      const prePostRaw = [
        { name: 'Chuối tiêu chín', serving: '1 quả lớn', calories: 105, protein: 1.5, carb: 26, fat: 0.3 },
        { name: 'Trứng gà luộc', serving: '2 quả', calories: 155, protein: 13, carb: 1.2, fat: 10 },
        { name: 'Sữa đậu nành không đường', serving: '1 ly (200ml)', calories: 75, protein: 7.0, carb: 4.0, fat: 3.5 },
      ];
      const prePostItems = prePostRaw.map((it) => scaleItem(it, baseScale * 0.8));
      const prePostCal = prePostItems.reduce((acc, cur) => acc + cur.calories, 0);
      totalCal += prePostCal;

      prePostWorkoutMeal = {
        title: 'Bữa phụ trước/sau buổi tập nặng (Pre/Post Workout): Chuối + 2 Trứng luộc + Sữa đậu nành',
        items: prePostItems,
        totalCalories: prePostCal,
      };
    }

    const allDayItems = [...bfItems, ...lunchItems, ...dinnerItems, ...snackItems, ...(prePostWorkoutMeal?.items || [])];
    const totalP = Math.round(allDayItems.reduce((acc, cur) => acc + cur.protein, 0));
    const totalC = Math.round(allDayItems.reduce((acc, cur) => acc + cur.carb, 0));
    const totalF = Math.round(allDayItems.reduce((acc, cur) => acc + cur.fat, 0));

    plans.push({
      dayNumber: day,
      dayTitle: rawDay.title,
      goal,
      experienceLevel: level,
      suitableForWho: suitableWho,
      phaseName: phase,
      focusMessage: focusMsg,
      targetCalories: totalCal,
      macroSummary: {
        proteinGrams: totalP,
        carbGrams: totalC,
        fatGrams: totalF,
        proteinRatio: isGainWeight ? 25 : 35,
        carbRatio: isGainWeight ? 55 : 40,
        fatRatio: isGainWeight ? 20 : 25,
      },
      meals: {
        breakfast: { title: rawDay.breakfast.title, items: bfItems, totalCalories: bfCal },
        lunch: { title: rawDay.lunch.title, items: lunchItems, totalCalories: lunchCal },
        dinner: { title: rawDay.dinner.title, items: dinnerItems, totalCalories: dinnerCal },
        snack: { title: rawDay.snack.title, items: snackItems, totalCalories: snackCal },
        prePostWorkoutSnack: prePostWorkoutMeal,
      },
    });
  }

  return plans;
}

function scaleItem(item: VietnameseMealItem, scale: number): VietnameseMealItem {
  return {
    ...item,
    calories: Math.round(item.calories * scale),
    protein: Math.round(item.protein * scale * 10) / 10,
    carb: Math.round(item.carb * scale * 10) / 10,
    fat: Math.round(item.fat * scale * 10) / 10,
  };
}
