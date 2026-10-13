/**
 * Nạp dữ liệu dev đầy đủ luồng bằng CHÍNH các API của backend (không ghi thẳng DB):
 * đăng ký -> hồ sơ -> bữa ăn từ kho món thật -> cân nặng -> nước -> buổi tập -> món tự tạo -> gửi duyệt ->
 * đơn QR (duyệt / từ chối / hủy / để chờ) -> yêu cầu dữ liệu.
 * Chạy: ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-realistic-data.js   (backend phải đang chạy)
 * Chạy lại an toàn: user đã tồn tại thì đăng nhập lại, chỉ thêm dữ liệu cho ngày chưa có bữa.
 */
const BASE = process.env.API_URL || 'http://localhost:3000/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'NutriSeed-2026';
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.error('Thiếu ADMIN_EMAIL / ADMIN_PASSWORD'); process.exit(1); }

let seed = 20261013;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const fails = {};

async function call(method, path, { token, body, quiet } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* không có body */ }
  if (!res.ok) {
    if (!quiet) {
      const k = `${method} ${path.replace(/[0-9a-f-]{20,}/g, ':id').split('?')[0]} ${res.status}`;
      if (!fails[k]) { fails[k] = 0; console.warn('  ! ' + k + ' ' + JSON.stringify(json?.message ?? json).slice(0, 200)); }
      fails[k]++;
    }
    return { ok: false, status: res.status, json };
  }
  return { ok: true, status: res.status, data: json?.data ?? json };
}

const dayKey = (offset) => {
  const d = new Date(Date.now() + 7 * 3600e3 - offset * 86400e3); // Asia/Ho_Chi_Minh
  return d.toISOString().slice(0, 10);
};

const PEOPLE = [
  { u: 'minh_anh', n: 'Nguyễn Minh Anh', g: 'FEMALE', dob: '1999-04-12', h: 160, w: 62, tw: 55, act: 'LIGHTLY_ACTIVE', goal: 'LOSE_WEIGHT' },
  { u: 'quoc_huy', n: 'Trần Quốc Huy', g: 'MALE', dob: '1996-09-03', h: 175, w: 78, tw: 72, act: 'MODERATELY_ACTIVE', goal: 'LOSE_WEIGHT' },
  { u: 'thu_ha', n: 'Lê Thu Hà', g: 'FEMALE', dob: '2001-01-25', h: 158, w: 48, tw: 52, act: 'LIGHTLY_ACTIVE', goal: 'GAIN_WEIGHT' },
  { u: 'duc_thang', n: 'Phạm Đức Thắng', g: 'MALE', dob: '1993-11-18', h: 170, w: 68, tw: 68, act: 'VERY_ACTIVE', goal: 'MAINTAIN' },
  { u: 'bao_ngoc', n: 'Vũ Bảo Ngọc', g: 'FEMALE', dob: '1998-06-30', h: 165, w: 70, tw: 60, act: 'SEDENTARY', goal: 'LOSE_WEIGHT' },
  { u: 'hoang_nam', n: 'Đỗ Hoàng Nam', g: 'MALE', dob: '2000-02-14', h: 180, w: 65, tw: 72, act: 'MODERATELY_ACTIVE', goal: 'GAIN_WEIGHT' },
  { u: 'khanh_linh', n: 'Bùi Khánh Linh', g: 'FEMALE', dob: '1995-12-08', h: 162, w: 56, tw: 54, act: 'MODERATELY_ACTIVE', goal: 'MAINTAIN' },
  { u: 'tuan_kiet', n: 'Hồ Tuấn Kiệt', g: 'MALE', dob: '1990-07-21', h: 172, w: 85, tw: 76, act: 'LIGHTLY_ACTIVE', goal: 'LOSE_WEIGHT' },
  { u: 'my_duyen', n: 'Đặng Mỹ Duyên', g: 'FEMALE', dob: '2002-03-05', h: 155, w: 50, tw: 50, act: 'LIGHTLY_ACTIVE', goal: 'MAINTAIN' },
  { u: 'gia_bao', n: 'Ngô Gia Bảo', g: 'MALE', dob: '1997-08-16', h: 168, w: 74, tw: 69, act: 'SEDENTARY', goal: 'LOSE_WEIGHT' },
];

