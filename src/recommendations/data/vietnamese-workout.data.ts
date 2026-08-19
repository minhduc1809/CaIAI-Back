import { GoalType, WorkoutLevel } from '@prisma/client';

export interface ExerciseItem {
  name: string;
  targetMuscle: string;
  sets: number;
  repsOrDuration: string;
  restSeconds: number;
  caloriesBurnedEstimate: number;
  instructions: string;
}

export interface DayWorkoutPlan {
  dayName: string; // VD: 'Thứ 2 - Ngực & Tay sau', 'Thứ 3 - Nghỉ phục hồi'
  focus: string;
  estimatedMinutes: number;
  exercises: ExerciseItem[];
}

export interface WorkoutTemplatePlan {
  id: string;
  goal: GoalType;
  level: WorkoutLevel;
  title: string;
  description: string;
  suitableForBmi: string; // VD: 'Béo phì / Thừa cân (BMI >= 23)'
  weeklySchedule: DayWorkoutPlan[];
}

export const VIETNAMESE_WORKOUT_PLANS: WorkoutTemplatePlan[] = [
  // =========================================================================
  // 1. LỊCH TẬP ĐỐT MỠ TOÀN THÂN TẠI NHÀ (HOME WORKOUT - BEGINNER / OVERWEIGHT)
  // Phù hợp người thừa cân (BMI >= 23), mới bắt đầu, không có dụng cụ
  // =========================================================================
  {
    id: 'workout-lose-home-beginner',
    goal: GoalType.LOSE_WEIGHT,
    level: WorkoutLevel.BEGINNER,
    title: 'Lộ trình đốt mỡ toàn thân tại nhà 4 tuần (Không dụng cụ)',
    description: 'Giáo án tập trung vào các động tác Bodyweight an toàn cho khớp gối, tăng nhịp tim để đốt mỡ hiệu quả và cải thiện sức bền tim mạch.',
    suitableForBmi: 'Thừa cân / Tiền béo phì (BMI 23 - 29.9)',
    weeklySchedule: [
      {
        dayName: 'Thứ 2',
        focus: 'Kích hoạt cơ toàn thân & Cardio nhẹ',
        estimatedMinutes: 25,
        exercises: [
          { name: 'Xoay khớp & Khởi động động', targetMuscle: 'Toàn thân', sets: 1, repsOrDuration: '5 phút', restSeconds: 0, caloriesBurnedEstimate: 20, instructions: 'Xoay cổ tay, cổ chân, vai, hông và nâng cao đùi tại chỗ nhẹ nhàng.' },
          { name: 'Bodyweight Squat (Ngồi xổm không tạ)', targetMuscle: 'Đùi, Mông', sets: 3, repsOrDuration: '12-15 lần', restSeconds: 45, caloriesBurnedEstimate: 45, instructions: 'Đứng rộng bằng vai, hạ hông ra sau như ngồi ghế, giữ lưng thẳng, gối không chụm vào trong.' },
          { name: 'Chống đẩy với tường / Quỳ gối chống đẩy', targetMuscle: 'Ngực, Tay sau', sets: 3, repsOrDuration: '10-12 lần', restSeconds: 45, caloriesBurnedEstimate: 35, instructions: 'Đặt 2 gối chạm sàn, giữ lưng thẳng từ đầu đến gối, hạ ngực gần chạm đất rồi đẩy lên.' },
          { name: 'Plank tĩnh', targetMuscle: 'Cơ bụng, Core', sets: 3, repsOrDuration: '25-30 giây', restSeconds: 45, caloriesBurnedEstimate: 25, instructions: 'Chống cẳng tay, siết chặt cơ bụng và cơ mông, không để võng lưng.' },
        ],
      },
      {
        dayName: 'Thứ 3',
        focus: 'Đi bộ nhanh ngoài trời / Đạp xe nhẹ',
        estimatedMinutes: 30,
        exercises: [
          { name: 'Đi bộ nhanh liên tục (Brisk Walking)', targetMuscle: 'Tim mạch, Chân', sets: 1, repsOrDuration: '30 phút', restSeconds: 0, caloriesBurnedEstimate: 160, instructions: 'Giữ tốc độ ổn định 5-6 km/h, đánh tay đều theo nhịp bước.' },
        ],
      },
      {
        dayName: 'Thứ 4',
        focus: 'Nghỉ ngơi phục hồi cơ thể (Rest Day)',
        estimatedMinutes: 10,
        exercises: [
          { name: 'Giãn cơ toàn thân nhẹ nhàng', targetMuscle: 'Toàn thân', sets: 1, repsOrDuration: '10 phút', restSeconds: 0, caloriesBurnedEstimate: 20, instructions: 'Kéo giãn cơ đùi trước, đùi sau, vai và hông.' },
        ],
      },
      {
        dayName: 'Thứ 5',
        focus: 'Thân dưới & Đốt calo HIIT nhẹ',
        estimatedMinutes: 25,
        exercises: [
          { name: 'Glute Bridge (Nâng mông)', targetMuscle: 'Cơ mông, Đùi sau', sets: 3, repsOrDuration: '15 lần', restSeconds: 40, caloriesBurnedEstimate: 35, instructions: 'Nằm ngửa gập gối, ấn gót chân nâng hông lên cao, siết chặt cơ mông 1 giây ở đỉnh.' },
          { name: 'Jumping Jacks (Nhảy dang tay chân)', targetMuscle: 'Cardio, Toàn thân', sets: 3, repsOrDuration: '30 giây', restSeconds: 45, caloriesBurnedEstimate: 50, instructions: 'Nhảy dang 2 chân và vỗ 2 tay lên cao, tiếp đất bằng nửa bàn chân trước.' },
          { name: 'Mountain Climbers (Leo núi tại chỗ)', targetMuscle: 'Bụng, Vai, Tim mạch', sets: 3, repsOrDuration: '20 lần mỗi chân', restSeconds: 45, caloriesBurnedEstimate: 45, instructions: 'Vào tư thế chống đẩy, luân phiên kéo đầu gối về phía ngực nhịp nhàng.' },
        ],
      },
      {
        dayName: 'Thứ 6',
        focus: 'Cardio đốt mỡ & Thư giãn',
        estimatedMinutes: 30,
        exercises: [
          { name: 'Đi bộ dốc nhẹ hoặc Chạy bước nhỏ', targetMuscle: 'Tim mạch', sets: 1, repsOrDuration: '30 phút', restSeconds: 0, caloriesBurnedEstimate: 180, instructions: 'Duy trì nhịp tim ở vùng đốt mỡ (Zone 2: 60-70% nhịp tim tối đa).' },
        ],
      },
      {
        dayName: 'Thứ 7 & Chủ Nhật',
        focus: 'Nghỉ ngơi tự do hoặc Dạo phố cuối tuần',
        estimatedMinutes: 0,
        exercises: [],
      },
    ],
  },

  // =========================================================================
  // 2. LỊCH TẬP KHÁNG LỰC TĂNG CƠ / TĂNG CÂN (GYM WORKOUT - PUSH PULL LEGS)
  // Phù hợp người gầy (BMI < 18.5) hoặc người muốn tăng cơ bắp
  // =========================================================================
  {
    id: 'workout-gain-gym-ppl',
    goal: GoalType.GAIN_WEIGHT,
    level: WorkoutLevel.INTERMEDIATE,
    title: 'Giáo án Gym Push - Pull - Legs tăng cơ toàn diện 4 buổi/tuần',
    description: 'Giáo án kinh điển kích thích phì đại cơ bắp (Hypertrophy), kết hợp các bài tập đa khớp (Compound) giúp tăng cân và phát triển hình thể cơ bắp mạnh mẽ.',
    suitableForBmi: 'Người gầy / Thiếu cân / Chuẩn (BMI 17 - 22.9)',
    weeklySchedule: [
      {
        dayName: 'Thứ 2: Push (Ngực - Vai - Tay sau)',
        focus: 'Phát triển nhóm cơ đẩy phía trước',
        estimatedMinutes: 50,
        exercises: [
          { name: 'Barbell Bench Press (Đẩy ngực ngang đòn tạ)', targetMuscle: 'Ngực giữa', sets: 4, repsOrDuration: '8-10 reps', restSeconds: 90, caloriesBurnedEstimate: 90, instructions: 'Hạ đòn tạ chậm rãi có kiểm soát vào giữa ngực, đẩy dứt khoát lên trên.' },
          { name: 'Incline Dumbbell Press (Đẩy ngực trên tạ đơn)', targetMuscle: 'Ngực trên', sets: 3, repsOrDuration: '10-12 reps', restSeconds: 75, caloriesBurnedEstimate: 70, instructions: 'Ghế dốc 30-45 độ, mở rộng lồng ngực khi hạ tạ.' },
          { name: 'Dumbbell Shoulder Press (Đẩy vai qua đầu)', targetMuscle: 'Vai trước & Vai giữa', sets: 3, repsOrDuration: '10-12 reps', restSeconds: 75, caloriesBurnedEstimate: 60, instructions: 'Giữ lưng thẳng áp sát ghế, đẩy tạ hướng lên trên.' },
          { name: 'Triceps Rope Pushdown (Kéo cáp tay sau)', targetMuscle: 'Tay sau (Triceps)', sets: 3, repsOrDuration: '12-15 reps', restSeconds: 60, caloriesBurnedEstimate: 45, instructions: 'Khóa chặt khuỷu tay cạnh sườn, duỗi thẳng tay ép cơ tay sau.' },
        ],
      },
      {
        dayName: 'Thứ 3: Pull (Lưng xô - Tay trước)',
        focus: 'Phát triển độ dày và độ rộng lưng xô',
        estimatedMinutes: 50,
        exercises: [
          { name: 'Lat Pulldown (Kéo xô máy cáp)', targetMuscle: 'Lưng xô (Lats)', sets: 4, repsOrDuration: '10-12 reps', restSeconds: 75, caloriesBurnedEstimate: 80, instructions: 'Ưỡn ngực, kéo thanh bar về phía xương quai xanh, siết cơ xô.' },
          { name: 'Seated Cable Row (Kéo cáp ngồi chèo thuyền)', targetMuscle: 'Lưng giữa & Cầu vai', sets: 3, repsOrDuration: '10-12 reps', restSeconds: 75, caloriesBurnedEstimate: 75, instructions: 'Giữ lưng thẳng, kéo tay cầm sát bụng, ép hai bả vai vào nhau.' },
          { name: 'Dumbbell Bicep Curl (Cuốn tạ tay trước)', targetMuscle: 'Tay trước (Biceps)', sets: 3, repsOrDuration: '12 reps', restSeconds: 60, caloriesBurnedEstimate: 45, instructions: 'Gồng cơ bắp tay trước nâng tạ lên, hạ xuống chậm 2 giây.' },
        ],
      },
      {
        dayName: 'Thứ 4',
        focus: 'Nghỉ ngơi phục hồi (Nạp đủ dinh dưỡng & ngủ đủ 8 tiếng)',
        estimatedMinutes: 0,
        exercises: [],
      },
      {
        dayName: 'Thứ 5: Legs & Abs (Chân đùi & Cơ bụng)',
        focus: 'Xây dựng thân dưới vững chắc và cơ lõi',
        estimatedMinutes: 55,
        exercises: [
          { name: 'Barbell Back Squat / Leg Press', targetMuscle: 'Đùi trước, Mông', sets: 4, repsOrDuration: '8-10 reps', restSeconds: 90, caloriesBurnedEstimate: 120, instructions: 'Hạ hông sâu đến khi đùi song song mặt đất, đẩy gót chân đứng dậy.' },
          { name: 'Romanian Deadlift (RDL với tạ đơn)', targetMuscle: 'Đùi sau, Mông', sets: 3, repsOrDuration: '10-12 reps', restSeconds: 75, caloriesBurnedEstimate: 80, instructions: 'Đẩy hông ra sau, giữ lưng thẳng tuyệt đối, cảm nhận căng cơ đùi sau.' },
          { name: 'Hanging Leg Raise (Treo người co gối gập bụng)', targetMuscle: 'Cơ bụng dưới', sets: 3, repsOrDuration: '12-15 reps', restSeconds: 60, caloriesBurnedEstimate: 40, instructions: 'Treo trên xà đơn, dùng cơ bụng cuộn gối lên ngang ngực.' },
        ],
      },
      {
        dayName: 'Thứ 6: Upper Body Focus (Thân trên tổng hợp)',
        focus: 'Kích thích tăng cơ thân trên lần 2 trong tuần',
        estimatedMinutes: 45,
        exercises: [
          { name: 'Dumbbell Chest Fly (Banh ngực tạ đơn)', targetMuscle: 'Ngực', sets: 3, repsOrDuration: '12 reps', restSeconds: 60, caloriesBurnedEstimate: 50, instructions: 'Mở rộng hai tay sang ngang hình cánh cung, cảm nhận ngực căng tối đa.' },
          { name: 'Dumbbell Lateral Raise (Dang tạ vai bên)', targetMuscle: 'Vai giữa (Tạo vai rộng)', sets: 4, repsOrDuration: '15 reps', restSeconds: 60, caloriesBurnedEstimate: 40, instructions: 'Nâng tạ sang hai bên ngang vai, giữ cổ tay thấp hơn khuỷu tay.' },
          { name: 'Face Pull (Kéo cáp mặt)', targetMuscle: 'Vai sau & Lưng trên', sets: 3, repsOrDuration: '15 reps', restSeconds: 60, caloriesBurnedEstimate: 40, instructions: 'Kéo dây thừng về ngang mắt, xoay mở khớp vai ra sau.' },
        ],
      },
      {
        dayName: 'Thứ 7 & Chủ Nhật',
        focus: 'Nghỉ ngơi tái tạo sợi cơ',
        estimatedMinutes: 0,
        exercises: [],
      },
    ],
  },

  // =========================================================================
  // 3. LỊCH TẬP DUY TRÌ SỨC KHỎE & VÓC DÁNG (FITNESS & HEALTHY - ALL LEVELS)
  // =========================================================================
  {
    id: 'workout-maintain-fullbody',
    goal: GoalType.MAINTAIN,
    level: WorkoutLevel.BEGINNER,
    title: 'Lộ trình Full-Body duy trì sức khỏe & săn chắc vóc dáng 3 ngày/tuần',
    description: 'Chương trình rèn luyện toàn diện kết hợp giữa rèn luyện sức mạnh và tim mạch, giúp cơ thể linh hoạt, tinh thần sảng khoái và vóc dáng cân đối.',
    suitableForBmi: 'Thể trạng bình thường (BMI 18.5 - 22.9)',
    weeklySchedule: [
      {
        dayName: 'Thứ 2',
        focus: 'Full Body Circuit A',
        estimatedMinutes: 35,
        exercises: [
          { name: 'Squat kết hợp Nâng gối', targetMuscle: 'Chân đùi & Bụng', sets: 3, repsOrDuration: '15 reps', restSeconds: 45, caloriesBurnedEstimate: 50, instructions: 'Squat xuống, khi đứng lên nâng cao 1 đầu gối chạm cùi chỏ đối diện.' },
          { name: 'Chống đẩy (Push-up)', targetMuscle: 'Ngực, Vai, Tay sau', sets: 3, repsOrDuration: '10-15 reps', restSeconds: 45, caloriesBurnedEstimate: 45, instructions: 'Giữ thân người thành 1 đường thẳng tắp.' },
          { name: 'Plank xoay hông', targetMuscle: 'Cơ liên sườn', sets: 3, repsOrDuration: '20 lần xoay', restSeconds: 45, caloriesBurnedEstimate: 35, instructions: 'Ở tư thế plank, nhẹ nhàng xoay hông chạm nhẹ sang trái rồi sang phải.' },
        ],
      },
      {
        dayName: 'Thứ 4',
        focus: 'Chạy bộ / Đạp xe ngoài trời',
        estimatedMinutes: 35,
        exercises: [
          { name: 'Chạy bộ nhịp độ vừa phải (Jogging)', targetMuscle: 'Tim mạch & Chân', sets: 1, repsOrDuration: '30 phút', restSeconds: 0, caloriesBurnedEstimate: 220, instructions: 'Chạy duy trì tốc độ trò chuyện thoải mái, hít thở sâu bằng bụng.' },
        ],
      },
      {
        dayName: 'Thứ 6',
        focus: 'Full Body Circuit B',
        estimatedMinutes: 35,
        exercises: [
          { name: 'Lunges (Chùng chân bước tới)', targetMuscle: 'Đùi trước, Mông', sets: 3, repsOrDuration: '12 reps mỗi chân', restSeconds: 45, caloriesBurnedEstimate: 55, instructions: 'Bước 1 chân dài về trước, hạ gối sau gần chạm sàn góc 90 độ.' },
          { name: 'Dips ghế (Chống đẩy tay sau)', targetMuscle: 'Tay sau', sets: 3, repsOrDuration: '12-15 reps', restSeconds: 45, caloriesBurnedEstimate: 40, instructions: 'Dùng mép ghế tựa tay, hạ hông vuông góc rồi dùng lực tay sau đẩy lên.' },
          { name: 'Bicycle Crunch (Gập bụng đạp xe)', targetMuscle: 'Cơ bụng toàn phần', sets: 3, repsOrDuration: '20 reps', restSeconds: 45, caloriesBurnedEstimate: 40, instructions: 'Nằm ngửa, luân phiên co gối chạm cùi chỏ đối diện như đạp xe.' },
        ],
      },
    ],
  },
];
