# ZION — REALISTIC GAME ENGINE & PHYSICS SYSTEM

## 1. Mục tiêu dự án

Tiếp tục phát triển Zion thành một game FPS 3D có hệ thống engine chuyên biệt, tập trung vào vật lý thực, tương tác vật thể có tính thuyết phục, animation chịu ảnh hưởng của lực và quán tính, mô hình va chạm chính xác cùng kiến trúc đồ họa có khả năng mở rộng.

Đây không đơn thuần là yêu cầu bổ sung vài hiệu ứng vật lý vào game hiện tại. Mục tiêu là xây dựng một nền tảng engine có các hệ thống cốt lõi hoạt động thống nhất, có thể tái sử dụng trên cả Web và Desktop.

Engine phải ưu tiên tính nhất quán vật lý, chất lượng thị giác, hiệu năng và khả năng mở rộng.

### Nguyên tắc bắt buộc

- Khảo sát mã nguồn và kiến trúc Zion hiện tại trước khi triển khai.
- Giữ lại những hệ thống gameplay, networking, world generation và tài nguyên đang hoạt động tốt.
- Không viết lại toàn bộ game hoặc thay engine hiện tại nếu chưa có phân tích kỹ thuật và benchmark chứng minh cần thiết.
- Phân biệt rõ game engine, physics engine, animation system, rendering engine và gameplay logic.
- Không mô phỏng vật lý bằng các phép dịch chuyển hoặc xoay model tùy ý khi có thể sử dụng rigidbody, constraints, forces và collision solver phù hợp.
- Không dùng một collider hộp lớn cho toàn bộ model nếu hình dạng đó gây sai lệch đáng kể đối với gameplay.
- Không coi mọi vật thể đều phải được mô phỏng ở độ chính xác cao. Sử dụng nhiều cấp độ mô phỏng tùy theo mức độ tương tác, khoảng cách và yêu cầu gameplay.
- Tất cả hệ thống phải được tích hợp vào game hiện tại, không dừng ở demo độc lập hoặc tài liệu thiết kế.

## 2. Kiến trúc tổng thể

Thiết kế engine theo các module có ranh giới trách nhiệm rõ ràng:

1. **Core Engine:** vòng lặp game, fixed timestep, quản lý scene, entity, component và lifecycle.
2. **Physics Engine:** rigidbody, lực, mô-men xoắn, quán tính, ma sát, constraints và collision detection.
3. **Collision & Query System:** collider, raycast, shape cast, overlap tests và truy vấn không gian.
4. **Animation & Physical Interaction:** animation clips, skeletal rig, IK, động lực học và tương tác giữa các bộ phận.
5. **Vehicle Physics:** hệ thống bánh xe, hệ thống treo, lực kéo, phanh, lực cản và độ ổn định thân xe.
6. **Rendering Engine:** geometry, PBR materials, lighting, shadows, reflections và các kỹ thuật ray tracing phù hợp.
7. **Asset & Model Pipeline:** quản lý model, skeleton, collider, material, collision layers và metadata.
8. **Gameplay Integration:** nhân vật, vũ khí, đạn, zombie, phương tiện và tương tác môi trường.
9. **Networking Integration:** đồng bộ trạng thái vật lý cần thiết trong multiplayer.
10. **Debugging & Profiling:** hiển thị collider, vector lực, vận tốc, điểm va chạm, frame time và thống kê solver.

Các module phải được thiết kế để có thể kiểm thử độc lập nhưng hoạt động thống nhất trong game.

## 3. Physics Engine — Vật lý cốt lõi

Xây dựng hoặc tích hợp một physics engine thực sự thay vì tự tạo các hiệu ứng chuyển động rời rạc.

Trước khi lựa chọn công nghệ, đánh giá physics engine hiện tại và các giải pháp phù hợp với JavaScript/TypeScript, WebAssembly hoặc native runtime. Chỉ thay đổi công nghệ khi có lý do rõ ràng về độ chính xác, hiệu năng hoặc khả năng tích hợp.

### 3.1. Rigidbody và động lực học

Hỗ trợ tối thiểu:

- Mass và center of mass.
- Linear velocity và angular velocity.
- Linear acceleration và angular acceleration.
- Forces, impulses và torques.
- Inertia tensor và rotational dynamics.
- Gravity, damping và drag.
- Static, dynamic và kinematic bodies.
- Sleeping và wake-up khi có tương tác.
- Collision response và contact constraints.

Vật thể phải phản ứng theo khối lượng, hình dạng va chạm, vận tốc, hướng chuyển động và vị trí tác dụng lực.

Ví dụ: một vật nặng bị đẩy không được gia tốc giống một vật nhẹ khi chịu cùng lực. Va chạm lệch tâm phải có thể tạo mô-men xoắn làm vật thể xoay.

### 3.2. Ma sát và va chạm

Triển khai các cơ chế phù hợp:

- Normal contact response.
- Restitution và friction.
- Static friction và dynamic friction khi solver hỗ trợ.
- Friction constraints.
- Continuous collision detection cho các vật thể có tốc độ cao.
- Contact manifolds và collision filtering.
- Collision layers, masks và trigger volumes.
- Stable stacking và xử lý vật thể nằm trên bề mặt.
- Chống xuyên vật thể do timestep hoặc vận tốc lớn.

Không giả định mọi va chạm đều là va chạm đàn hồi. Đặc tính phản ứng phải phụ thuộc vật liệu, khối lượng, vận tốc và thông số được cấu hình.

### 3.3. Timestep và độ ổn định

- Sử dụng fixed timestep cho mô phỏng vật lý.
- Tách physics update khỏi render frame rate.
- Dùng interpolation khi render giữa các physics ticks.
- Cấu hình solver iterations và substeps theo nhu cầu.
- Có cơ chế xử lý frame spike và giới hạn thời gian mô phỏng.
- Không để FPS thay đổi làm thay đổi tùy tiện quỹ đạo vật thể.

Mục tiêu là tạo kết quả ổn định, có thể tái lập trong cùng điều kiện đầu vào. Không tuyên bố mô phỏng deterministic tuyệt đối giữa mọi thiết bị nếu engine không bảo đảm điều đó.

## 4. Model Geometry và Collision Geometry

Đây là một yêu cầu trọng tâm.

Model hiển thị và hình dạng va chạm phải được quản lý độc lập nhưng liên kết chính xác thông qua cùng hệ tọa độ, transform và metadata.

### 4.1. Phân biệt visual mesh và collision mesh

- **Visual Mesh:** hình học phục vụ hiển thị, có thể gồm nhiều chi tiết, vật liệu, texture và khe hở.
- **Collision Mesh:** hình học phục vụ va chạm, raycast, đạn và truy vấn không gian.
- **Hitbox / Hit Region:** vùng gameplay dùng để xác định bộ phận bị trúng đạn, sát thương hoặc tương tác đặc biệt.
- **Physics Proxy:** hình dạng đơn giản hóa dùng cho mô phỏng rigidbody và các tương tác không yêu cầu độ chính xác cao.

Không sử dụng visual mesh có độ phức tạp cao làm dynamic collision mesh mặc định nếu điều đó gây giảm hiệu năng hoặc mất ổn định solver.

### 4.2. Quy tắc về khe hở và khoảng trống

Các khoảng trống trong model phải được xử lý theo hình học thực tế, không được vô tình trở thành vật cản vô hình.

Ví dụ:

- Một ô cửa phải cho phép nhân vật đi qua nếu kích thước và tư thế phù hợp.
- Khoảng trống giữa các bộ phận xe không được bị lấp bởi một collider hộp lớn không hợp lý.
- Ray bắn phải có thể đi qua khe hở thực sự nếu đường đi không giao với hình học chặn đạn.
- Một chiếc xe phải va chạm với tường hoặc vật thể theo các bề mặt thực tế, không phải theo một hộp bao quá lớn.
- Các bề mặt mỏng, lỗ, cửa sổ và cấu trúc dạng khung phải có collision geometry phù hợp.

