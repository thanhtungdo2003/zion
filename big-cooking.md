# TASK: BUILD AN AI-POWERED 3D MODEL STUDIO FOR GAME ADMIN

## 1. Mục tiêu

Phân tích codebase hiện tại và trực tiếp triển khai một **AI-powered 3D Model Studio** tích hợp vào Game Admin Studio, hoạt động như một công cụ xây dựng và quản lý tài nguyên 3D chuyên nghiệp ngay trên trình duyệt.

Bắt đầu bằng tab **Model Management**, tạo nền tảng để mở rộng AI Agent sang các hệ thống quản lý bản đồ, địa hình, animation, vũ khí và gameplay mode trong tương lai.

Đây phải là hệ thống hoạt động thực tế, có khả năng tạo, chỉnh sửa, lắp ghép, kiểm tra và xuất model 3D để sử dụng trực tiếp trong game. Không chỉ xây dựng UI mockup hoặc demo với dữ liệu giả.

## 2. Nghiên cứu codebase và tái sử dụng công nghệ hiện có

Trước khi code:

- Phân tích kiến trúc Game Admin Studio, game engine, hệ thống render 3D, asset pipeline, định dạng model và cơ chế tải tài nguyên hiện tại.
- Nghiên cứu dự án `D:\AEMINE_PROJECT\model-generator` để tái sử dụng cách cấu hình API key, tích hợp AI, prompt pipeline và các công nghệ tạo model đã có.
- Tìm kiếm các thư viện, thuật toán, GitHub repositories và công cụ mã nguồn mở phù hợp với việc tạo hình học 3D, procedural modeling, UV mapping, PBR materials, texture generation và xử lý mesh.
- Ưu tiên tái sử dụng hoặc tích hợp code thực sự hữu ích từ các dự án mã nguồn mở có giấy phép phù hợp. Đọc tài liệu, kiểm tra khả năng tương thích và tích hợp vào kiến trúc hiện tại thay vì chỉ liệt kê các thư viện.
- Tận dụng toàn bộ thuật toán tạo địa hình, tạo bản đồ, procedural generation, hệ thống vật liệu và các AI tools/skills hiện có trong dự án.

Không viết lại những hệ thống đã hoạt động tốt nếu có thể mở rộng chúng an toàn.

## 3. Xây dựng tab Model Management

Thiết kế một môi trường làm việc 3D chuyên nghiệp, lấy cảm hứng từ các công cụ như Blender, Unreal Engine và các phần mềm quản lý tài nguyên game, nhưng được tối ưu để chạy trực tiếp trên trình duyệt.

### 3.1. Quản lý dự án và tài nguyên

Admin có thể:

- Tạo, mở, đổi tên, nhân bản và xóa dự án model.
- Import model từ GLB/GLTF và các định dạng phù hợp với pipeline hiện tại.
- Duyệt, tìm kiếm, lọc và xem trước toàn bộ model, mesh, vật liệu, texture và asset có sẵn trong game.
- Tạo model mới từ đầu hoặc kết hợp nhiều model, mesh và vật liệu hiện có.
- Chỉnh sửa, thay thế, tái sử dụng và lưu phiên bản tài nguyên.
- Quản lý dependencies giữa model, material, texture và các asset thành phần.
- Lưu dự án, tự động lưu thay đổi và hỗ trợ undo/redo.
- Preview model trong môi trường 3D tương tác với orbit camera, zoom, pan, ánh sáng và các chế độ hiển thị phù hợp.

### 3.2. 3D Editor chuyên nghiệp

Xây dựng các công cụ chỉnh sửa thiết yếu:

- Scene hierarchy và quản lý các đối tượng trong scene.
- Chọn, di chuyển, xoay, thay đổi tỷ lệ và căn chỉnh đối tượng.
- Snap theo grid, trục tọa độ và bề mặt.
- Ghép các thành phần thành một model hoàn chỉnh, giữ đúng transform và cấu trúc phân cấp.
- Quản lý mesh, pivot, bounding box, collision proxy và LOD khi pipeline hỗ trợ.
- Chỉnh sửa vật liệu, UV/texture và thông số render.
- Hỗ trợ ánh sáng, môi trường, camera và chế độ kiểm tra chất lượng model.

