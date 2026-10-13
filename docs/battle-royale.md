# Battle Royale — Thung lũng Đỏ

Chọn Battle Royale ở menu chính. Bản đầu tiên là Solo, tối đa 32 người,
đếm ngược 30 giây khi có ít nhất 2 người. Người chơi xuất hiện ở các vị trí
tách biệt ở khu chờ trước trận. Khi bắt đầu, mọi người lên máy bay vận tải,
nhảy xuống tìm trang bị và sống sót đến cuối trận.

- Bản đồ 4096 × 4096 m, seed `zion-red-valley-02`, sinh đồng nhất trên server và client.
- Đảo có biển bao quanh, bờ vịnh và mũi đất bất quy tắc, núi đồi và thung lũng.
  Phiên bản bản đồ `red-island-03` có 150 khu: 10 thị trấn (16 nhà mỗi khu),
  12 nhà máy/công trường, 24 trang trại, 28 xóm nhỏ, 12 trại kho,
  16 tháp canh, 12 tháp nước và 36 nhà ven đường. Công trình tập trung quanh các thị trấn.
- Các thị trấn có đường nội bộ; đường liên khu bám địa hình, có đường đèo và nhánh nối thay thế.
  Trang trại có nhà ở, kho, ruộng và hàng rào. Tháp canh/tháp nước có thang leo lên sàn,
  lan can và hòm đồ. Bồn nước có lối đi vòng quanh.
- Nhà lắp từ vật liệu có thể vào trong, leo tầng để tìm hòm. Hai model
  `nha-cu-1-tang` và `nha-cu-hai-tang` là nhà trang trí kín trong thị trấn,
  có va chạm và không đặt hòm bên trong. Kích thước tương ứng khoảng
  10 × 4,8 × 8,33 m và 10 × 7,2 × 8,33 m.
- Hòm trong công trình chứa súng, đạn phù hợp, giáp, hồi máu và lựu đạn;
  không có thức ăn hay tài nguyên sinh tồn. Khi chết, toàn bộ trang bị được giữ
  trong một hòm gỗ tại vị trí ngã xuống, có thể mở bằng E để lấy đồ ngay.
  Hòm và đồ người chơi thả tồn tại đến khi được nhặt hoặc trận được dọn.
- PvP luôn bật, không hồi sinh; chat thông báo người hạ và vũ khí.
- Bo đỏ thu qua 6 giai đoạn, sát thương tăng từ 1 đến 20 HP/giây.
  Người cuối cùng thắng. Trận được đóng sau 30 giây và dọn khi mọi người rời.
- Kho đồ và tiến trình của chế độ sinh tồn không được mang vào hay ghi đè.

Máy bay bay qua bản đồ trong 55 giây ở độ cao tuyệt đối 650 m. Nhấn Space
để nhảy; người còn trên máy bay được tự thả ở cuối đường bay. Khi rơi,
WASD điều khiển hướng lướt, Shift lao xuống nhanh, Space bung dù sớm.
Dù tự bung khi còn 120 m so với địa hình và tự thu khi tiếp đất hoặc mái nhà.
Giao diện hiển thị độ cao, tốc độ, hướng và hướng dẫn phím. Model dù lượn
được dựng bằng hình học, có chuyển động bung dù. Máy bay giữ animation cánh quạt.

Nhà lắp ghép có cửa gỗ tương tác bằng E; đóng chặn đường và mở cho phép đi qua.
Tường bao kín, tầng trệt có cửa trước/sau. Tầng trên có ban công với cửa riêng
và lan can; cầu thang dẫn lên sân thượng có lan can bảo vệ.
Cửa dùng animation và âm thanh đóng/mở, đồng bộ giữa các người chơi.
Hai nhà model kín vẫn là công trình trang trí, không tạo lối vào giả.

Bản này chưa có đội và quan sát người chơi khác.