Tuy nhiên, **không mặc định mọi khoảng trống giữa hai bộ phận đều là không khí có thể đi xuyên qua**. Phải phân biệt khe hở thực sự, bề mặt vật liệu, nội thất, lớp giáp và các bộ phận có thể chặn đạn.

### 4.3. Công cụ kiểm tra collider

Tích hợp chế độ debug có thể bật/tắt để hiển thị:

- Visual mesh và collision mesh đồng thời.
- Rigidbody bounds và center of mass.
- Collision layers và hit regions.
- Raycast, điểm tiếp xúc và hướng pháp tuyến.
- Những collider chồng lấn bất thường.
- Các vùng không thể tiếp cận do collider sai.
- Những khe hở trong visual mesh nhưng bị collider chặn.

Cung cấp khả năng kiểm tra collider của nhân vật, súng, xe, tòa nhà và các asset quan trọng.

## 5. Vũ khí và Physical Animation

Không sử dụng animation như một chuỗi transform cố định hoàn toàn tách biệt khỏi vật lý.

Hệ thống phải kết hợp animation điều khiển chuyển động với mô phỏng động lực học ở những bộ phận cần phản ứng lực.

### 5.1. Cấu trúc vũ khí FPS

Mỗi vũ khí cần hỗ trợ:

- Weapon root và transform.
- Grip points cho tay thuận và tay hỗ trợ.
- Các điểm tham chiếu như báng súng, cò, khóa nòng và vị trí thao tác.
- Skeletal rig hoặc hệ thống transform phân cấp.
- Weapon mass, center of mass và rotational inertia phù hợp với mô hình gameplay.
- Các attachment points cho phụ kiện.
- Collider và các vùng tương tác cần thiết.
- Animation clips có metadata về điểm bắt đầu, thời điểm tiếp xúc và điểm kết thúc hành động.

### 5.2. Animation kết hợp vật lý

Triển khai cơ chế kết hợp animation với physical response, có thể dùng animation-driven motion, IK, spring-damper, constraints và rigidbody simulation tùy trường hợp.

Ví dụ khi nạp đạn:

1. Tay di chuyển đến vị trí thao tác theo animation.
2. Tay tiếp cận và tương tác với bộ phận tương ứng trên súng.
3. Khi đẩy, kéo hoặc tác động vào bộ phận có thể chuyển động, lực và chuyển vị được truyền theo cơ chế đã thiết lập.
4. Súng có thể xoay, rung hoặc dịch chuyển nhẹ do lực tác dụng, điểm tiếp xúc và quán tính.
5. Tay và súng được phối hợp để duy trì tư thế cầm hợp lý.
6. Sau khi thao tác kết thúc, dao động giảm dần theo damping và các ràng buộc vật lý.

Mức độ chuyển động phải phụ thuộc vào khối lượng, mô-men quán tính, lực, vị trí tiếp xúc, độ cứng và damping. Không dùng một giá trị rung ngẫu nhiên cố định cho mọi vũ khí.

### 5.3. Giữ tính ổn định của animation

- Không để mô phỏng vật lý khiến tay xuyên qua súng.
- Không để tay bị tách khỏi grip point ngoài các hành động có chủ đích.
- Hạn chế jitter và dao động không kiểm soát.
- Hỗ trợ blend giữa animation và physical response.
- Có cơ chế chuyển tiếp mượt giữa trạng thái animation, trạng thái tương tác và trạng thái nghỉ.
- Cho phép cấu hình mức ảnh hưởng vật lý theo từng hành động và loại vũ khí.

Không bắt buộc mọi xương đều phải là rigidbody động. Chỉ áp dụng mô phỏng vật lý đầy đủ cho những bộ phận có ý nghĩa; các bộ phận còn lại có thể dùng animation và IK.

## 6. Nhân vật và môi trường

### 6.1. Nhân vật

- Collision capsule hoặc shape phù hợp với tư thế hiện tại.
- Hỗ trợ đứng, đi bộ, chạy, nhảy, ngồi và các trạng thái di chuyển khác.
- Kiểm tra khoảng trống phía trên khi đứng lên.
- Xử lý va chạm với tường, cửa, bậc thang, dốc và địa hình.
- Tách gameplay movement controller khỏi animation presentation.
- Hỗ trợ ragdoll hoặc partial ragdoll khi cần.
- Có thể kết hợp animation-driven movement với physical reactions khi bị đẩy hoặc va chạm.