Phân biệt rõ giữa model có nhiều mesh, model lắp ghép từ nhiều asset và geometry thực sự được hợp nhất. Không tự động merge mesh nếu việc đó làm mất material, UV, hierarchy hoặc khả năng chỉnh sửa.

Ưu tiên hiệu năng trình duyệt, tải tài nguyên theo nhu cầu và xử lý các model lớn mà không gây treo toàn bộ Admin Studio.

## 4. AI Agent – Trợ lý xây dựng model bằng ngôn ngữ tự nhiên

Đây là chức năng trọng tâm của hệ thống.

Tích hợp một AI Agent có khả năng phân tích yêu cầu, lập kế hoạch, lựa chọn công cụ, thực thi từng bước, kiểm tra kết quả và tự sửa lỗi khi cần.

Cung cấp một ô nhập prompt nổi bật trong Model Studio. Admin có thể mô tả model mong muốn bằng tiếng Việt hoặc tiếng Anh.

Ví dụ:

- “Tạo một ngôi nhà hoàn chỉnh gồm phòng khách, phòng ngủ, nhà bếp và phòng ăn, sử dụng các vật liệu hiện có trong game.”
- “Tạo một căn nhà sinh tồn có sân trước, vườn cây, hàng rào, sân sau và nội thất cơ bản. Phong cách phù hợp với bản đồ battle royale hậu tận thế.”
- “Tạo một tảng đá lớn có hình dạng tự nhiên, bề mặt lởm chởm, nhiều lớp đá, texture chi tiết và vật liệu PBR.”
- “Tạo một căn nhà bỏ hoang sau 200 năm, có mái hư hỏng, tường nứt, rêu, bụi bẩn và các chi tiết phù hợp với thế giới sinh tồn của game.”
- “Từ các model tường, cửa, cửa sổ và mái nhà đang có, lắp ghép thành một căn nhà hoàn chỉnh, tối ưu số draw calls nhưng vẫn giữ chất lượng hình ảnh.”

### 4.1. Quy trình hoạt động của AI Agent

Khi nhận prompt, Agent phải:

1. **Phân tích yêu cầu:** Xác định loại asset, kích thước dự kiến, phong cách, cấu trúc, mức độ chi tiết và mục đích sử dụng trong game.
2. **Kiểm tra tài nguyên:** Tìm kiếm asset, mesh, texture, material, thuật toán và công cụ có sẵn trong dự án.
3. **Nghiên cứu khi cần:** Tra cứu tài liệu kỹ thuật, các dự án GitHub, phương pháp procedural modeling và nguồn tham khảo trực tuyến để xác định phương pháp phù hợp.
4. **Lập kế hoạch:** Chia model thành các thành phần có thể chỉnh sửa độc lập, xác định vật liệu, hình học, texture, ánh sáng và cách lắp ghép.
5. **Thực thi:** Gọi các tools phù hợp để tạo geometry, ghép asset, sinh texture, cấu hình material và xây dựng scene.
6. **Hiển thị kết quả:** Đưa model vào viewport để admin xem trực tiếp, kiểm tra và chỉnh sửa.
7. **Tự kiểm tra:** Phát hiện mesh lỗi, mặt bị đảo, vật liệu thiếu, texture sai, tỷ lệ bất hợp lý, lỗi va chạm hoặc vấn đề tương thích với game.
8. **Cải thiện:** Tự sửa các lỗi có thể khắc phục, sau đó hiển thị kết quả và báo cáo những vấn đề còn tồn tại.

Agent phải thực sự thao tác trên các công cụ của hệ thống thông qua tool-calling hoặc cơ chế tương đương. Không được giả lập việc tạo model bằng cách chỉ trả về mô tả văn bản.

### 4.2. Kiến trúc Agent và bộ công cụ

Xây dựng kiến trúc mở rộng được, tách biệt phần suy luận AI khỏi các công cụ thực thi.

