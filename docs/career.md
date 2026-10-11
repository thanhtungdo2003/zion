# Quân hàm và Quân nhu

Hồ sơ thuộc tài khoản, không khóa theo world/chế độ. Người chơi chỉ nhận danh hiệu
và danh sách quà; API và WebSocket không gửi điểm, ngưỡng hay phần trăm tiến độ.

## Cân bằng mặc định

25 mốc: Tân Binh, Binh Nhì, Hạ Sĩ, Trung Sĩ, Tinh Nhuệ; mỗi danh hiệu có I–V.
Ngưỡng tăng từ 120 điểm cho sao thứ hai lên tổng 33.400 điểm cho Tinh Nhuệ V.
Nhiệm vụ hằng ngày: 35; dài hạn: 90; nhiệm vụ có tìm đồ, thăm địa điểm hoặc
diệt zombie cộng thêm 30. Nhiệm vụ đội: 100. Mười nhiệm vụ tìm đồ mới của Đại tá
cho 180–500 điểm mỗi nhiệm vụ, có chuỗi điều kiện và vật phẩm gắn với nhiệm vụ.

Chết thật sự (không phải bị hạ gục rồi được cứu) trừ `40 + bậc_sao * 8`, tối đa
232 điểm; sàn bằng 0. Có thể tụt quân hàm. Mỗi mốc thưởng chỉ cấp một lần cho
tài khoản, kể cả khi tụt hạng rồi lên lại. Tạo lại đội không làm mới điểm đã nhận
từ cùng một nhiệm vụ dài hạn hoặc cùng ngày của nhiệm vụ đội.

Studio → Quests & NPCs → Quân hàm & Quân nhu sửa được 25 ngưỡng, điểm nhiệm vụ,
phạt chết và quà từng sao. Form nhiệm vụ có điểm quân hàm riêng (0 dùng cấu hình
chung). Các chỉnh sửa không xóa quà đã cấp hoặc đặt lại mốc đã nhận.

## Quà và cấp vào Sinh tồn

Quân nhu lưu quà trong cơ sở dữ liệu, không bị giới hạn bởi kích thước kho căn cứ.
Chuột phải (hoặc bấm trên thiết bị cảm ứng) vào quà → Đưa vào Sinh tồn. ZCoin
chuyển cả kiện; vũ khí, giáp, đạn chuyển từng vật phẩm. Quà vào ví/kho căn cứ ở
lần vào game kế tiếp. Kho đầy giữ kiện ở hàng chờ để thử lại, không làm mất quà.
Định dạng đã dành sẵn loại quà skin, trang phục, ngoại hình và nhân vật; hiện
chúng được lưu/hiển thị, còn áp dụng ngoại hình cần nội dung của bản cập nhật sau.

Điểm và quà quân hàm ghi cùng giao dịch với nhiệm vụ/nhân vật. Chuyển Quân nhu
và trừ số lượng là một giao dịch. Cấp vào kho căn cứ và đánh dấu kiện đã cấp
cũng là một giao dịch. Khóa hàng và khóa sự kiện ngăn nhận trùng.

Huy hiệu là vật phẩm lưu niệm, không tự tăng quân hàm. Mỗi ô loot có 0,3% cơ hội
ra huy hiệu; trong nhóm đó tỷ lệ lần lượt 55%, 25%, 13%, 5,5%, 1,5%.
Bán cho thương nhân được 120 / 240 / 440 / 720 / 1.200 ZCoin.

## Cấp tiền trong Studio

Nút **Cấp tiền** trên thanh công cụ Studio tìm người chơi theo tên hoặc ID (bao gồm tài khoản
chưa vào Sinh tồn), hiển thị số dư và tiền đang chờ cấp. Mỗi lần cấp từ 1 đến 1.000.000 ZCoin,
có ghi chú tùy chọn. Tiền vào thẳng ví Sinh tồn; người ngoại tuyến tự nhận ở lần vào tiếp theo.
Người đang giao dịch nhận ngay sau khi giao dịch kết thúc. Giao dịch được lưu trước khi cấp,
có mã duy nhất chống cộng trùng khi thử lại, lưu người cấp/ghi chú và ghi nhật ký Studio.
Nếu ví đạt giới hạn số nguyên, tiền được giữ trong hàng chờ. Không cộng điểm quân hàm.

## Zombie và đăng nhập lại

Rời game sẽ gỡ các zombie đang nhắm hoặc đang chuẩn bị cắn người chơi đó; không
phát sự kiện chết, loot hay tiến độ nhiệm vụ. Lưu loại zombie, máu, tổn thương
và vị trí vào nhân vật. Đăng nhập lại khôi phục đúng số lượng, không nhân đôi;
chưa tải collision thì giữ hàng chờ. Nếu nhân vật phải xuất hiện quá xa vị trí
cũ, encounter được chuyển tới gần nhân vật khi ra ngoài căn cứ. Zombie đang nhắm
người khác vẫn ở lại. Số zombie sống vẫn tuân theo giới hạn của director.

## Cài đặt và kiểm thử

Chạy migration `013_account_career.sql` qua `pnpm db:migrate` trước khi chạy server,
hoặc dùng `DB_MIGRATE_ON_START=true`. Không thay đổi trực tiếp các bảng trên
server đang chạy bằng cách chép file SQL thủ công.

Kiểm thử thường: `pnpm test`, `pnpm typecheck`, `pnpm build`.
Kiểm thử PostgreSQL dùng schema tạm riêng, tự dọn sau khi chạy (PowerShell):

```powershell
$env:ZION_CAREER_INTEGRATION = '1'
node --env-file=apps/server/.env node_modules/vitest/vitest.mjs run apps/server/src/game/progression.integration.test.ts
```

Kiểm thử tích hợp yêu cầu PostgreSQL trong `apps/server/.env` đang chạy. Nó không
sửa các bảng game trong schema public.
