## Nâng cấp địa hình và bầu trời bản đồ game

Nâng cấp hệ thống render map từ seed hiện tại, tập trung vào **địa hình chân thực, chiều sâu không gian và tối ưu hiệu năng**, đồng thời giữ nguyên cấu trúc tổng thể và cơ chế sinh map hiện có.

- **Địa hình đá và đất:** Cải thiện cấu trúc địa hình theo từng biome. Ở núi đá, vách dốc và khu vực cao, tạo các cụm đá tảng lồi lõm, hình khối bất quy tắc, cạnh sắc và bề mặt nứt vỡ như đá tự nhiên. Sử dụng texture pack chân thực, tránh địa hình quá trơn, tròn hoặc đơn giản.
- **Chi tiết theo biome:** Với biome xanh tốt, bổ sung rêu trên đá, cỏ mọc quanh chân đá, cỏ dại và các bụi cỏ dài hơn bình thường. Đảm bảo chi tiết hòa hợp với môi trường và được phân bố tự nhiên theo seed.
- **Chiều sâu và ánh sáng:** Các khe, rãnh, vết nứt và bề mặt gồ ghề phải có độ sâu hình học, bóng đổ và hiệu ứng ánh sáng phù hợp, tạo cảm giác địa hình thực sự có khối thay vì chỉ là texture phẳng.
- **Hệ thống bầu trời hai lớp:** Tách riêng lớp màu nền bầu trời và lớp mây. Lớp mây có thể sử dụng PNG trong suốt, billboard hoặc giải pháp procedural phù hợp với công nghệ hiện tại, ưu tiên chuyển động tự nhiên và chi phí render thấp. Ban đêm cũng áp dụng kiến trúc tương tự nhưng giữ nguyên ảnh nền bầu trời đêm hiện có.

**Yêu cầu quan trọng:** Tham khảo các ảnh mẫu để định hướng chất liệu và hình thái địa hình. Ưu tiên giải pháp phù hợp với kiến trúc render hiện tại, đảm bảo tính ngẫu nhiên theo seed, sự nhất quán giữa các biome và hiệu năng ổn định. Không chỉ thay texture bề mặt; cần cải thiện cả hình học, ánh sáng và cảm giác chiều sâu của địa hình.

**Đá phải là một phần cấu trúc hình học của địa hình (terrain geometry), không phải các model đá rời được đặt lên bề mặt.** Hãy biến đổi trực tiếp mesh địa hình tại các khu vực núi đá, vách dốc và sườn núi để tạo thành các khối đá lớn nhô lên, các lớp đá phân tầng, cạnh sắc, vết nứt và bề mặt lồi lõm tự nhiên. Các cấu trúc này phải liên kết liền mạch với địa hình xung quanh, có độ cao, hình khối và bóng đổ thực tế, đồng thời được sinh procedural theo seed. Texture chỉ đóng vai trò bổ trợ vật liệu, không thay thế hình học thực. Tuyệt đối tránh cách tạo địa hình phẳng rồi rải các model đá lên trên. Ưu tiên giải pháp tối ưu mesh và LOD để duy trì hiệu năng.


### Nâng cấp hệ thống animation nhân vật chuẩn AAA

Hiện tại, nhân vật đang sử dụng sai animation: **đi bộ nhưng lại phát animation chạy**, đồng thời các chuyển động thường xuyên bị khựng, giật và thiếu tự nhiên. Cần kiểm tra và nâng cấp toàn bộ hệ thống animation, không chỉ sửa từng lỗi riêng lẻ.

- **Đúng trạng thái, đúng animation:** Phân biệt rõ idle, walk, jog, sprint và các trạng thái di chuyển khác. Tốc độ di chuyển thực tế phải khớp với animation; tuyệt đối không dùng animation chạy cho trạng thái đi bộ.
- **Chuyển động liên tục:** Loại bỏ hiện tượng giật khung hình, khựng giữa các bước chân, animation bị reset hoặc chuyển động không đều. Kiểm tra animation update loop, delta time, tick rate, nội suy và đồng bộ giữa logic di chuyển với render.
- **Blend animation mượt mà:** Sử dụng blend tree hoặc cơ chế tương đương để chuyển tiếp tự nhiên giữa đứng yên, đi bộ, chạy, đổi hướng, tăng tốc và giảm tốc. Tránh chuyển trạng thái đột ngột hoặc trộn animation sai cách.
- **Đồng bộ chuyển động:** Đảm bảo hướng nhìn, hướng di chuyển, tốc độ nhân vật và chuyển động chân tay nhất quán; hạn chế trượt chân (foot sliding), giật vị trí và sai lệch giữa animation với vị trí thực tế.
- **Kiểm tra toàn diện:** Rà soát state machine, điều kiện chuyển trạng thái, nguồn animation, thời gian phát, nội suy và đồng bộ client-server nếu có. Xác định nguyên nhân gốc trước khi sửa, không dùng các giải pháp tạm thời để che giấu lỗi.

**Mục tiêu:** Đạt chất lượng chuyển động tiệm cận game FPS AAA: mượt, liền mạch, phản hồi nhanh, đúng ngữ cảnh và ổn định ở nhiều mức FPS. Ưu tiên sửa tận gốc kiến trúc animation hiện tại, tái sử dụng hệ thống sẵn có khi phù hợp và kiểm thử thực tế sau mỗi thay đổi. Không chấp nhận việc nhân vật vẫn giật, khựng hoặc phát sai animation sau khi hoàn thành.