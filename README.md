# LC Project Tracker

Ứng dụng theo dõi task cho một project duy nhất, dùng React, Vite, Vercel Functions và Neon Postgres.

## Phân quyền

| Role | Quyền |
| --- | --- |
| Project Manager | Quản lý phase, group, task, người phụ trách, deadline, status, tài khoản và lịch sử hoàn thành |
| Contributor | Xem toàn bộ project; tick hoặc bỏ tick task được giao cho mình |
| Viewer / Client | Chỉ xem task và tiến độ |

PM có thể xem lịch sử task được hoàn thành hoặc mở lại, gồm người thực hiện, username, phase/group và thời gian. Server tự tạo log theo phiên đăng nhập; client không tự khai báo actor.

## Yêu cầu

- Node.js 20 trở lên
- pnpm 11.19.0
- Neon Postgres cho môi trường chạy đầy đủ
- Vercel để chạy frontend và các API trong `api/`

## Cài đặt và kiểm tra

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

`pnpm dev` chỉ chạy frontend Vite. Để thử cả API, dùng Vercel development runtime với các biến server-side trong `.env.example` và database test riêng.

## Cấu hình Vercel

Tạo các biến môi trường sau trong Vercel. Không dùng prefix `VITE_` vì các giá trị này chỉ dành cho server.

| Biến | Mục đích |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối Neon Postgres |
| `SESSION_SECRET` | Secret ngẫu nhiên, ít nhất 32 ký tự, dùng ký cookie |
| `BOOTSTRAP_PM_USERNAME` | Username của PM đầu tiên |
| `BOOTSTRAP_PM_PASSWORD` | Mật khẩu PM đầu tiên, từ 12–128 ký tự |

Khi `tracker_users` chưa có tài khoản, request đầu tiên sẽ tạo bảng cần thiết và tạo PM bootstrap. Sau khi đăng nhập thành công, xóa `BOOTSTRAP_PM_PASSWORD` khỏi Vercel và redeploy. PM tạo các tài khoản còn lại trong mục **Thành viên**.

Ứng dụng tạo và sử dụng ba bảng:

- `tracker_state`: dữ liệu project và version chống ghi đè đồng thời.
- `tracker_users`: tài khoản, role và password hash bằng scrypt.
- `tracker_task_history`: audit log hoàn thành/mở lại task; giữ tối đa 200 dòng mới nhất khi hiển thị.

## Deploy

1. Tạo repository GitHub và đưa toàn bộ nội dung thư mục này vào root repository.
2. Import repository vào Vercel.
3. Cấu hình bốn biến môi trường trên bằng database test trước.
4. Deploy và kiểm tra đăng nhập PM, tạo Contributor/Viewer, assign task, tick task và mục **Lịch sử**.
5. Xóa biến bootstrap password sau khi PM đầu tiên đã được tạo.

Không commit `.env`, credential, database backup hoặc dữ liệu production. Workflow trong `.github/workflows/ci.yml` tự chạy test và production build trên mỗi pull request/push.

## Giới hạn hiện tại

- Chưa có đổi/quên mật khẩu, email mời, audit thay đổi nội dung task hoặc live update.
- Chưa có rate limit đăng nhập bền vững trong database; cần cấu hình giới hạn ở hosting trước khi mở public.
- Khi có conflict version, người dùng cần tải dữ liệu mới nhất rồi thao tác lại.