Cung cấp cho Agent những tools phù hợp như:

- `search_assets`: Tìm kiếm model, mesh, texture và material hiện có.
- `inspect_model`: Phân tích cấu trúc, kích thước, mesh, material và thông số model.
- `create_geometry`: Tạo hình học 3D bằng procedural modeling.
- `assemble_model`: Lắp ghép các asset thành một model hoàn chỉnh.
- `create_or_edit_material`: Tạo và chỉnh sửa vật liệu PBR.
- `generate_or_apply_texture`: Tạo, xử lý hoặc áp dụng texture.
- `edit_transform`: Thay đổi vị trí, góc xoay và tỷ lệ đối tượng.
- `inspect_scene`: Kiểm tra cấu trúc scene và các thành phần.
- `validate_asset`: Kiểm tra tính hợp lệ và khả năng sử dụng trong game.
- `optimize_model`: Đề xuất hoặc thực hiện các tối ưu mesh, LOD và draw calls khi phù hợp.
- `save_project`: Lưu dự án và các thay đổi đã được phê duyệt.
- `export_asset`: Xuất model sang định dạng tương thích với pipeline game.

Đây là danh sách chức năng mục tiêu. Phải triển khai và kết nối từng tool với hệ thống thực tế, không chỉ tạo tên hàm hoặc giao diện giả.

Agent cần có khả năng kết hợp nhiều tools trong một workflow, theo dõi trạng thái thực thi, xử lý lỗi, thử lại có giới hạn và lưu lại lịch sử thao tác để admin kiểm tra.

## 5. Xây dựng hệ thống vật liệu PBR và texture

Model phải được tạo ra với vật liệu phù hợp, không chỉ có hình khối đơn giản hoặc màu sắc phẳng.

Tích hợp hệ thống vật liệu dựa trên pipeline render hiện có, ưu tiên các thông số PBR:

- Base Color / Albedo.
- Normal Map.
- Roughness.
- Metallic.
- Ambient Occlusion.
- Height hoặc Displacement nếu pipeline hỗ trợ.
- Opacity và các thiết lập trong suốt khi cần.

AI Agent phải hiểu đặc tính vật liệu thực tế để chọn thông số phù hợp.

Ví dụ:

- Đá tự nhiên: roughness cao, metallic gần 0, bề mặt không đồng nhất.
- Kim loại: metallic phù hợp với loại kim loại, roughness thay đổi theo độ đánh bóng và tình trạng bề mặt.
- Gỗ: có vân gỗ, độ nhám và màu sắc biến thiên tự nhiên.
- Bê tông: bề mặt nhám, các vết nứt, bụi bẩn và biến thiên màu sắc.
- Kính: sử dụng thiết lập truyền sáng hoặc trong suốt phù hợp với render pipeline.

Các giá trị trên chỉ là định hướng. Agent cần chọn thông số theo vật liệu, phong cách nghệ thuật và khả năng render thực tế, không áp dụng cứng nhắc một bộ giá trị cho mọi asset.

Cho phép import texture pack, tái sử dụng texture hiện có, tự động gán vật liệu và kiểm tra texture bị thiếu hoặc sai định dạng.

Khi tạo model mới, ưu tiên texture có độ phân giải phù hợp, UV hợp lệ và khả năng tái sử dụng material để giảm chi phí bộ nhớ.

Không được chỉ gắn một texture màu lên model rồi coi đó là vật liệu PBR hoàn chỉnh.

## 6. Xử lý vấn đề nhà cửa hiện tại trong Battle Royale

Đây là use case đầu tiên cần được giải quyết bằng hệ thống mới.

Hiện tại, nhà cửa trong chế độ Battle Royale được tạo từ nhiều model mảng tường nhỏ ghép lại, khiến công trình thiếu tính tự nhiên, sai tỷ lệ, nhiều khe nối và chất lượng tổng thể thấp.

Hãy kiểm tra cách các căn nhà đang được tạo, lưu trữ và render trong codebase. Sau đó xây dựng workflow để:

- Tạo các căn nhà hoàn chỉnh với kiến trúc hợp lý, thay vì chỉ ghép tường một cách máy móc.
- Tạo cấu trúc có tường, sàn, mái, cửa, cửa sổ, cầu thang và các phòng liên kết đúng không gian.
- Tạo nội thất cơ bản theo yêu cầu như phòng khách, phòng ngủ, bếp và phòng ăn.
- Tạo các biến thể về hình dạng, kích thước, vật liệu, mức độ hư hỏng và chi tiết trang trí.
- Đảm bảo cửa ra vào, cửa sổ, cầu thang, sàn và mái có tỷ lệ hợp lý, không bị xuyên nhau hoặc tạo ra khoảng trống vô lý.
- Hỗ trợ tạo sân vườn, hàng rào, cây cối, đá, đường đi và các thành phần ngoại thất.
- Sinh collision phù hợp để nhân vật di chuyển, đi qua cửa, leo cầu thang và tương tác đúng với môi trường.
- Đảm bảo model có thể được sử dụng trực tiếp trong hệ thống sinh bản đồ Battle Royale hiện tại.

**Không phá vỡ hệ thống bản đồ hiện tại.** Hãy tạo một pipeline thay thế hoặc nâng cấp tương thích, cho phép kiểm thử các model mới trên bản đồ hiện có trước khi chuyển đổi hàng loạt.

## 7. Quyền truy cập của AI Agent

AI Agent cần được phép sử dụng các năng lực kỹ thuật đã có trong dự án:

- Thuật toán procedural terrain và procedural map generation.
- Hệ thống tạo geometry, mesh và các khối 3D.
- Công cụ tạo và chỉnh sửa texture/material.
- Asset registry và thư viện model.
- Các AI tools, skills và workflow liên quan.
- Tài liệu kỹ thuật và nguồn tham khảo trực tuyến.
- Hệ thống kiểm tra, tối ưu và xuất tài nguyên.

Khi cần công nghệ mới, Agent có thể nghiên cứu thư viện hoặc GitHub repository, kiểm tra license và khả năng tích hợp, sau đó đề xuất hoặc thực hiện cài đặt trong phạm vi được cho phép.

Phải có ranh giới quyền hạn rõ ràng. Agent không được tự ý xóa asset gốc, ghi đè hàng loạt tài nguyên đang sử dụng hoặc thay đổi production map mà không có bước xác nhận của admin.

Các thao tác phá hủy, ghi đè hoặc ảnh hưởng tới nhiều tài nguyên phải có preview, phương án rollback và xác nhận phù hợp.

## 8. Tích hợp API key và AI backend

Tái sử dụng cơ chế tích hợp AI từ dự án:

`D:\AEMINE_PROJECT\model-generator`

Trước tiên, kiểm tra cách dự án này cấu hình API key, lựa chọn model AI, gọi API và quản lý các prompt/workflow hiện có. Sau đó tái sử dụng hoặc trích xuất thành module dùng chung nếu kiến trúc cho phép.

Yêu cầu:

- Không hardcode API key.
- Không để API key trong frontend hoặc bundle trình duyệt.
- Gọi các API cần bảo mật thông qua backend.
- Hỗ trợ cấu hình model, provider và các tính năng AI theo kiến trúc hiện tại.
- Có timeout, xử lý lỗi, giới hạn số lần thử lại và theo dõi trạng thái tác vụ.
- Tách riêng AI reasoning, tool execution, procedural generation và asset persistence.
- Không giả định mô hình ngôn ngữ có thể tự sinh mesh hoặc texture nếu không có công cụ hỗ trợ tương ứng.
- Nếu cần model tạo ảnh, texture hoặc geometry chuyên dụng, hãy kiểm tra các API và công cụ có thể sử dụng trước khi quyết định kiến trúc.

Không được sao chép nguyên văn cấu hình bí mật từ dự án khác hoặc làm lộ thông tin xác thực trong log.

## 9. Lưu trữ, xuất bản và tương thích game

Mọi model được tạo ra phải có khả năng đi qua pipeline asset thực tế:

