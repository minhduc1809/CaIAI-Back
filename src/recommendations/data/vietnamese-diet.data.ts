import { GoalType, WorkoutLevel } from '@prisma/client';

export interface VietnameseMealItem {
  name: string;
  serving: string;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  note?: string;
}

export interface VietnameseDietPlan {
  id: string;
  goal: GoalType;
  title: string;
  description: string;
  targetCalo: number;
  macroRatio: {
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
  };
  meals: {
    breakfast: {
      title: string;
      items: VietnameseMealItem[];
      totalCalories: number;
    };
    lunch: {
      title: string;
      items: VietnameseMealItem[];
      totalCalories: number;
    };
    dinner: {
      title: string;
      items: VietnameseMealItem[];
      totalCalories: number;
    };
    snack?: {
      title: string;
      items: VietnameseMealItem[];
      totalCalories: number;
    };
  };
}

export const VIETNAMESE_DIET_PLANS: VietnameseDietPlan[] = [
  // =========================================================================
  // 1. THỰC ĐƠN GIẢM CÂN (1200 - 1300 KCAL) - Dành cho nữ ít vận động muốn giảm mỡ
  // =========================================================================
  {
    id: 'diet-lose-1200',
    goal: GoalType.LOSE_WEIGHT,
    title: 'Thực đơn giảm mỡ nhẹ nhàng 1200 kcal',
    description:
      'Thực đơn thanh đạm, giàu chất xơ từ rau củ Việt Nam và protein nạc, giúp no lâu và giảm mỡ an toàn.',
    targetCalo: 1250,
    macroRatio: { proteinPercent: 35, carbPercent: 40, fatPercent: 25 },
    meals: {
      breakfast: {
        title: 'Bữa sáng nhẹ năng lượng',
        items: [
          {
            name: 'Khoai lang luộc',
            serving: '1 củ vừa (~150g)',
            calories: 130,
            protein: 2.5,
            carb: 30,
            fat: 0.2,
          },
          {
            name: 'Trứng gà luộc',
            serving: '1 quả',
            calories: 75,
            protein: 6.3,
            carb: 0.6,
            fat: 5.0,
          },
          {
            name: 'Sữa đậu nành không đường',
            serving: '1 ly (200ml)',
            calories: 65,
            protein: 6.0,
            carb: 3.5,
            fat: 3.0,
          },
        ],
        totalCalories: 270,
      },
      lunch: {
        title: 'Bữa trưa cơm nhà thanh đạm',
        items: [
          {
            name: 'Cơm gạo lứt (hoặc cơm trắng)',
            serving: '1 chén vơi (~120g)',
            calories: 140,
            protein: 3.0,
            carb: 30,
            fat: 1.0,
          },
          {
            name: 'Ức gà xào nấm đông cô ít dầu',
            serving: '130g',
            calories: 180,
            protein: 32.0,
            carb: 4.0,
            fat: 3.5,
          },
          {
            name: 'Rau cải ngọt luộc',
            serving: '1 đĩa (150g)',
            calories: 35,
            protein: 2.0,
            carb: 5.0,
            fat: 0.3,
          },
          {
            name: 'Canh bí đao nấu thịt nạc băm',
            serving: '1 bát',
            calories: 65,
            protein: 6.0,
            carb: 4.0,
            fat: 2.0,
          },
        ],
        totalCalories: 420,
      },
      dinner: {
        title: 'Bữa tối nhẹ bụng hạn chế tinh bột',
        items: [
          {
            name: 'Cá lóc hấp hành gừng',
            serving: '150g',
            calories: 160,
            protein: 28.0,
            carb: 1.0,
            fat: 4.0,
          },
          {
            name: 'Rau muống luộc chấm nước mắm tỏi',
            serving: '1 đĩa lớn (200g)',
            calories: 45,
            protein: 4.0,
            carb: 6.0,
            fat: 0.5,
          },
          {
            name: 'Nước canh rau muống dầm sấu/chanh',
            serving: '1 bát',
            calories: 15,
            protein: 0.5,
            carb: 2.0,
            fat: 0.1,
          },
          {
            name: 'Ngô ngọt luộc',
            serving: '1/2 bắp (~80g)',
            calories: 70,
            protein: 2.5,
            carb: 15.0,
            fat: 1.0,
          },
        ],
        totalCalories: 290,
      },
      snack: {
        title: 'Bữa phụ xế chiều',
        items: [
          {
            name: 'Sữa chua không đường',
            serving: '1 hộp (100g)',
            calories: 60,
            protein: 3.5,
            carb: 5.0,
            fat: 2.5,
          },
          {
            name: 'Ổi tươi gọt vỏ',
            serving: '1/2 quả (~150g)',
            calories: 45,
            protein: 1.0,
            carb: 10.0,
            fat: 0.3,
          },
        ],
        totalCalories: 105,
      },
    },
  },

  // =========================================================================
  // 2. THỰC ĐƠN GIẢM CÂN (1500 KCAL) - Dành cho nam/nữ vừa tập luyện vừa giảm mỡ
  // =========================================================================
  {
    id: 'diet-lose-1500',
    goal: GoalType.LOSE_WEIGHT,
    title: 'Thực đơn giảm mỡ năng động 1500 kcal',
    description:
      'Thực đơn cân bằng đầy đủ các món ăn quen thuộc của người Việt, lượng đạm cao bảo toàn cơ bắp khi thâm hụt calo.',
    targetCalo: 1520,
    macroRatio: { proteinPercent: 35, carbPercent: 40, fatPercent: 25 },
    meals: {
      breakfast: {
        title: 'Bữa sáng dinh dưỡng',
        items: [
          {
            name: 'Phở bò tái nạc ít bánh nhiều hành giá',
            serving: '1 tô vừa',
            calories: 360,
            protein: 24.0,
            carb: 45.0,
            fat: 8.0,
          },
          {
            name: 'Trà xanh / Nước lọc ấm',
            serving: '1 ly',
            calories: 0,
            protein: 0,
            carb: 0,
            fat: 0,
          },
        ],
        totalCalories: 360,
      },
      lunch: {
        title: 'Bữa trưa công sở no lâu',
        items: [
          {
            name: 'Cơm trắng',
            serving: '1 chén đầy (~150g)',
            calories: 190,
            protein: 3.8,
            carb: 41.0,
            fat: 0.4,
          },
          {
            name: 'Thịt bò xào ớt chuông cần tây',
            serving: '120g bò + rau',
            calories: 230,
            protein: 28.0,
            carb: 6.0,
            fat: 9.0,
          },
          {
            name: 'Canh rau ngót nấu tôm băm',
            serving: '1 bát vừa',
            calories: 70,
            protein: 7.0,
            carb: 5.0,
            fat: 1.5,
          },
          {
            name: 'Dưa chuột thái lát',
            serving: '1 quả (100g)',
            calories: 15,
            protein: 0.7,
            carb: 3.0,
            fat: 0.1,
          },
        ],
        totalCalories: 505,
      },
      dinner: {
        title: 'Bữa tối gia đình lành mạnh',
        items: [
          {
            name: 'Cơm trắng',
            serving: '1/2 chén (~80g)',
            calories: 100,
            protein: 2.0,
            carb: 22.0,
            fat: 0.2,
          },
          {
            name: 'Tôm rim thịt nạc (hạn chế đường)',
            serving: '120g',
            calories: 195,
            protein: 27.0,
            carb: 3.0,
            fat: 7.0,
          },
          {
            name: 'Bông cải xanh luộc',
            serving: '1 đĩa (150g)',
            calories: 45,
            protein: 3.5,
            carb: 7.0,
            fat: 0.5,
          },
          {
            name: 'Canh chua cá lóc (nhiều rau bạc hà, giá, dứa)',
            serving: '1 bát',
            calories: 95,
            protein: 10.0,
            carb: 8.0,
            fat: 2.0,
          },
        ],
        totalCalories: 435,
      },
      snack: {
        title: 'Bữa phụ phục hồi',
        items: [
          {
            name: 'Chuối tiêu chín',
            serving: '1 quả (~100g)',
            calories: 90,
            protein: 1.2,
            carb: 23.0,
            fat: 0.3,
          },
          {
            name: 'Hạt điều rang muối',
            serving: '6-8 hạt (~15g)',
            calories: 85,
            protein: 3.0,
            carb: 4.5,
            fat: 6.5,
          },
        ],
        totalCalories: 175,
      },
    },
  },

  // =========================================================================
  // 3. THỰC ĐƠN DUY TRÌ CÂN NẶNG / GIỮ DÁNG (1800 KCAL)
  // =========================================================================
  {
    id: 'diet-maintain-1800',
    goal: GoalType.MAINTAIN,
    title: 'Thực đơn Eat Clean Việt giữ dáng 1800 kcal',
    description:
      'Thực đơn chuẩn mực, phong phú các món truyền thống Việt Nam giúp duy trì mức cân lý tưởng và vóc dáng săn chắc.',
    targetCalo: 1800,
    macroRatio: { proteinPercent: 30, carbPercent: 45, fatPercent: 25 },
    meals: {
      breakfast: {
        title: 'Bữa sáng tràn đầy sức sống',
        items: [
          {
            name: 'Bánh mì ốp la 2 trứng + dưa chuột, ngò',
            serving: '1 phần',
            calories: 380,
            protein: 16.0,
            carb: 40.0,
            fat: 16.0,
          },
          {
            name: 'Sữa tươi không đường',
            serving: '1 ly (200ml)',
            calories: 120,
            protein: 6.5,
            carb: 9.5,
            fat: 6.5,
          },
        ],
        totalCalories: 500,
      },
      lunch: {
        title: 'Bữa trưa đậm đà thuần Việt',
        items: [
          {
            name: 'Cơm trắng',
            serving: '1.5 chén (~200g)',
            calories: 260,
            protein: 5.0,
            carb: 56.0,
            fat: 0.6,
          },
          {
            name: 'Thịt kho trứng nạc',
            serving: '1 miếng nạc + 1 trứng',
            calories: 220,
            protein: 22.0,
            carb: 3.0,
            fat: 12.0,
          },
          {
            name: 'Đậu cove xào tỏi',
            serving: '1 đĩa (120g)',
            calories: 60,
            protein: 2.0,
            carb: 6.0,
            fat: 3.0,
          },
          {
            name: 'Canh mồng tơi nấu cua đồng',
            serving: '1 bát tô',
            calories: 65,
            protein: 6.0,
            carb: 5.0,
            fat: 1.5,
          },
        ],
        totalCalories: 605,
      },
      dinner: {
        title: 'Bữa tối ấm cúng nhẹ nhàng',
        items: [
          {
            name: 'Cơm trắng',
            serving: '1 chén (~130g)',
            calories: 165,
            protein: 3.2,
            carb: 35.0,
            fat: 0.4,
          },
          {
            name: 'Cá hồi / Cá thu sốt cà chua',
            serving: '130g cá',
            calories: 210,
            protein: 25.0,
            carb: 4.0,
            fat: 9.5,
          },
          {
            name: 'Rau củ luộc thập cẩm (cà rốt, su su, bắp cải)',
            serving: '1 đĩa',
            calories: 55,
            protein: 2.0,
            carb: 10.0,
            fat: 0.5,
          },
          {
            name: 'Canh rau cải cá rô',
            serving: '1 bát',
            calories: 60,
            protein: 6.0,
            carb: 3.0,
            fat: 2.0,
          },
        ],
        totalCalories: 490,
      },
      snack: {
        title: 'Bữa phụ tươi mát',
        items: [
          {
            name: 'Táo tươi / Thanh long',
            serving: '1 quả vừa (~150g)',
            calories: 80,
            protein: 0.8,
            carb: 18.0,
            fat: 0.3,
          },
          {
            name: 'Sữa chua men sống',
            serving: '1 hộp',
            calories: 75,
            protein: 3.0,
            carb: 12.0,
            fat: 1.5,
          },
        ],
        totalCalories: 155,
      },
    },
  },

  // =========================================================================
  // 4. THỰC ĐƠN TĂNG CÂN / TĂNG CƠ (2200 - 2400 KCAL) - Dành cho người gầy, tập gym
  // =========================================================================
  {
    id: 'diet-gain-2200',
    goal: GoalType.GAIN_WEIGHT,
    title: 'Thực đơn tăng cân tăng cơ nạc 2200 kcal',
    description:
      'Thực đơn giàu năng lượng sạch và protein dồi dào, hỗ trợ tăng cân lành mạnh không tích mỡ thừa.',
    targetCalo: 2250,
    macroRatio: { proteinPercent: 25, carbPercent: 55, fatPercent: 20 },
    meals: {
      breakfast: {
        title: 'Bữa sáng thịnh soạn',
        items: [
          {
            name: 'Bún bò Huế (nạm bò, chả cua, tiết)',
            serving: '1 tô lớn',
            calories: 520,
            protein: 32.0,
            carb: 65.0,
            fat: 14.0,
          },
          {
            name: 'Sữa bắp / Sữa hạt tự nhiên',
            serving: '1 ly (250ml)',
            calories: 140,
            protein: 4.0,
            carb: 24.0,
            fat: 3.0,
          },
        ],
        totalCalories: 660,
      },
      lunch: {
        title: 'Bữa trưa dồi dào năng lượng',
        items: [
          {
            name: 'Cơm trắng',
            serving: '2 chén (~260g)',
            calories: 340,
            protein: 6.5,
            carb: 72.0,
            fat: 0.8,
          },
          {
            name: 'Gà kho gừng sả',
            serving: '160g',
            calories: 260,
            protein: 34.0,
            carb: 3.0,
            fat: 11.0,
          },
          {
            name: 'Đậu phụ sốt cà chua thịt băm',
            serving: '1 phần (150g)',
            calories: 170,
            protein: 14.0,
            carb: 6.0,
            fat: 9.0,
          },
          {
            name: 'Canh sườn hầm rau củ quả',
            serving: '1 bát tô',
            calories: 110,
            protein: 9.0,
            carb: 8.0,
            fat: 4.0,
          },
        ],
        totalCalories: 880,
      },
      dinner: {
        title: 'Bữa tối no đủ dinh dưỡng',
        items: [
          {
            name: 'Cơm trắng',
            serving: '1.5 chén (~200g)',
            calories: 260,
            protein: 5.0,
            carb: 56.0,
            fat: 0.6,
          },
          {
            name: 'Thịt bò xào bông thiên lý / cần tỏi',
            serving: '140g bò',
            calories: 240,
            protein: 30.0,
            carb: 5.0,
            fat: 10.0,
          },
          {
            name: 'Canh ngao nấu mồng tơi',
            serving: '1 bát lớn',
            calories: 70,
            protein: 8.0,
            carb: 6.0,
            fat: 1.0,
          },
          {
            name: 'Trứng chiên hành hoa',
            serving: '1 quả',
            calories: 95,
            protein: 6.5,
            carb: 1.0,
            fat: 7.0,
          },
        ],
        totalCalories: 665,
      },
      snack: {
        title: 'Bữa phụ trước/sau tập',
        items: [
          {
            name: 'Sinh tố bơ chuối sữa tươi',
            serving: '1 ly lớn (300ml)',
            calories: 230,
            protein: 6.0,
            carb: 32.0,
            fat: 9.0,
          },
          {
            name: 'Trứng gà luộc',
            serving: '1 quả',
            calories: 75,
            protein: 6.3,
            carb: 0.6,
            fat: 5.0,
          },
        ],
        totalCalories: 305,
      },
    },
  },
];