Góc TOP chỉ đánh dấu người chơi, động vật và quái trong vùng sáng có đường nhìn
không bị tường chắn. Mục tiêu ẩn sau 3 giây mất dấu. FPP/TPP không dùng lớp tối
hay giới hạn phát hiện của TOP; các vật thể vẫn che nhau theo chiều sâu bình thường.
Battle Royale mặc định FPP khi vào lần đầu; góc nhìn thay đổi được lưu riêng cho chế độ này.

Xuất ảnh bản đồ: `pnpm world:preview --mode battle-royale --mpp 8`.
Đóng gói model: `pnpm assets:build`. Cần cập nhật server và web cùng nhau
do giao thức đã nâng lên phiên bản 27.

Phương tiện dùng chung cho cả Sinh tồn và Battle Royale. Trong chat, dùng
`/vehicle car`, `/vehicle jeep`, `/vehicle quad` hoặc `/vehicle grizzly` để tạo xe
ở khoảng trống gần người chơi (mỗi lần cách nhau 3 giây). `lada` và `quadbike`
cũng được chấp nhận. Nhấn F để lên/xuống, W/S tăng tốc/phanh/lùi, A/D đánh lái.
Lên xe tự chuyển sang camera thứ ba bám sau xe, lùi xa hơn khi tăng tốc và tránh
tường. Xuống xe khôi phục góc nhìn đã chọn. Người đang ngồi xe không phát tiếng bước chân.
HUD hiển thị tốc độ và độ bền. Va chạm và đạn gây hỏng xe; khói đen tăng khi độ bền
giảm. Xe hết độ bền nổ sau 2 giây, người còn ngồi trên xe sẽ chết. Cửa sổ để hở
cho phép đạn trúng người lái. Quad dùng âm thanh motorcycle; xe còn lại dùng car.
Nhạc rock phát ngẫu nhiên sau một khoảng lái nhanh và dừng khi xuống xe.
Giữ S khi xe còn chạy tiến từ 8 m/s (khoảng 29 km/h) phát tiếng phanh; tiếng dừng khi
nhả phanh hoặc xe chậm lại. Va chạm vật lý chọn ngẫu nhiên một trong hai tiếng crash,
giảm âm theo khoảng cách và giới hạn số âm thanh đồng thời. Đạn/bom không giả lập tiếng crash.
Xe chìm vẫn xuống bằng F được: nhân vật xuất hiện cạnh xe ở cùng độ sâu và chuyển sang bơi.

Xe dùng bốn điểm treo bánh với lò xo và giảm chấn, tiếp đất trên địa hình hoặc mặt cầu.
Thân xe nghiêng theo mặt đường, giữ quán tính khi rơi và có thể lật; bánh có chuyển động
treo, xoay và đánh lái. Chỉ cú tông trên 6 m/s, tiếp đất trên 7 m/s, vụ nổ hoặc viên đạn
có sát thương từ 25 trở lên thực sự trúng thân xe mới trừ độ bền. Đường dốc không bị
tính thành va chạm. HUD khi lái nằm trên ô giáp và hiển thị thanh độ bền. Vị trí xe,
người ngồi và camera được nội suy cùng mốc thời gian để tránh giật theo gói mạng.

Pipeline tự tách bộ low-poly thành nhà, kho và đồ vật riêng, chuẩn hóa kích thước
xe, giảm texture và tạo va chạm theo kiến trúc. Nhà PUBG có cầu thang lên các tầng
và mái; favela có cầu thang bên trong và thang ngoài lên mái. Các công trình được
phân bố trong thị trấn, trang trại và xóm ở cả hai chế độ. GLB tải khi đến gần,
tối đa hai model đồng thời; nhạc dùng luồng phát thay vì giải mã cả bộ vào bộ nhớ.
Ban công có cột đỡ; đường nội thị không chồng ô và dùng độ lệch chiều sâu để hạn chế nhấp nháy.