- Lưu cấu trúc dự án, model, material, texture và metadata.
- Theo dõi phiên bản, nguồn asset và lịch sử thay đổi.
- Preview trước khi lưu hoặc xuất bản.
- Validate model trước khi đưa vào game.
- Export GLB/GLTF hoặc định dạng mà game engine hiện tại hỗ trợ.
- Đảm bảo transform, UV, material, texture, hierarchy và collision được giữ đúng theo khả năng của định dạng.
- Có thể đăng ký model mới vào asset registry hoặc pipeline sinh bản đồ nếu kiến trúc hiện tại hỗ trợ.

Không được coi việc hiển thị được model trong viewport là bằng chứng rằng model đã sẵn sàng cho game.

## 10. Tiêu chí nghiệm thu

Chỉ coi task hoàn thành khi các luồng quan trọng đã hoạt động thực tế:

1. Admin tạo được một dự án model mới.
2. Admin import và xem được một model 3D thực tế.
3. Admin có thể tìm và tái sử dụng các asset hiện có.
4. Admin nhập prompt và AI Agent thực sự thực thi các tool để tạo hoặc lắp ghép model.
5. Model được tạo có geometry, material và texture hợp lệ theo khả năng của pipeline.
6. Admin có thể chỉnh sửa, lưu, tải lại và export model.
7. Model export có thể được import trở lại mà không mất các thuộc tính quan trọng được hỗ trợ.
8. Có thể tạo một căn nhà hoàn chỉnh với nhiều phòng, cửa, cửa sổ, mái và vật liệu phù hợp.
9. Model có thể được kiểm tra trong môi trường Battle Royale hiện tại mà không phá vỡ bản đồ hoặc các chức năng đang hoạt động.
10. Các lỗi, trường hợp không hỗ trợ và giới hạn kỹ thuật được báo cáo rõ ràng.
11. Các chức năng cốt lõi có test phù hợp và không làm hỏng những chức năng hiện có.

## 11. Cách triển khai

Thực hiện theo thứ tự:

**Phase 1 — Audit:** Phân tích codebase, dự án model-generator, renderer, asset pipeline và các thuật toán hiện có. Xác định chính xác phần có thể tái sử dụng.

**Phase 2 — Core Studio:** Triển khai tab Model Management, quản lý dự án, asset browser, viewport 3D và các công cụ chỉnh sửa cốt lõi.

**Phase 3 — AI Agent:** Triển khai backend Agent, tool registry, workflow execution, prompt interface, logging và cơ chế kiểm soát quyền hạn.

**Phase 4 — Model Pipeline:** Hoàn thiện procedural modeling, vật liệu PBR, texture, validate, lưu trữ và export.

**Phase 5 — Battle Royale Integration:** Dùng pipeline mới tạo các căn nhà hoàn chỉnh, kiểm thử trên bản đồ hiện tại và đánh giá chất lượng, hiệu năng.

**Phase 6 — Testing:** Chạy test, sửa lỗi, kiểm tra khả năng tương thích và ghi lại kết quả.

Sau mỗi phase, hãy kiểm tra các thay đổi và giữ hệ thống ở trạng thái có thể chạy được.

## Yêu cầu cuối cùng

Hãy trực tiếp đọc code, nghiên cứu công nghệ phù hợp, triển khai và kiểm thử. Không dừng lại ở việc đưa ra kế hoạch, viết tài liệu hoặc tạo một giao diện minh họa.

Ưu tiên một hệ thống thực sự có thể tạo ra các model 3D chất lượng cao, có cấu trúc rõ ràng, vật liệu hợp lý, dễ chỉnh sửa và dùng được trong game.

Thiết kế kiến trúc ngay từ đầu để sau này có thể mở rộng cùng AI Agent sang các tab **Map & Terrain, Animation Studio, Weapon Studio và Game Mode Management**, nhưng trước mắt phải hoàn thiện Model Management thành một module có giá trị sử dụng thực tế.

Nếu gặp giới hạn kỹ thuật, hãy xác định nguyên nhân, nghiên cứu phương án thay thế và triển khai phương án khả thi nhất thay vì âm thầm bỏ qua chức năng.