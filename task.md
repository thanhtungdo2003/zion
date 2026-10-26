# Yêu cầu nâng cấp Weapon & Hand Animation Studio

## 1. Hand Pose Studio — Quản lý tư thế bàn tay

Tạo một tab riêng để quản lý và chỉnh sửa các tư thế bàn tay trong game.

- Hiển thị danh sách các tư thế tay đã có; cho phép tạo mới, nhân bản (Duplicate), chỉnh sửa và lưu thành tư thế riêng.
- Ở giữa màn hình là viewport 3D hiển thị model bàn tay cùng bộ xương (Skeleton/Rig) bên trong.
- Cho phép chọn, kéo và xoay từng khớp hoặc đốt xương. Giữ cố định chiều dài xương để tránh làm biến dạng bàn tay; áp dụng giới hạn góc xoay hợp lý cho các khớp.
- Hỗ trợ hiển thị model súng và các loại vũ khí để tạo tư thế tay cầm, đỡ, nắm hoặc tương tác với từng bộ phận của vũ khí.
- Mặc định hiển thị theo góc nhìn thứ nhất (FPS). Admin có thể xoay camera editor tự do để quan sát và chỉnh sửa từ nhiều hướng mà không làm thay đổi góc nhìn FPS.
- Hiển thị camera frustum dưới dạng hình hộp nón cụt, có mặt phẳng hình chữ nhật đại diện cho màn hình người chơi, giúp kiểm tra vị trí và bố cục tay, súng trong tầm nhìn.
- Hỗ trợ tạo nhiều tư thế phức tạp như cầm súng, nắm tay cầm, giữ vật thể, đặt ngón tay lên cò hoặc thao tác với các bộ phận của vũ khí; không giới hạn ở các tư thế cơ bản như xòe tay và nắm chặt.
- Các tư thế được lưu phải có thể tái sử dụng trực tiếp trong Animation Studio và hiển thị nhất quán trong game.

## 2. Weapon & Hand Animation Studio — Quản lý animation thao tác tay và vũ khí

Tạo một tab riêng với viewport 3D tương tự Hand Pose Studio, dùng để tạo và chỉnh sửa các animation tương tác giữa bàn tay, cánh tay và các bộ phận của vũ khí.

### Giao diện và timeline

- Có thanh điều khiển animation gồm Play, Pause, Stop, tua tới/lui và điều chỉnh tốc độ phát.
- Phía dưới viewport là timeline chứa nhiều track và keyframe.
- Mỗi keyframe có thể lưu vị trí, góc xoay, tỷ lệ kích thước (Scale) của súng, các bộ phận vũ khí và tay; đồng thời lưu tư thế tay được chọn từ Hand Pose Studio.
- Cho phép thêm, xóa, di chuyển và chỉnh sửa keyframe để tạo các chuyển động phức tạp.
- Hỗ trợ nội suy mượt mà giữa các keyframe. Ví dụ: nếu tay chuyển từ tư thế nắm chặt sang xòe tay, các ngón tay phải mở dần theo thời gian, không chuyển trạng thái đột ngột.
- Cho phép điều chỉnh thời lượng, tốc độ và đường cong chuyển động để kiểm soát cảm giác nhanh, chậm, tăng tốc hoặc giảm tốc.

### Animation tương tác với từng bộ phận vũ khí

- Cho phép chọn một bộ phận cụ thể của súng, chẳng hạn núm kéo khóa nòng, băng đạn hoặc các bộ phận có thể tương tác khác.
- Gán animation chuyển động có sẵn cho bộ phận đó, đồng thời chọn tư thế tay tương ứng từ Hand Pose Studio.
- Khi animation phát, cả bàn tay và bộ phận vũ khí phải chuyển động đồng bộ. Ví dụ: tay chuyển sang tư thế nắm núm kéo khóa nòng, kéo bộ phận đó về sau rồi thả ra; các chuyển động phải khớp với nhau qua từng keyframe.
- Cho phép kết hợp nhiều track để tay, cánh tay, súng và các bộ phận của súng có thể chuyển động đồng thời.
- Hỗ trợ xem trước toàn bộ animation trong viewport FPS và lưu để sử dụng trực tiếp trong game.