### 6.2. Tương tác môi trường

- Cửa, vật thể có thể đẩy, vật thể có thể nhặt và vật thể có thể phá hủy phải có interaction model rõ ràng.
- Vật thể không được xuyên tường hoặc tự tạo lực bất thường.
- Các bề mặt phải có thuộc tính ma sát và phản ứng va chạm phù hợp.
- Tương tác giữa các vật thể phải dựa trên collider, constraints và quy tắc gameplay.
- Phân biệt vật thể trang trí không có va chạm với vật thể có thể tương tác.

## 7. Vehicle Physics — Hệ thống phương tiện

Xây dựng hệ thống phương tiện có động lực học phù hợp, không chỉ di chuyển model bằng cách thay đổi tọa độ.

### 7.1. Mô hình phương tiện

Hỗ trợ:

- Rigidbody và center of mass.
- Linear và angular momentum.
- Lực kéo, phanh và lực cản.
- Hệ thống bánh xe và lực tiếp xúc với mặt đất.
- Hệ thống treo, spring-damper và wheel travel.
- Lực ma sát lốp theo hướng dọc và ngang.
- Chuyển tải trọng khi tăng tốc, phanh và vào cua.
- Mô-men xoắn gây nghiêng thân xe.
- Va chạm thân xe với tường, địa hình và các phương tiện khác.

Có thể sử dụng vehicle model phù hợp với gameplay, nhưng phải nhất quán về khối lượng, lực, vận tốc, ma sát và phản ứng va chạm.

### 7.2. Lật xe và mất ổn định

Khi xe va chạm, đi qua địa hình không bằng phẳng, bị tác động lệch tâm hoặc di chuyển với vận tốc lớn:

- Xe phải phản ứng theo lực và mô-men xoắn.
- Thân xe có thể nghiêng, xoay hoặc lật khi điều kiện động lực học dẫn đến điều đó.
- Hệ thống treo phải ảnh hưởng đến độ ổn định.
- Bánh xe phải có trạng thái tiếp xúc và mất tiếp xúc với mặt đất.
- Không tự động giữ xe đứng thẳng bằng cách reset rotation trong khi đang mô phỏng vật lý.
- Cơ chế hỗ trợ lật lại xe chỉ được kích hoạt khi có hành động gameplay rõ ràng.

### 7.3. Va chạm phương tiện

- Xe phải chặn hoặc đẩy các vật thể theo khối lượng và vận tốc tương đối.
- Không cho xe xuyên qua tường do collider sai.
- Xử lý va chạm ở vận tốc cao bằng CCD hoặc giải pháp tương đương khi cần.
- Phân biệt va chạm thân xe, bánh xe và các bộ phận phụ.
- Tối ưu collision geometry nhưng không làm mất các hình dạng quan trọng đối với gameplay.

## 8. Ballistics và Projectile System

Phân biệt raycast hitscan và projectile mô phỏng chuyển động.

### Hitscan

- Tạo ray từ nòng súng hoặc vị trí bắn hợp lệ.
- Truy vấn collision world.
- Xác định điểm trúng đầu tiên, vật cản, hit region và bề mặt.
- Không cho ray đi xuyên vật thể đặc chỉ vì visual mesh có chi tiết hoặc collider không chính xác.

### Projectile

- Có vị trí, vận tốc, khối lượng và trạng thái vật lý nếu cần.
- Có thể chịu trọng lực và lực cản không khí.
- Xử lý va chạm trên đường bay.
- Tránh xuyên vật thể ở vận tốc cao.
- Có quy tắc xuyên vật liệu riêng nếu gameplay hỗ trợ xuyên giáp hoặc xuyên vật thể.

Đạn, vật thể ném và các projectile khác phải sử dụng collision system thống nhất thay vì mỗi hệ thống tự tạo một cơ chế va chạm riêng.

## 9. Rendering Engine và Ray Tracing

