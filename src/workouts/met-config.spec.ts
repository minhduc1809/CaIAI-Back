import { metOf, MET_TABLE, WorkoutsService } from './workouts.service';
import { resetConfigSnapshot, setConfigSnapshot } from '../system-config/config.holder';

describe('MET theo tham số hệ thống (BR-10.5)', () => {
  afterEach(() => resetConfigSnapshot());

  it('mặc định khớp bảng MET', () => {
    for (const [cat, cfg] of Object.entries(MET_TABLE)) expect(metOf(cat as any)).toBe(cfg.met);
  });

  it('admin sửa MET thì calo buổi tập mới dùng giá trị mới', () => {
    const svc = new WorkoutsService({} as any);
    const before = svc.calculateCalories('RUNNING' as any, 60, 70); // (9.8-1)*70*1
    expect(before).toBeCloseTo(616, 0);
    setConfigSnapshot(new Map([['workout.met.RUNNING', 11]]), 1);
    expect(svc.calculateCalories('RUNNING' as any, 60, 70)).toBeCloseTo(700, 0); // (11-1)*70
    expect(svc.getCategories().find((c) => c.category === 'RUNNING')!.met).toBe(11);
  });
});
