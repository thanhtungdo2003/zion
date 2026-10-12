# Đăng nhập Google, Facebook và liên kết tài khoản

Máy chủ chạy migration `015_social_accounts.sql` qua cơ chế migrate hiện có. Migration thêm bảng danh tính, giữ nguyên UUID tài khoản, nhân vật, túi đồ, Coin, đội nhóm và tiến độ. Không cần chuyển dữ liệu người chơi.

Tài khoản mới đăng ký bằng Google/Facebook; `/api/auth/register` không còn tạo tài khoản mật khẩu. Tài khoản mật khẩu cũ vẫn đăng nhập được. Tài khoản khách vẫn yêu cầu tên hợp lệ (có gợi ý ngẫu nhiên và nút đổi tên gợi ý).

Người đang đăng nhập mở mục tài khoản ở menu để liên kết Google/Facebook. Tài khoản khách cũ được mở mục này khi quay về menu. Liên kết dùng UUID từ phiên đã xác thực, không ghép theo tên hoặc email. Mỗi nhân vật có tối đa một Google và một Facebook; một danh tính không thể gắn vào hai nhân vật. Không hỗ trợ gỡ liên kết trong phiên bản này.

## Cấu hình máy chủ

Đặt trong môi trường của **server**, không đưa secret vào biến `NEXT_PUBLIC_`, repository hoặc mã frontend:

```dotenv
PUBLIC_API_URL=https://api.example.com
PUBLIC_WEB_URL=https://game.example.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
CORS_ORIGINS=https://game.example.com
COOKIE_SECURE=true
```

`PUBLIC_API_URL` là URL bên ngoài trỏ tới server, có thể cùng tên miền với web nếu reverse proxy `/api`. `PUBLIC_WEB_URL` là trang menu. Cả hai không có đường dẫn hoặc query. `NEXT_PUBLIC_API_URL` ở web phải trỏ cùng API. Cookie phiên hiện tại dùng SameSite=Strict: web và API cần cùng site, ví dụ hai subdomain cùng domain; môi trường local dùng localhost cho cả hai. Dùng Redis khi chạy nhiều instance để chia sẻ state OAuth dùng một lần.

### Google

Trong Google Cloud Console, cấu hình OAuth consent screen và tạo OAuth client loại **Web application**. Thêm redirect URI chính xác:

```text
https://api.example.com/api/auth/oauth/google/callback
```

Local: `http://localhost:4000/api/auth/oauth/google/callback`. Luồng chỉ yêu cầu `openid profile`, xác thực ID token có chữ ký, issuer, audience và nonce; sử dụng PKCE.

### Facebook

Trong Meta for Developers, tạo app có Facebook Login, cấu hình web và thêm **Valid OAuth Redirect URI**:

```text
https://api.example.com/api/auth/oauth/facebook/callback
```

Điền domain ứng dụng, URL chính sách riêng tư/xóa dữ liệu theo yêu cầu của Meta và chuyển app sang chế độ Live để người chơi ngoài nhóm phát triển đăng nhập được. App ở chế độ Development chỉ cho phép các tài khoản có vai trò/tester. Luồng chỉ yêu cầu `public_profile`, kiểm tra token thuộc đúng App ID, User ID và chưa hết hạn. Graph API dùng v23.0.

Nếu thiếu ID hoặc secret, nút tương ứng bị vô hiệu hóa; chế độ khách vẫn hoạt động khi `ALLOW_GUEST=true`.

## Kiểm tra trước khi đưa lên máy chủ thật

1. Với tài khoản khách cũ còn phiên, ghi lại tên/đồ/Coin rồi liên kết một nhà cung cấp. Đăng xuất và đăng nhập bằng nhà cung cấp đó trên trình duyệt khác: dữ liệu phải giữ nguyên.
2. Tài khoản mới đăng nhập Google/Facebook được tạo một lần; các lần sau dùng cùng nhân vật.
3. Thử hủy cấp quyền, callback hết hạn và thử liên kết danh tính đã thuộc nhân vật khác: không được đổi tài khoản hay mất dữ liệu.
4. Chơi khách: sửa tên ngẫu nhiên, thử tên trùng và tên tiếng Việt; tên trùng yêu cầu chọn lại.

Tài khoản chỉ có tên **đã mất toàn bộ phiên trình duyệt trước khi liên kết** không thể khôi phục chỉ bằng tên vì tên không chứng minh quyền sở hữu. Cần hỗ trợ quản trị có kiểm chứng riêng trong trường hợp đó.