Nâng cấp đồ họa nhưng không đánh đồng chất lượng hình ảnh với độ chính xác vật lý.

### 9.1. Visual realism

- PBR materials.
- Lighting và shadow system.
- Reflection cho kim loại, kính và mặt nước.
- Ambient occlusion.
- Atmospheric effects phù hợp với bối cảnh.
- Geometry và shading nhất quán.
- LOD và tối ưu hóa scene cho môi trường có nhiều vật thể.

### 9.2. Ray tracing

Đánh giá khả năng triển khai ray tracing trên Web và Desktop dựa trên renderer, runtime và API thực tế.

- Web: sử dụng giải pháp tương thích với môi trường trình duyệt mục tiêu.
- Desktop: đánh giá khả năng tận dụng native graphics API như DXR hoặc Vulkan Ray Tracing khi cần hardware ray tracing.
- Phân biệt hardware ray tracing, ray tracing bằng shader và các kỹ thuật screen-space.
- Hỗ trợ chế độ đồ họa tùy chọn, kiểm tra capabilities và fallback khi không được hỗ trợ.
- Không yêu cầu ray tracing nếu nó làm suy giảm nghiêm trọng hiệu năng mà không đem lại lợi ích hình ảnh đủ lớn.

Không để ray tracing trở thành điều kiện bắt buộc để game có hệ thống bóng đổ, vật liệu hoặc chiếu sáng hoạt động.

## 10. Multiplayer và tính nhất quán vật lý

Zion là game multiplayer nên vật lý không được chỉ hoạt động đúng trên máy client.

- Server tiếp tục giữ vai trò authoritative đối với trạng thái gameplay quan trọng.
- Xác định rõ những tương tác vật lý nào phải được xác nhận bởi server.
- Client có thể prediction và interpolation để tạo cảm giác điều khiển mượt.
- Có cơ chế reconciliation khi trạng thái client lệch với server.
- Không đồng bộ toàn bộ trạng thái của mọi rigidbody ở mọi frame nếu không cần thiết.
- Sử dụng snapshots, delta updates hoặc cơ chế tương đương theo nhu cầu.
- Đánh giá tác động của physics simulation đến bandwidth, server CPU và khả năng tái lập kết quả.
- Phân biệt tính chính xác vật lý với tính nhất quán mạng; không giả định solver cho kết quả giống hệt trên mọi máy.

## 11. Performance và Quality Levels

Hệ thống phải có nhiều mức chất lượng mô phỏng.

### Physics

- High: tương tác gần người chơi, vũ khí, phương tiện và va chạm quan trọng.
- Medium: vật thể có tương tác nhưng không nằm trong vùng quan sát chính.
- Low: giảm tần suất cập nhật hoặc đơn giản hóa vật thể ở xa.
- Static: dùng collision geometry tĩnh cho môi trường không chuyển động.

### Rendering

- Cấu hình chất lượng ánh sáng, bóng đổ, phản chiếu, LOD và các hiệu ứng hậu kỳ độc lập với physics quality.
- Hỗ trợ fallback theo capabilities.
- Không tự động giảm độ chính xác va chạm gameplay chỉ vì người chơi giảm chất lượng đồ họa.

### Profiling

Đo ít nhất:

- Render frame time và FPS.
- Physics simulation time.
- Số rigidbody đang hoạt động.
- Số broad-phase candidates và collision contacts nếu engine hỗ trợ.
- Số raycasts/projectile queries.
- Số draw calls và GPU memory nếu có thể.
- CPU/GPU bottlenecks.
- Chi phí đồng bộ trạng thái multiplayer.

Không đưa ra tuyên bố tăng hiệu năng nếu chưa có benchmark so sánh trong điều kiện tương đương.

## 12. Kiểm thử và tiêu chí nghiệm thu

Mỗi hệ thống phải có test và scene kiểm chứng cụ thể.

### Physics tests