const WORKOUTS = [
  { name: 'Đẩy ngực – vai', category: 'STRENGTH', ex: [['Đẩy ngực với tạ đòn', 60, 8], ['Đẩy vai với tạ đơn', 20, 10], ['Chống đẩy', 0, 15]] },
  { name: 'Kéo lưng – tay trước', category: 'STRENGTH', ex: [['Kéo xà', 0, 8], ['Chèo tạ đơn', 24, 10], ['Cuốn tạ tay trước', 12, 12]] },
  { name: 'Chân – mông', category: 'STRENGTH', ex: [['Squat', 70, 8], ['Rumani deadlift', 60, 10], ['Gánh đùi', 90, 12]] },
  { name: 'Chạy bộ nhẹ', category: 'RUNNING', cardio: 35 },
  { name: 'Đi bộ nhanh', category: 'WALKING', cardio: 45 },
];

async function login(identity) {
  const r = await call('POST', '/auth/login', { body: identity, quiet: true });
  return r.ok ? r.data : null;
}

async function ensureUser(p) {
  const email = `${p.u}@nutriwise.dev`;
  let auth = await login({ username: p.u, password: USER_PASSWORD });
  if (!auth) {
    const reg = await call('POST', '/auth/register', { body: { username: p.u, email, password: USER_PASSWORD, name: p.n, acceptPrivacy: true } });
    if (!reg.ok) return null;
    auth = await login({ username: p.u, password: USER_PASSWORD });
  }
  if (!auth) return null;
  const token = auth.accessToken;
  await call('PATCH', '/users/me', {
    token,
    body: { name: p.n, gender: p.g, dateOfBirth: p.dob, heightCm: p.h, weightKg: p.w, targetWeightKg: p.tw, activityLevel: p.act, goal: p.goal, macroStyle: 'BALANCED', trainingDaysPerWeek: 3, applyTarget: true },
  });
  return { ...p, token };
}

async function logMeals(user, foods) {
  const meals = await call('GET', `/meals?date=${dayKey(0)}`, { token: user.token, quiet: true });
  void meals;
  const types = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  let created = 0;
  for (let off = 13; off >= 0; off--) {
    if (rnd() < 0.15) continue; // có ngày quên ghi
    const day = dayKey(off);
    const exists = await call('GET', `/meals?date=${day}`, { token: user.token, quiet: true });
    const list = exists.data?.items ?? exists.data?.meals ?? (Array.isArray(exists.data) ? exists.data : []);
    if (list.length > 0) continue;
    const count = rnd() < 0.7 ? 3 : 4;
    for (let i = 0; i < count; i++) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => {
        const f = pick(foods);
        const q = Math.round(between(0.5, 1.5) * 2) / 2 || 1;
        return {
          name: f.name, servingSize: f.servingSize ?? '1 phần', quantity: q, calories: Math.round(f.calories), protein: f.protein, carb: f.carb, fat: f.fat,
          sourceType: 'CATALOG', sourceId: f.id,
        };
      });
      const r = await call('POST', '/meals', {
        token: user.token,
        body: { mealType: types[i], date: day, items },
      });
      if (r.ok) created++;
    }
  }
  return created;
}

async function logBody(user) {
  const have = await call('GET', '/weight-logs', { token: user.token, quiet: true });
  const hl = have.data?.items ?? (Array.isArray(have.data) ? have.data : []);
  if (hl.length > 0) return;
  let w = user.w;
  const dir = Math.sign(user.tw - user.w) || 0;
  for (let off = 28; off >= 0; off -= 7) {
    w += dir * between(0.2, 0.7) + between(-0.2, 0.2);
    await call('POST', '/weight-logs', { token: user.token, body: { weightKg: Math.round(w * 10) / 10, date: `${dayKey(off)}T00:30:00.000Z` } });
  }
  for (let i = 0; i < 6; i++) await call('POST', '/water-logs', { token: user.token, body: { amountMl: pick([250, 300, 500]) } });
}

async function logWorkouts(user) {
  let n = 0;
  for (const off of [12, 10, 8, 6, 4, 2, 1]) {
    if (rnd() < 0.35) continue;
    const t = pick(WORKOUTS);
    const body = {
      name: t.name, category: t.category, date: `${dayKey(off)}T11:00:00.000Z`, durationMinutes: t.cardio ?? Math.round(between(45, 70)),
      caloriesBurned: t.cardio ? Math.round(t.cardio * 8) : Math.round(between(220, 380)), clientRequestId: `seed-${user.u}-${off}`,
      ...(t.ex
        ? { exercises: t.ex.map(([name, kg, reps], i) => ({ name, order: i + 1, exerciseSource: 'CATALOG', sets: [1, 2, 3].map((s) => ({ setNumber: s, reps, weightKg: kg + (s - 1) * 0 })) })) }
        : { exercises: [{ name: t.name, order: 1, sets: [{ setNumber: 1, reps: 1, weightKg: 0, durationSec: t.cardio * 60 }] }] }),
    };
    if ((await call('POST', '/workouts', { token: user.token, body })).ok) n++;
  }
  return n;
}