### Tương thích với hệ thống hiện có

- Súng đã có sẵn các animation chuyển động và hệ thống âm thanh tương ứng. Hãy tận dụng lại những tài nguyên này, tránh tạo trùng lặp hoặc phá vỡ hệ thống hiện tại.
- Animation Studio tập trung vào việc điều phối chuyển động của tay, lựa chọn tư thế tay và đồng bộ với animation của súng hoặc từng bộ phận.
- Các sự kiện âm thanh hiện có phải tiếp tục hoạt động đúng thời điểm khi animation được phát trong game.

## 3. Vật lý vỏ đạn và băng đạn

### Vỏ đạn

- Tạo model vỏ đạn dạng hình trụ nhỏ, màu vàng đồng.
- Khi súng bắn, vỏ đạn được tạo tại đúng vị trí khe nhả vỏ trên model súng, sau đó bật ra với vận tốc ban đầu và chịu tác động của trọng lực, va chạm với môi trường.
- Giới hạn số lượng vỏ đạn tồn tại đồng thời cho mỗi người chơi để tránh giảm hiệu năng. Khi vượt giới hạn, ưu tiên loại bỏ vỏ đạn cũ nhất trước khi tạo vỏ mới.
- Sử dụng object pooling hoặc cơ chế tương đương để giảm chi phí tạo và hủy vật thể liên tục.

### Băng đạn

- Băng đạn là model riêng, có vị trí gắn chính xác trên súng.
- Khi thay đạn, băng cũ được tháo khỏi súng và thả xuống đất, chịu tác động của trọng lực và va chạm.
- Nhân vật lấy băng mới từ túi trang bị và đưa vào súng theo animation hiện có.
- Đồng bộ thời điểm tháo, thả và lắp băng với animation; cập nhật trạng thái đạn theo gameplay logic.
- Giới hạn số lượng băng đạn rơi tồn tại đồng thời và thu hồi các vật thể cũ để tránh ảnh hưởng hiệu năng.

## 4. Bổ sung tay áo cho model FPS

Kiểm tra và chỉnh sửa model cánh tay trong góc nhìn thứ nhất hiện đang thiếu tay áo.

- Bổ sung model tay áo phù hợp với trang phục nhân vật và bộ giáp hiện tại.
- Đảm bảo tay áo được rig và chuyển động đồng bộ với cánh tay, không xuyên mesh hoặc biến dạng bất thường khi thao tác vũ khí.
- Kiểm tra trong các trạng thái cầm súng, ngắm bắn, thay đạn, chạy và tương tác với vũ khí.

## 5. Yêu cầu kỹ thuật chung

- Tách biệt dữ liệu tư thế tay, animation, model vũ khí và vật thể vật lý; cho phép tái sử dụng giữa nhiều loại súng.
- Ưu tiên tương thích với hệ thống hiện có, không viết lại những chức năng đã hoạt động tốt.
- Tối ưu viewport editor và runtime game; giới hạn vật thể vật lý, tái sử dụng tài nguyên và tránh tạo quá nhiều đối tượng liên tục.
- Đảm bảo dữ liệu lưu từ Studio có thể được nạp lại chính xác và sử dụng trong game.
- Thực hiện theo từng giai đoạn: Hand Pose Studio → Animation Studio → Vật lý vỏ đạn/băng đạn → Hoàn thiện model tay áo và tối ưu hiệu năng.
- Kiểm thử cả trong Studio và runtime để đảm bảo animation mượt, các bộ phận chuyển động đồng bộ, âm thanh hiện có không bị lỗi và hiệu năng không suy giảm đáng kể.