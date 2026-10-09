# 📘 Tài Liệu Tích Hợp Backend Admin & Hướng Dẫn Xây Dựng Dashboard (Frontend Guide)

> **Dành cho:** Đội ngũ Frontend (Web Admin Console)  
> **Dự án:** NutriWise / CalAI Admin Portal  
> **Backend Base URL:** `http://localhost:3000` (hoặc domain Production)  
> **Chuẩn dữ liệu:** JSON RESTful API  
> **Xác thực:** HTTP Authorization Header: `Bearer <accessToken>`  
> **Phiên bản:** Phase 1 (Nền tảng Quản trị, Vận hành Doanh thu, Quản lý Người dùng & Audit Log - BR-17)

---

## 📑 MỤC LỤC
1. [Nguyên Tắc Chung & Phân Quyền (Security & Privacy)](#1-nguyên-tắc-chung--phân-quyền)
2. [Chi Tiết Đặc Tả Tất Cả API Backend Admin](#2-chi-tiết-đặc-tả-tất-cả-api-backend-admin)
   - [Nhóm 1: Xác Thực & Đăng Nhập Admin (`/admin/auth`)](#nhóm-1-xác-thực--đăng-nhập-admin-adminauth)
   - [Nhóm 2: Thống Kê Tổng Quan & KPI (`/admin/dashboard`)](#nhóm-2-thống-kê-tổng-quan--kpi-admindashboard)
   - [Nhóm 3: Quản Lý Người Dùng & Billing (`/admin/users`)](#nhóm-3-quản-lý-người-dùng--billing-adminusers)
   - [Nhóm 4: Vận Hành Doanh Thu & Đơn VietQR (`/admin/payments`)](#nhóm-4-vận-hành-doanh-thu--đơn-vietqr-adminpayments)
   - [Nhóm 5: Cấp & Thu Hồi Gói Premium Thủ Công (`/admin/billing`)](#nhóm-5-cấp--thu-hồi-gói-premium-thủ-công-adminbilling)
   - [Nhóm 6: Nhật Ký Kiểm Toán Bất Biến (`/admin/audit-logs`)](#nhóm-6-nhật-ký-kiểm-toán-bất-biến-adminaudit-logs)
3. [Gợi Ý Thiết Kế Giao Diện (UI/UX Design System)](#3-gợi-ý-thiết-kế-giao-diện-uiux-design-system)
4. [Gợi Ý Kiến Trúc Biểu Đồ Dashboard (Charts Blueprint)](#4-gợi-ý-kiến-trúc-biểu-đồ-dashboard-charts-blueprint)
5. [Mã Lỗi Hệ Thống & Lưu Ý Triển Khai (Error Handling & Best Practices)](#5-mã-lỗi-hệ-thống--lưu-ý-triển-khai)

---

## 1. NGUYÊN TẮC CHUNG & PHÂN QUYỀN

### 🔒 1.1. Phân Quyền Nghiêm Ngặt (Role Isolation)
- Tất cả các endpoint quản trị (ngoại trừ `POST /admin/auth/login`) đều yêu cầu Header:
  ```http
  Authorization: Bearer <accessToken>
  ```
- Backend sử dụng `AdminAuthGuard`. Nếu token thuộc user có `role: "USER"`, hệ thống sẽ trả về **`403 Forbidden`** với thông báo `"Chỉ quản trị viên (ADMIN) mới có quyền truy cập"`.
- FE nên có Router Guard (Private Route) kiểm tra `user.role === 'ADMIN'`.

### 🛡️ 1.2. Bảo Vệ Dữ Liệu Riêng Tư Người Dùng (BR-17.1)
- **Tuyệt đối tuân thủ tiêu chuẩn bảo mật dữ liệu y tế/sức khỏe:** Admin Console phục vụ vận hành kinh doanh, hỗ trợ kỹ thuật và kiểm soát gian lận, **KHÔNG PHẢI** công cụ giám sát cá nhân.
- Các API quản trị **không trả về** và **không lưu trữ** trên giao diện:
  - Cân nặng, chiều cao, chỉ số BMI/BMR/TDEE của người dùng.
  - Nhật ký bữa ăn, hình ảnh món ăn đã chụp, nội dung chat với AI.
- FE không thiết kế màn hình soi bữa ăn của người dùng nhằm đảm bảo tuân thủ pháp lý & quyền riêng tư.

### ⏳ 1.3. Cơ Chế Chống Brute-force & Thời Hạn Token
- Đăng nhập sai 5 lần liên tiếp sẽ bị **khóa tạm 15 phút** (`400 Bad Request` kèm thông báo số phút còn lại).
- `accessToken`: Hết hạn sau **15 phút**.
- `refreshToken`: Hết hạn sau **8 giờ**.

---

## 2. CHI TIẾT ĐẶC TẢ TẤT CẢ API BACKEND ADMIN

### NHÓM 1: XÁC THỰC & ĐĂNG NHẬP ADMIN (`/admin/auth`)

#### 1. Đăng nhập Admin
- **Method:** `POST`
- **Path:** `/admin/auth/login`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "usernameOrEmail": "admin@calai.com",
    "password": "Admin@123456"
  }
  ```
- **Validation:**
  - `usernameOrEmail`: Bắt buộc, chuỗi string.
  - `password`: Bắt buộc, chuỗi string $\ge 6$ ký tự.
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Đăng nhập quản trị thành công",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "admin": {
      "id": "15c03441-3491-48b4-bcc8-439d4dacdd9f",
      "email": "admin@calai.com",
      "username": "admin",
      "name": "System Administrator",
      "role": "ADMIN"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `"Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 15 phút"` hoặc `"Email hoặc mật khẩu không chính xác"`.
  - `403 Forbidden`: `"Tài khoản không có quyền quản trị viên"`.

#### 2. Lấy thông tin tài khoản Admin hiện tại
- **Method:** `GET`
- **Path:** `/admin/auth/me`
- **Auth:** `Bearer <accessToken>`
- **Success Response (`200 OK`):**
  ```json
  {
    "id": "15c03441-3491-48b4-bcc8-439d4dacdd9f",
    "email": "admin@calai.com",
    "username": "admin",
    "name": "System Administrator",
    "role": "ADMIN"
  }
  ```

---

### NHÓM 2: THỐNG KÊ TỔNG QUAN & KPI (`/admin/dashboard`)

#### Lấy chỉ số KPI tổng quan thời gian thực
- **Method:** `GET`
- **Path:** `/admin/dashboard/summary`
- **Auth:** `Bearer <accessToken>`
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Lấy dữ liệu tổng quan quản trị thành công",
    "data": {
      "users": {
        "total": 1250,
        "newLast7Days": 84,
        "newLast30Days": 312
      },
      "subscriptions": {
        "activePremiums": 142
      },
      "orders": {
        "pending": 8,
        "paid": 320
      },
      "revenue": {
        "totalVnd": 45600000
      }
    }
  }
  ```
- **Gợi ý hiển thị FE:** Dùng hiển thị hàng 4 thẻ KPI Card đầu trang (Total Users, Active Premium, Pending Orders, Total Revenue VND).

---

### NHÓM 3: QUẢN LÝ NGƯỜI DÙNG & BILLING (`/admin/users`)

#### 1. Danh sách người dùng (Tìm kiếm & Phân trang)
- **Method:** `GET`
- **Path:** `/admin/users`
- **Auth:** `Bearer <accessToken>`
- **Query Parameters:**
  - `page`: Số trang (number, mặc định `1`).
  - `limit`: Số bản ghi mỗi trang (number, mặc định `20`, tối đa `100`).
  - `search`: Từ khóa tìm kiếm theo `email`, `username`, `name` (string, optional).
  - `role`: Lọc theo quyền: `"USER"` hoặc `"ADMIN"` (optional).
  - `isPremium`: Lọc trạng thái gói `"true"` hoặc `"false"` (optional).
- **Ví dụ gọi:** `/admin/users?page=1&limit=20&search=nguyen&isPremium=true`
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Lấy danh sách người dùng thành công",
    "data": [
      {
        "id": "u-001",
        "email": "user@example.com",
        "username": "user01",
        "name": "Nguyễn Văn A",
        "role": "USER",
        "isActive": true,
        "isEmailVerified": true,
        "dailyAiQuota": 10,
        "purchasedAiQuota": 50,
        "createdAt": "2026-09-01T08:00:00.000Z",
        "isPremium": true,
        "subscriptionState": {
          "status": "ACTIVE",
          "expiryTime": "2026-11-01T00:00:00.000Z",
          "productId": "premium_monthly",
          "autoRenewing": true
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1250,
      "totalPages": 63
    }
  }
  ```

#### 2. Chi tiết lịch sử nạp tiền & gói cước của User
- **Method:** `GET`
- **Path:** `/admin/users/:id/billing`
- **Auth:** `Bearer <accessToken>`
- **Path Param:** `:id` (User ID)
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Lấy thông tin tài chính người dùng thành công",
    "data": {
      "user": {
        "id": "u-001",
        "email": "user@example.com",
        "username": "user01",
        "name": "Nguyễn Văn A",
        "isPremium": true
      },
      "subscription": {
        "status": "ACTIVE",
        "expiryTime": "2026-11-01T00:00:00.000Z",
        "productId": "premium_monthly",
        "autoRenewing": true
      },
      "orders": [
        {
          "id": "order-123",
          "orderCode": "NW987ABC",
          "amount": 59000,
          "status": "PAID",
          "itemSku": "premium_1m",
          "createdAt": "2026-10-01T10:00:00.000Z",
          "paidAt": "2026-10-01T10:05:00.000Z"
        }
      ],
      "manualGrants": [
        {
          "id": "grant-001",
          "startsAt": "2026-09-15T00:00:00.000Z",
          "endsAt": "2026-09-22T00:00:00.000Z",
          "reason": "Đền bù lỗi gián đoạn dịch vụ Vision AI ngày 14/09",
          "revokedAt": null,
          "createdAt": "2026-09-15T09:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### NHÓM 4: VẬN HÀNH DOANH THU & ĐƠN VIETQR (`/admin/payments`)

#### 1. Danh sách đơn thanh toán VietQR
- **Method:** `GET`
- **Path:** `/admin/payments/orders`
- **Auth:** `Bearer <accessToken>`
- **Query Parameters:**
  - `page`: Số trang (mặc định `1`).
  - `limit`: Số bản ghi (mặc định `20`).
  - `status`: Lọc theo trạng thái (`PENDING`, `PAID`, `CANCELLED`, `FAILED`, `EXPIRED`).
  - `search`: Tìm theo mã đơn `orderCode` hoặc `userId`.
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Lấy danh sách đơn thanh toán thành công",
    "data": [
      {
        "id": "99f8d1e2-b3c4-4d5e-8f6a-112233445566",
        "orderCode": "NWA1B2C3D4",
        "userId": "u-001",
        "amount": 59000,
        "currency": "VND",
        "status": "PENDING",
        "itemSku": "premium_1m",
        "userNote": "Nap goi 1 thang",
        "paidAmount": 0,
        "paidAt": null,
        "createdAt": "2026-10-09T14:00:00.000Z",
        "user": {
          "email": "user@example.com",
          "name": "Nguyễn Văn A"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 328,
      "totalPages": 17
    }
  }
  ```

#### 2. Duyệt đơn nạp tiền thủ công (Kích hoạt Premium)
- **Method:** `POST`
- **Path:** `/admin/payments/orders/:id/approve`
- **Auth:** `Bearer <accessToken>`
- **Tác vụ nghiệp vụ:** 
  - Kích hoạt gói tương ứng SKU đơn hàng.
  - Tự động cộng dồn ngày nếu user đang có gói còn hạn.
  - Chuyển trạng thái đơn sang `PAID`.
  - Tự động ghi nhận `AdminAuditLog` với `action: "APPROVE_PAYMENT"`.
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Duyệt đơn thanh toán và kích hoạt gói thành công",
    "order": {
      "id": "99f8d1e2-b3c4-4d5e-8f6a-112233445566",
      "orderCode": "NWA1B2C3D4",
      "status": "PAID",
      "paidAt": "2026-10-09T14:15:00.000Z"
    }
  }
  ```

#### 3. Từ chối / Hủy đơn nạp tiền
- **Method:** `POST`
- **Path:** `/admin/payments/orders/:id/reject`
- **Auth:** `Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "reason": "Khách chuyển khoản sai số tài khoản hoặc đơn quá hạn 24h"
  }
  ```
- **Validation:** `reason` bắt buộc, chuỗi string $\ge 5$ ký tự.
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Từ chối và hủy đơn thanh toán thành công",
    "order": {
      "id": "99f8d1e2-b3c4-4d5e-8f6a-112233445566",
      "orderCode": "NWA1B2C3D4",
      "status": "CANCELLED"
    }
  }
  ```

---

### NHÓM 5: CẤP & THU HỒI GÓI PREMIUM THỦ CÔNG (`/admin/billing`)

#### 1. Cấp ngày Premium thủ công (Đền bù/Hỗ trợ sự cố - BR-17.3)
- **Method:** `POST`
- **Path:** `/admin/billing/grant`
- **Auth:** `Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "userId": "u-001",
    "days": 14,
    "reason": "Đền bù lỗi OCR gián đoạn ngày 09/10/2026"
  }
  ```
- **Ràng buộc nghiệp vụ quan trọng:**
  - `days`: Số nguyên từ **1 đến 90 ngày** (cấm cấp vượt quá 90 ngày).
  - `reason`: Bắt buộc nhập giải trình **tối thiểu 10 ký tự** (phục vụ đối soát kiểm toán).
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Cấp gói Premium thủ công thành công",
    "grant": {
      "id": "grant-789",
      "userId": "u-001",
      "startsAt": "2026-10-09T14:00:00.000Z",
      "endsAt": "2026-10-23T14:00:00.000Z",
      "reason": "Đền bù lỗi OCR gián đoạn ngày 09/10/2026",
      "grantedByAdminId": "15c03441-3491-48b4-bcc8-439d4dacdd9f"
    }
  }
  ```

#### 2. Thu hồi gói Premium đã cấp
- **Method:** `POST`
- **Path:** `/admin/billing/revoke`
- **Auth:** `Bearer <accessToken>`
- **Request Body:**
  ```json
  {
    "grantId": "grant-789",
    "reason": "Cấp nhầm tài khoản, thu hồi theo yêu cầu"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Thu hồi gói Premium thủ công thành công",
    "grant": {
      "id": "grant-789",
      "revokedAt": "2026-10-09T14:30:00.000Z",
      "revokedReason": "Cấp nhầm tài khoản, thu hồi theo yêu cầu"
    }
  }
  ```

---

### NHÓM 6: NHẬT KÝ KIỂM TOÁN BẤT BIẾN (`/admin/audit-logs`)

#### Lấy danh sách lịch sử thao tác của Quản trị viên
- **Method:** `GET`
- **Path:** `/admin/audit-logs`
- **Auth:** `Bearer <accessToken>`
- **Query Parameters:**
  - `page`: Số trang (mặc định `1`).
  - `limit`: Số bản ghi (mặc định `20`).
  - `adminId`: Lọc theo ID của một Admin cụ thể.
  - `action`: Lọc theo loại thao tác (`LOGIN`, `APPROVE_PAYMENT`, `REJECT_PAYMENT`, `GRANT_PREMIUM`, `REVOKE_PREMIUM`).
  - `targetType`: Lọc theo đối tượng tác động (`User`, `PaymentOrder`, `ManualGrant`).
- **Success Response (`200 OK`):**
  ```json
  {
    "message": "Lấy danh sách nhật ký kiểm toán thành công",
    "data": [
      {
        "id": "audit-001",
        "adminId": "15c03441-3491-48b4-bcc8-439d4dacdd9f",
        "adminEmail": "admin@calai.com",
        "action": "APPROVE_PAYMENT",
        "targetType": "PaymentOrder",
        "targetId": "order-123",
        "before": { "status": "PENDING" },
        "after": { "status": "PAID" },
        "reason": null,
        "ipAddress": "192.168.1.10",
        "userAgent": "Mozilla/5.0 ... Chrome/129.0",
        "createdAt": "2026-10-09T14:15:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 450,
      "totalPages": 23
    }
  }
  ```

---

## 3. GỢI Ý THIẾT KẾ GIAO DIỆN (UI/UX DESIGN SYSTEM)

### 🎨 3.1. Bảng Màu Khuyến Nghị (Dark / Slate Operations Console)
Giao diện Admin nên mang phong cách hiện đại, thanh lịch, rõ ràng, không sử dụng màu sắc quá rực rỡ để tránh mỏi mắt cho nhân viên vận hành:

| Tên Màu | Giá Trị Hex / CSS Token | Ứng Dụng |
| :--- | :--- | :--- |
| **Primary (Brand Mint)** | `#10B981` (`emerald-500`) | Nút CTA chính, trạng thái PAID/Active, tỉ lệ tích cực |
| **Primary Hover** | `#059669` (`emerald-600`) | Hover nút bấm, line chart accent |
| **Dark Background** | `#0F172A` (`slate-900`) | Nền tổng thể trang Dashboard |
| **Card Surface** | `#1E293B` (`slate-800`) | Nền thẻ Widget, bảng dữ liệu, Drawer modal |
| **Border / Divider** | `#334155` (`slate-700`) | Đường kẻ bảng, viền card tinh tế |
| **Warning / Pending** | `#F59E0B` (`amber-500`) | Trạng thái PENDING, cảnh báo khoá tạm |
| **Danger / Failed** | `#EF4444` (`red-500`) | Nút Huỷ/Thu hồi, trạng thái FAILED/CANCELLED |
| **Text Primary** | `#F8FAFC` (`slate-50`) | Tiêu đề chính, số liệu KPI to đậm |
| **Text Muted** | `#94A3B8` (`slate-400`) | Nhãn phụ, thời gian timestamp, chú thích nhỏ |

### 📐 3.2. Cấu Trúc Bố Cục Trang (Information Architecture)
1. **Sidebar Navigation (Trái - 240px cố định):**
   - Logo CalAI / NutriWise Admin
   - Menu Items:
     - 📊 **Tổng quan (Dashboard)**
     - 💳 **Quản lý Đơn VietQR (Orders)** *(Kèm badge đỏ đếm số đơn Pending)*
     - 👥 **Người dùng (Users)**
     - 🎁 **Cấp Gói Thủ công (Grants)**
     - 🛡️ **Nhật ký Kiểm toán (Audit Logs)**
   - Bottom Profile: Tên Admin, Avatar, Nút Logout
2. **Top Bar Header:**
   - Breadcrumb đường dẫn
   - Thanh tìm kiếm nhanh toàn cục
   - Nút Refresh dữ liệu tức thì (Polling / Manual Refresh)
3. **Main Content Area:**
   - Hàng Thẻ KPI (KPI Metric Cards)
   - Khung Đồ Thị Trực Quan (Charts Section)
   - Bảng Dữ Liệu Tác Nghiệp (Actionable Data Tables)

---

## 4. GỢI Ý KIẾN TRÚC BIỂU ĐỒ DASHBOARD (CHARTS BLUEPRINT)

Dựa trên thư viện trực quan hoá dữ liệu hiện đại (khuyến nghị **Recharts**, **Chart.js** hoặc **Apache ECharts**), đây là 5 biểu đồ trọng tâm cho trang Dashboard:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ADMIN DASHBOARD OVERVIEW                        │
├──────────────┬──────────────┬──────────────┬────────────────────────────────┤
│ 👥 Tổng User │ ✨ Premium   │ ⏳ Đơn Chờ   │ 💰 Doanh Thu VietQR            │
│    1,250     │   142 (11%)  │    8 ĐƠN     │    45,600,000 đ                │
├──────────────┴──────────────┴──────────────┴────────────────────────────────┤
│ [BIỂU ĐỒ 1: Xu Hướng Doanh Thu 30 Ngày]   [BIỂU ĐỒ 2: Tỷ Lệ Gói & Chuyển Đổi]│
│ (Spline Area Chart - Thu nhập & Lượng đơn)│ (Donut / Gauge Chart - Free vs Pro)│
├───────────────────────────────────────────┬─────────────────────────────────┤
│ [BIỂU ĐỒ 3: Trạng Thái Đơn VietQR]        │ [BIỂU ĐỒ 4: Tốc Độ Tăng User]   │
│ (Horizontal Stacked Bar: Paid vs Pending) │ (Grouped Bar: 7 ngày vs 30 ngày)│
└───────────────────────────────────────────┴─────────────────────────────────┘
```

### 📈 Biểu Đồ 1: Xu Hướng Doanh Thu & Dòng Tiền (Revenue & Volume Run-rate)
- **Loại biểu đồ:** **Spline Area Chart** (Đồ thị vùng dải mềm)
- **Mục đích:** Giám sát dòng tiền vào theo từng ngày và đỉnh doanh thu nạp gói.
- **Cấu hình dữ liệu:**
  - **Trục X:** Ngày trong tháng (`01/10`, `02/10`, `03/10`, ...).
  - **Trục Y (Trái):** Tổng số tiền thu được (VND - triệu đồng) - Màu xanh Mint (`#10B981`) có gradient trong suốt xuống dưới.
  - **Trục Y (Phải - phụ):** Số lượng giao dịch thành công (đơn hàng) - Đường line mỏng màu Amber (`#F59E0B`).
- **Tương tác:** Tooltip hiển thị khi hover: Ngày, tổng tiền, số đơn hoàn thành.

### 🍩 Biểu Đồ 2: Tỷ Lệ Chuyển Đổi Premium (User Tier Distribution & Conversion)
- **Loại biểu đồ:** **Half-Donut (Gauge Meter)** hoặc **Donut Chart**
- **Mục đích:** Theo dõi tỷ lệ chuyển đổi từ người dùng miễn phí sang trả phí (Conversion Rate).
- **Cấu hình dữ liệu:**
  - **Active Premium:** `data.subscriptions.activePremiums` (Màu xanh Mint `#10B981`)
  - **Free Users:** `data.users.total - data.subscriptions.activePremiums` (Màu Slate `#334155`)
- **Tâm Donut:** Hiển thị phần trăm lớn: `((activePremiums / total) * 100).toFixed(1) + "%"` kèm nhãn phụ `"Tỷ lệ chuyển đổi"`.

### 📊 Biểu Đồ 3: Trạng Thái Phân Bổ Đơn VietQR (Order Fulfillment Health)
- **Loại biểu đồ:** **Horizontal Stacked Bar** hoặc **Rounded Progress Bar**
- **Mục đích:** Nhận diện ngay số lượng đơn bị "treo" hoặc chuyển tiền sai cần hỗ trợ.
- **Phân đoạn màu sắc:**
  - `PAID` (Xanh ngọc `#10B981`): Đơn đã nhận tiền và kích hoạt tự động.
  - `PENDING` (Vàng hổ phách `#F59E0B`): Đơn đang chờ khách quét mã hoặc chờ duyệt tay.
  - `CANCELLED/EXPIRED` (Xám tro `#64748B`): Đơn hết hạn 15 phút khách không chuyển.

### 👥 Biểu Đồ 4: Tốc Độ Gia Tăng Người Dùng (Acquisition Velocity)
- **Loại biểu đồ:** **Vertical Bar Chart** (Cột đôi so sánh)
- **Mục đích:** Đánh giá độ nóng của các chiến dịch quảng cáo và người dùng mới.
- **Chỉ số:** So sánh số người đăng ký mới 7 ngày qua (`newLast7Days`) và mức trung bình theo tuần trong 30 ngày (`newLast30Days / 4.2`).

### ⏱️ Biểu Đồ 5: Luồng Hoạt Động Thao Tác Quản Trị (Admin Activity Stream)
- **Loại widget:** **Vertical Activity Timeline** (Thanh dòng thời gian có Icon)
- **Mục đích:** Xem nhanh các thao tác vừa diễn ra của các Admin.
- **Dữ liệu lấy từ:** `GET /admin/audit-logs?limit=5`
- **Màu sắc trạng thái:**
  - `APPROVE_PAYMENT`: Icon tick xanh lá + text `"Admin X vừa duyệt đơn Y"`.
  - `GRANT_PREMIUM`: Icon hộp quà tím + text `"Cấp bù 14 ngày cho User Z"`.
  - `REJECT_PAYMENT`: Icon từ chối đỏ + text `"Huỷ đơn W do quá hạn"`.

---

## 5. MÃ LỖI HỆ THỐNG & LƯU Ý TRIỂN KHAI

### ⚠️ Bảng Mã Lỗi Thường Gặp
| HTTP Status | Trường Hợp | Cách Xử Lý Phía Frontend |
| :--- | :--- | :--- |
| **`400 Bad Request`** | Dữ liệu đầu vào sai format (VD: lý do cấp gói dưới 10 ký tự, số ngày > 90) hoặc tài khoản bị khoá tạm 15 phút. | Hiển thị Toast thông báo lỗi chi tiết từ trường `message` của server. |
| **`401 Unauthorized`** | Token hết hạn 15 phút hoặc không hợp lệ. | Sử dụng Axios Interceptor gọi refresh token hoặc redirect về màn hình `/admin/login`. |
| **`403 Forbidden`** | User thường cố tình vào trang Admin. | Hiển thị trang chặn truy cập `403 Không có quyền` và xóa token. |
| **`404 Not Found`** | Không tìm thấy Order ID hoặc User ID. | Hiển thị thông báo bản ghi không còn tồn tại. |

### 💡 Khuyến Nghị Triển Khai Kỹ Thuật Cho Frontend
1. **Quản lý State & Cache:** Sử dụng **TanStack Query (React Query)** hoặc **SWR** với `staleTime: 30000` (30 giây) để dữ liệu danh sách đơn hàng tự động làm mới mượt mà.
2. **Xác nhận Thao tác Nguy Hiểm:**
   - Các hành động: **Duyệt đơn nạp**, **Từ chối đơn**, **Cấp gói bù**, **Thu hồi gói** bắt buộc mở **Confirm Modal** yêu cầu Admin xác nhận lại thông tin trước khi gửi request.
3. **Copy to Clipboard Nhanh:** Cho phép Admin bấm 1 chạm để copy `orderCode`, `userId`, `email` để tiện tra cứu trên sao kê ngân hàng.
4. **Auto-Format Tiền Tệ & Ngày Giờ:**
   - Định dạng tiền: `new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount)`
   - Định dạng ngày: `HH:mm - DD/MM/YYYY` theo giờ địa phương Việt Nam (GMT+7).