async function main() {
  const adminAuth = (await call('POST', '/admin/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).data;
  if (!adminAuth) throw new Error('Không đăng nhập được admin');
  const admin = adminAuth.accessToken;

  const users = [];
  for (const p of PEOPLE) { const u = await ensureUser(p); if (u) users.push(u); }
  console.log(`Người dùng sẵn sàng: ${users.length}/${PEOPLE.length}`);
  if (users.length === 0) throw new Error('Không tạo được người dùng');

  const fr = await call('GET', '/recommendations/foods?limit=60', { token: users[0].token });
  const foods = (fr.data?.items ?? fr.data?.foods ?? (Array.isArray(fr.data) ? fr.data : [])).filter((f) => f.calories > 0);
  if (foods.length === 0) throw new Error('Kho món trống hoặc API trả định dạng khác');
  console.log(`Kho món dùng để ghi bữa: ${foods.length}`);

  for (const u of users) {
    const m = await logMeals(u, foods);
    await logBody(u);
    const w = await logWorkouts(u);
    console.log(`  ${u.u}: ${m} bữa, ${w} buổi tập`);
  }

  // Món tự tạo + gửi duyệt
  const customs = [['Bánh mì trứng cô Lan', 'Bánh mì', 380, 16, 42, 15], ['Cơm tấm sườn bì', 'Cơm', 720, 32, 85, 26], ['Sinh tố bơ sữa chua', 'Đồ uống', 260, 8, 28, 13], ['Bún chả Hà Nội', 'Bún - Phở', 610, 30, 70, 20]];
  let submitted = 0;
  for (let i = 0; i < customs.length; i++) {
    const [name, cat, cal, pr, cb, ft] = customs[i];
    const u = users[i % users.length];
    const c = await call('POST', '/recommendations/custom-foods', { token: u.token, body: { name, servingSize: '1 phần', calories: cal, protein: pr, carb: cb, fat: ft } });
    if (c.ok && c.data?.id && (await call('POST', '/foods/submissions', { token: u.token, body: { customFoodId: c.data.id, note: 'Món quen thuộc, mong được thêm vào kho.' } })).ok) submitted++;
  }
  console.log(`Món gửi duyệt: ${submitted}`);

  // Đơn QR: 3 duyệt, 1 từ chối, 1 hủy, 2 để chờ
  const plan = ['premium_monthly', 'premium_yearly'];
  const orders = [];
  for (let i = 0; i < 7 && i < users.length; i++) {
    const o = await call('POST', '/payments/orders', { token: users[i].token, body: { productId: plan[i % 2] } });
    if (o.ok) orders.push({ id: o.data.id ?? o.data.orderId, user: users[i] });
  }
  const P = { password: ADMIN_PASSWORD };
  let approved = 0;
  for (let i = 0; i < orders.length; i++) {
    const id = orders[i].id;
    if (!id) continue;
    if (i < 3) { if ((await call('POST', `/admin/payments/orders/${id}/approve`, { token: admin, body: P })).ok) approved++; }
    else if (i === 3) await call('POST', `/admin/payments/orders/${id}/reject`, { token: admin, body: { reason: 'Không tìm thấy giao dịch khớp nội dung chuyển khoản', ...P } });
    else if (i === 4) await call('POST', `/payments/orders/${id}/cancel`, { token: orders[i].user.token });
  }
  console.log(`Đơn QR: ${orders.length} (đã duyệt ${approved})`);

  // Yêu cầu dữ liệu (admin tạo thay người dùng đã liên hệ)
  await call('POST', '/admin/data-requests', { token: admin, body: { email: users[5]?.u ? `${users[5].u}@nutriwise.dev` : 'x@nutriwise.dev', type: 'EXPORT', note: 'Người dùng yêu cầu xuất dữ liệu qua email hỗ trợ' } });
  await call('POST', '/admin/data-requests', { token: admin, body: { email: `${users[users.length - 1].u}@nutriwise.dev`, type: 'DELETE', note: 'Người dùng yêu cầu xoá tài khoản' } });

  const bad = Object.entries(fails);
  console.log(bad.length ? '\nCác lời gọi lỗi:\n' + bad.map(([k, v]) => `  ${k} x${v}`).join('\n') : '\nKhông có lỗi API.');
}

main().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });
