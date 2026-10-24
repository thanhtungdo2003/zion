## TASK: Nâng cấp hệ thống tạo model nhân vật và quản lý asset GLB

Kiểm tra dự án `D:\AEMINE_PROJECT\model-generator` và nâng cấp hệ thống tạo tóc, râu, trang phục và phụ kiện 3D.

### 1. Tạo tóc và râu
- Tóc phải được tạo từ nhiều khối mesh 3D thuôn nhọn, đắp chồng và phân lớp theo hướng mọc tóc, có độ phồng và silhouette tự nhiên. Không tạo tóc thành một khối mũ trơn hoặc các sợi nhọn giống nhau.
- Hỗ trợ nhiều kiểu tóc thực tế, đặc biệt là các kiểu lịch lãm như Classic Side Part, Slicked Back, Executive Contour, Textured Quiff.
- Râu và ria mép phải là mesh 3D riêng, có thể tích, hình dáng tự nhiên và có thể tháo lắp độc lập.
- Tất cả asset phải được định vị chính xác theo model người mẫu, không xuyên mesh, lệch tỷ lệ hoặc sai vị trí.

### 2. Tách asset thành nhiều file GLB thuộc cùng một lô

Khi người dùng yêu cầu tạo một bộ trang phục, phụ kiện hoặc một bộ model nhân vật, hệ thống phải tạo **nhiều file GLB độc lập nhưng thuộc cùng một lô asset**.

Ví dụ, khi tạo một nhân vật gồm áo ba lỗ, quần vải, giày, tóc và râu, kết quả phải gồm:

- `tank_top.glb`
- `trousers.glb`
- `shoes.glb`
- `hairstyle.glb`
- `beard.glb`

Các file phải được quản lý trong cùng một lô, có chung `batchId` hoặc cơ chế định danh tương đương, kèm metadata về loại asset và model người mẫu tham chiếu.

Yêu cầu:
- Mỗi file chỉ chứa asset tương ứng, không gộp toàn bộ trang phục hoặc cơ thể vào một GLB duy nhất.
- Các asset phải giữ đúng tỷ lệ, tọa độ, hướng và vị trí lắp ghép theo cùng model người mẫu.
- Có thể xem trước toàn bộ lô cùng lúc, nhưng vẫn chọn, chỉnh sửa, tạo lại, xuất hoặc thay thế từng asset độc lập.
- Tạo lại một asset không được làm thay đổi các asset khác.
- Giữ nguyên khả năng tương thích với pipeline GLB hiện có.

### 3. Sửa pipeline tạo trang phục và phụ kiện

Kiểm tra nguyên nhân khiến quần áo thường bị bó sát, vải quá dày, quần quá rộng, giày quá lớn, vị trí sai và các thiết kế có hình dáng giống nhau.

Tách quy tắc hình học theo từng loại asset: vải mềm, giáp cứng, giày dép, tóc, râu và phụ kiện. Không áp dụng máy móc template hoặc thông số của áo giáp cho quần áo thông thường.

### 4. Kiểm thử và nghiệm thu

Tạo thử một lô hoàn chỉnh gồm áo ba lỗ, quần vải, giày, tóc lịch lãm và râu ngắn. Xác minh từng file GLB độc lập, khả năng ghép đúng vào model người mẫu, hình dáng từ nhiều góc và khả năng xuất/import lại.

Chạy các bài test, typecheck, lint và build phù hợp. Báo cáo các file đã sửa, kết quả kiểm thử và những lỗi còn tồn tại. Không tuyên bố hoàn thành nếu mới chỉ sửa UI mà chưa xác minh asset thực tế.