- Vật thể rơi và ổn định trên bề mặt.
- Hai vật thể có khối lượng khác nhau chịu lực tương đương.
- Va chạm lệch tâm tạo chuyển động quay.
- Vật thể trượt và dừng theo ma sát.
- Vật thể tốc độ cao không xuyên qua collider trong các trường hợp mục tiêu.
- Vật thể xếp chồng không rung hoặc sụp bất thường trong điều kiện ổn định.

### Geometry tests

- Nhân vật đi qua cửa có kích thước phù hợp.
- Nhân vật không thể đi xuyên tường đặc.
- Ray bắn xuyên qua khe hở thực sự.
- Ray bắn bị chặn bởi hình học vật thể.
- Xe không bị chặn bởi collider hộp vô hình quá lớn.
- Collider không lệch khỏi visual model sau khi thay đổi transform hoặc animation.

### Animation tests

- Tay thao tác với súng mà không xuyên qua model.
- Súng phản ứng với lực đẩy và kéo theo cấu hình vật lý.
- Dao động giảm dần hợp lý.
- Chuyển đổi animation không tạo giật hoặc mất grip.
- Physical response không phá vỡ tư thế ngắm bắn.

### Vehicle tests

- Xe tăng tốc, phanh và vào cua ổn định.
- Thân xe nghiêng theo động lực học phù hợp.
- Va chạm lệch tâm tạo mô-men quay.
- Xe có thể lật trong các tình huống thích hợp.
- Bánh xe phản ứng với địa hình và mất tiếp xúc.
- Không có hiện tượng xe tự cân bằng trái với trạng thái vật lý đã mô phỏng.

### Platform tests

- Web vẫn build và chạy được.
- Desktop vẫn build và khởi động được.
- Các shared packages không import API chỉ có trên một nền tảng.
- Multiplayer hoạt động sau khi tích hợp physics.
- Renderer có fallback khi ray tracing không khả dụng.
- Không phát sinh regression nghiêm trọng so với phiên bản trước.

## 13. Lộ trình triển khai

Thực hiện theo các giai đoạn có thể nghiệm thu độc lập:

1. **Audit:** khảo sát kiến trúc và báo cáo vấn đề hiện tại.
2. **Architecture:** thiết kế engine modules và ranh giới shared packages.
3. **Physics foundation:** timestep, rigidbody, collision world, material properties và debug visualization.
4. **Geometry pipeline:** chuẩn hóa visual mesh, collision mesh, hit regions và asset validation.
5. **Character & weapon interaction:** tích hợp physics với animation, IK và vũ khí.
6. **Vehicle physics:** xây dựng và kiểm chứng hệ thống phương tiện.
7. **Ballistics & world interaction:** tích hợp projectile, hitscan và collision queries.
8. **Multiplayer integration:** server authority, prediction, interpolation và reconciliation.
9. **Rendering & ray tracing:** đánh giá, benchmark và triển khai theo khả năng thực tế của Web/Desktop.
10. **Optimization & release:** profiling, regression tests, build và tài liệu vận hành.

Sau mỗi giai đoạn, phải có code thực tế, test, kết quả benchmark phù hợp và báo cáo những phần đã hoàn thành, chưa hoàn thành hoặc bị chặn.

## 14. Deliverables cuối cùng

- Engine architecture và module boundaries được tài liệu hóa.
- Physics engine tích hợp trong game hiện tại.
- Collision system thống nhất cho nhân vật, vũ khí, đạn, xe và môi trường.
- Physical animation cho các tương tác quan trọng.
- Vehicle physics có khả năng nghiêng, trượt và lật theo mô phỏng.
- Pipeline kiểm tra collider và model geometry.
- Rendering capabilities và ray tracing implementation được ghi rõ theo từng nền tảng.
- Bộ kiểm thử physics, collision, animation và vehicle.
- Benchmark và profiling report.
- Hướng dẫn tạo asset, cấu hình vật lý và thêm loại vật thể mới.
- Danh sách giới hạn còn tồn tại và lộ trình cải thiện tiếp theo.

## 15. Yêu cầu báo cáo của AI

Trước khi code, hãy trình bày:

1. Kiến trúc hiện tại của Zion.
2. Những hệ thống vật lý và đồ họa đã tồn tại.
3. Những phần có thể tái sử dụng.
4. Những module cần xây dựng hoặc refactor.
5. Công nghệ đề xuất cho physics, collision, animation và rendering, kèm lý do.
6. Rủi ro về hiệu năng, multiplayer và khả năng tương thích Web/Desktop.
7. Lộ trình triển khai theo từng giai đoạn.

Sau khi audit và đề xuất kiến trúc, hãy bắt đầu triển khai theo thứ tự ưu tiên. Không chỉ trả về kế hoạch, pseudocode hoặc các file scaffold không hoạt động.

**Mục tiêu cuối cùng:** Zion phải có một hệ thống vật lý và tương tác nhất quán, trong đó model, collision geometry, animation, vũ khí, phương tiện và môi trường phối hợp với nhau theo các quy tắc động lực học có thể kiểm chứng, đồng thời duy trì gameplay và multiplayer hiện có.


## 18. LOW-END HARDWARE SAFETY & TESTING REQUIREMENTS

**Development and testing must prioritize system stability. The development machine has limited hardware resources. Never assume a high-end CPU, GPU, or large amount of RAM.**

### Mandatory safety rules
- Before running builds, benchmarks, simulations, stress tests, or the game, inspect the available CPU cores, RAM, GPU, VRAM if available, disk space, and current system resource usage.
- Start with the smallest viable test scene and a minimal number of physics objects. Increase complexity gradually only when resource usage remains safe.
- Never run unrestricted stress tests, infinite physics loops, unbounded object spawning, or benchmarks that consume all available CPU, RAM, or GPU resources.
- Set explicit limits for simulation duration, physics object count, collision checks, worker processes, memory allocation, and test iterations.
- Use conservative worker counts. Do not automatically spawn a worker per CPU core or launch multiple builds and test suites concurrently.
- Avoid full-world simulations, maximum-resolution rendering, high-resolution shadow maps, ray tracing, or heavy GPU effects during initial development tests. Use low-resolution assets and simplified scenes first.
- Monitor resource usage during every long-running test. Stop the test automatically if memory usage approaches a configurable limit, resource consumption rises unexpectedly, or the application becomes unresponsive.
- Avoid memory leaks, unbounded queues, excessive logging, and repeatedly allocating large temporary buffers. Clean up physics bodies, event listeners, workers, and GPU resources when tests finish.
- Do not modify system settings, GPU drivers, power limits, BIOS settings, or operating-system configuration to force higher performance.
- Never delete project files, user data, databases, or existing assets as part of cleanup without explicit approval.

### Safe testing strategy
1. **Static checks first:** type checking, linting, unit tests, and code inspection before launching expensive builds or simulations.
2. **Micro-tests:** test a few rigidbodies, simple collisions, one weapon interaction, and one vehicle in isolated scenes.
3. **Short integration tests:** run for a limited duration with a small object count and low rendering quality.
4. **Gradual load tests:** increase object counts and simulation complexity in controlled steps, stopping when performance or resource usage becomes unsafe.
5. **Regression tests:** verify physics correctness and existing gameplay after each implementation phase, rather than running the entire test suite repeatedly without reason.
6. **Long-running tests:** run only when necessary, with explicit timeouts, resource monitoring, and a reliable termination mechanism.

### Resource budgets and failure handling
- Establish configurable CPU, RAM, GPU, FPS, and simulation-time budgets based on the actual development machine. Do not invent hardware specifications or assume fixed safe limits before measuring the system.
- Prefer running physics tests without rendering when visual output is unnecessary.
- Separate performance tests from functional tests. A test must not be considered successful merely because it completes if it causes excessive resource usage.
- If a test exceeds its budget, stop it safely, record the failure and resource measurements, and reduce the workload before retrying.
- Keep the development environment responsive. Never sacrifice operating-system stability to obtain benchmark results.
- Document the exact test command, workload, duration, resource usage, result, and any known limitations.

**Acceptance criterion:** Every new physics or engine subsystem must have a lightweight test that can run on low-end hardware. Heavy tests must be optional, bounded, and explicitly triggered. The default development workflow must remain safe and usable on a resource-constrained machine.