# TASK: Implement Zombie Wave Survival Mode — Party Lobby, Bot System & Leaderboards

## 1. Mục tiêu

Phát triển chế độ **Zombie Wave Survival** cho ZION, cho phép người chơi lập đội với bạn bè hoặc chơi một mình cùng bot. Trải nghiệm cần có nhịp độ chiến đấu nhanh, zombie ngày càng nguy hiểm theo từng wave nhưng vẫn giữ cảm giác bắn súng đã tay.

Trước khi triển khai, hãy nghiên cứu cấu trúc code, hệ thống multiplayer, menu chính, UI design system, bản đồ, combat, AI zombie và dữ liệu người chơi hiện có. Tái sử dụng kiến trúc và component phù hợp, không xây dựng một hệ thống độc lập gây trùng lặp logic.

## 2. Game mode và cơ chế Wave

- Người chơi chiến đấu với các đợt zombie liên tiếp trên một bản đồ được chọn trước.
- Khi bắt đầu wave, khu vực chiến đấu được khóa để ngăn người chơi rời khỏi arena.
- Zombie xuất hiện theo từng đợt. Khi tiêu diệt toàn bộ zombie, chuyển sang giai đoạn nghỉ ngắn để người chơi loot súng, đạn, medkit và chuẩn bị cho wave tiếp theo.
- Độ khó tăng dần qua số lượng zombie, tốc độ tiếp cận, tần suất tấn công, cách phối hợp, hướng tiếp cận và thành phần zombie.
- Có thể bổ sung các biến thể zombie với hành vi, tốc độ, tầm tấn công hoặc kỹ năng khác nhau để tạo áp lực chiến thuật.
- **Giữ HP cố định cho từng loại zombie.** Không tăng HP vô hạn theo wave. Người chơi cần duy trì cảm giác bắn trúng, gây sát thương rõ ràng và tiêu diệt zombie trong thời gian hợp lý.
- Tăng độ khó chủ yếu bằng số lượng, mật độ, nhịp spawn, khả năng bao vây, sự đa dạng của kẻ địch và áp lực tài nguyên. Điều chỉnh các thông số dựa trên thời gian sống sót, tỷ lệ tiêu diệt và khả năng phối hợp của đội.
- Khi toàn đội bị hạ, kết thúc lượt chơi, lưu kết quả và cung cấp nút chơi lại nhanh.

## 3. Party System — Chơi cùng bạn bè hoặc bot

Người chơi có thể chọn một trong hai chế độ trước khi bắt đầu trận:

### A. Chơi cùng bạn bè
- Cho phép tạo đội, mời bạn bè và tham gia phòng thông qua hệ thống multiplayer hiện có.
- Đội có tối đa **4 người chơi**, bao gồm chủ phòng.
- Bốn slot hiển thị trạng thái rõ ràng: chủ phòng, người chơi đã tham gia, slot trống và trạng thái sẵn sàng nếu hệ thống hỗ trợ.
- Chủ phòng có quyền chọn bản đồ, bắt đầu trận và quản lý thành viên theo cơ chế quyền hạn hiện có.
- Các thành viên phải đồng bộ cùng bản đồ, chế độ chơi và cấu hình trận.
- Không cho bắt đầu khi chưa đáp ứng điều kiện của phòng hoặc khi trạng thái kết nối của thành viên không hợp lệ.

### B. Chơi cùng bot
- Hỗ trợ chơi solo không bot hoặc thêm từ **1 đến 3 bot**.
- Tổng số nhân vật trong đội tối đa là 4, tính cả người chơi thật và bot.
- Có thể thêm hoặc bỏ bot trước khi bắt đầu trận.
- Bot phải được thể hiện trực tiếp trong các slot của đội; phân biệt rõ bot và người chơi thật.
- Bot cần có AI hỗ trợ chiến đấu thực tế: di chuyển cùng đội, tìm và tấn công zombie, phản ứng với nguy hiểm, tránh bị mắc kẹt, hỗ trợ đồng đội khi phù hợp và sử dụng tài nguyên theo khả năng của hệ thống.
- Bot không được chỉ đứng yên, chạy theo người chơi một cách máy móc hoặc tự động tiêu diệt zombie bằng các hành vi gian lận không hợp lý.
- Độ khó của bot nên được điều chỉnh thông qua độ chính xác, phản ứng, hành vi chiến đấu và khả năng hỗ trợ, không phải bằng cách tăng sức mạnh vô lý.

## 4. Main Menu — Party Lobby Modal

Thiết kế một **modal lớn xuất hiện ngay tại menu chính**, đóng vai trò là điểm bắt đầu của chế độ Zombie Wave Survival.

### Bố cục chính

- Modal đủ rộng để tạo cảm giác đây là một màn hình lập đội hoàn chỉnh, không phải popup nhỏ.
- Bố cục tham khảo cách tổ chức phòng chờ của Liên Quân Mobile: đội hình thành viên là trọng tâm, thông tin trận đấu rõ ràng, các thao tác quan trọng dễ tìm.
- Chỉ tham khảo cấu trúc và trải nghiệm sử dụng, không sao chép giao diện, hình ảnh hoặc nhận diện thương hiệu của Liên Quân.
- Bám sát DNA giao diện hiện tại của ZION: màu sắc, typography, nền, hiệu ứng, đường viền, icon, độ tương phản, phong cách military/survival và ngôn ngữ thiết kế đang sử dụng.
- Không tự ý đổi design system toàn game hoặc tạo ra một giao diện lạc tông.

### A. Switch chọn chế độ

Đặt một **switch/segmented control lớn, nổi bật, dễ nhận biết** ở phần đầu modal để chuyển giữa:

- Chơi cùng bạn bè.
- Chơi cùng bot.

Trạng thái đang chọn phải có độ tương phản rõ ràng, animation chuyển trạng thái mượt và phản hồi tương tác tốt. Khi chuyển chế độ, nội dung bốn slot, các thao tác và thông tin liên quan phải cập nhật tương ứng mà không đóng modal.

### B. Bốn slot đội hình

Hiển thị chính xác **4 ô vuông đại diện cho 4 vị trí trong đội**, có kích thước đủ lớn và bố cục cân đối.

Mỗi slot cần có:

- Avatar hoặc hình đại diện nhân vật.
- Tên người chơi hoặc tên bot.
- Trạng thái slot: trống, đang chờ, đã sẵn sàng hoặc trạng thái tương ứng.
- Nhận diện trực quan người chơi thật, bot và chủ phòng.
- Hiệu ứng hover, selected và transition nhất quán với UI hiện tại.

Ở chế độ bạn bè, slot trống có thể dùng để mời thành viên. Ở chế độ bot, slot trống cho phép thêm bot nếu đội chưa đủ bốn vị trí. Slot phải phản ánh đúng trạng thái thực tế của phòng, không chỉ là hình ảnh trang trí.

### C. Chọn bản đồ

Bổ sung khu vực chọn bản đồ ngay trong modal.

- Hiển thị danh sách hoặc các thẻ bản đồ bằng hình ảnh xem trước phù hợp.
- Làm nổi bật bản đồ đang được chọn.
- Có thể xem tên bản đồ và thông tin ngắn cần thiết.
- Việc đổi bản đồ phải cập nhật cấu hình phòng và được đồng bộ với các thành viên trong đội.
- Chỉ cho phép chọn những bản đồ được hỗ trợ bởi chế độ Wave Survival.
- Có thể mở rộng để mỗi bản đồ có đặc trưng chiến đấu riêng, nhưng không bắt buộc tạo bản đồ mới trong task này.

### D. Nút Play

- Đặt nút **PLAY** ở vị trí dễ thấy, là hành động chính của modal.
- Nút có kích thước, độ tương phản và trạng thái tương tác nổi bật theo design system hiện tại.
- Ở chế độ bạn bè, chỉ chủ phòng được bắt đầu trận; các điều kiện sẵn sàng và kết nối phải được xác thực.
- Ở chế độ bot, nút bắt đầu trận với cấu hình số lượng bot hiện tại.
- Hiển thị trạng thái loading trong quá trình khởi tạo trận; không cho phép gửi nhiều yêu cầu bắt đầu liên tiếp.
- Khi bắt đầu, truyền chính xác bản đồ, đội hình, chế độ chơi và số lượng bot sang hệ thống tạo trận.

## 5. Hệ thống bảng xếp hạng — 8 bảng riêng biệt

Xây dựng hệ thống xếp hạng cho Zombie Wave Survival với **8 bảng độc lập cho mỗi bản đồ**. Không gộp kết quả của các kiểu đội hình khác nhau vào cùng một bảng.

### A. Chơi cùng bot — 4 bảng

| Bảng | Điều kiện |
|---|---|
| Solo | 1 người chơi, 0 bot |
| Duo Bot | 1 người chơi, 1 bot |
| Trio Bot | 1 người chơi, 2 bot |
| Squad Bot | 1 người chơi, 3 bot |

### B. Chơi cùng bạn bè — 4 bảng

| Bảng | Điều kiện |
|---|---|
| Solo Player | 1 người chơi thật |
| Duo Players | 2 người chơi thật |
| Trio Players | 3 người chơi thật |
| Full Squad | 4 người chơi thật |

Trong nhóm chơi cùng bạn bè, phân loại theo **số lượng người chơi thật thực tế trong trận**. Không tính bot vào số lượng người chơi thật. Nếu hệ thống cho phép bổ sung bot vào phòng bạn bè, phải xác định rõ quy tắc phân loại trước khi triển khai; mặc định nên tách cấu hình đó khỏi bốn bảng bạn bè nêu trên.

### Quy tắc bảng xếp hạng

- Mỗi bản đồ có đủ 8 bảng nói trên.
- Tổng số bảng được quản lý là `số bản đồ hỗ trợ × 8`.
- Khi xem bảng xếp hạng, người chơi có thể chọn bản đồ, sau đó chọn một trong 8 loại bảng.
- Kết quả chỉ được ghi vào bảng tương ứng với bản đồ và cấu hình đội hình của trận.
- Tiêu chí xếp hạng chính là wave cao nhất đã hoàn thành hoặc wave đạt được theo quy tắc thống nhất. Khi bằng wave, dùng các tiêu chí phụ có thể kiểm chứng như thời gian sống sót hoặc thời gian hoàn thành wave.
- Lưu thêm các dữ liệu cần thiết để hiển thị thành tích: người chơi hoặc đội, bản đồ, loại đội hình, wave, thời gian sống sót và thời điểm đạt thành tích.
- Nếu xếp hạng theo đội, xác định rõ cách hiển thị tên đội và thành viên; tránh tạo nhiều bản ghi trùng lặp cho cùng một thành tích.
- Kết quả phải được xác thực phía server. Không tin dữ liệu wave, thời gian hoặc số lượng zombie do client tự gửi lên.
- Không được để một trận chơi với 3 bot lọt vào bảng Solo hoặc bảng Full Squad của người chơi thật.
- Thiết kế schema và API đủ linh hoạt để thêm bản đồ mà không cần tạo thủ công từng bảng vật lý riêng biệt. Dùng các trường phân loại như `mapId`, `playMode` và `teamSize` hoặc cấu trúc tương đương.

## 6. Kết nối gameplay và hệ thống hiện có

- Tái sử dụng hệ thống đăng nhập, bạn bè, party, matchmaking, bản đồ, combat và lưu kết quả hiện có nếu đã tồn tại.
- Nếu thiếu một phần, triển khai bổ sung theo kiến trúc hiện tại thay vì tạo dữ liệu giả hoặc UI chỉ hoạt động ở frontend.
- Trận đấu phải có trạng thái rõ ràng: tạo phòng, chờ thành viên, khởi tạo, đang chơi, kết thúc và lưu kết quả.
- Server là nguồn dữ liệu có thẩm quyền đối với thành viên trong phòng, số lượng bot, tiến trình wave, trạng thái zombie và kết quả xếp hạng.
- Xử lý các trường hợp rời phòng, mất kết nối, chủ phòng thoát, bắt đầu trận thất bại, bot không khởi tạo được và gửi yêu cầu lặp.
- Đảm bảo cơ chế wave không phá vỡ tick loop, đồng bộ multiplayer hoặc hiệu năng của game hiện tại.

## 7. Yêu cầu UI/UX và chất lượng

- Giao diện phải đẹp, có chiều sâu, đúng chất game survival và nhất quán với ZION.
- Modal lập đội cần có phân cấp thị giác rõ: chọn chế độ → đội hình → bản đồ → bắt đầu trận.
- Không nhồi nhét quá nhiều thông tin, không sử dụng quá nhiều màu nhấn hoặc hiệu ứng gây rối.
- Animation chuyển tab, chọn slot, thêm bot và chọn bản đồ phải mượt; có trạng thái hover, active, disabled và loading phù hợp.
- Responsive với độ phân giải mục tiêu của game.
- Không để modal che khuất các thao tác cần thiết hoặc tạo scroll không hợp lý.
- Các trạng thái rỗng, lỗi, loading và kết nối phải được thiết kế đầy đủ, không chỉ làm đẹp cho trường hợp thành công.

## 8. Phạm vi chưa triển khai

**Tạm thời bỏ qua hoàn toàn hệ thống nâng cấp dạng quân bài/roguelite**, bao gồm thiết kế card, chọn 1 trong 3 nâng cấp, hiệu ứng meme và combo giữa các nâng cấp. Không xây dựng những thành phần này như một phần của task hiện tại.

Tập trung vào chế độ wave, party lobby, bot, chọn bản đồ và bảng xếp hạng. Giai đoạn nghỉ giữa các wave có thể dùng để loot đạn, súng và medkit theo hệ thống vật phẩm hiện có.

## 9. Tiêu chí nghiệm thu

- [ ] Modal lập đội xuất hiện trực tiếp từ menu chính và bám sát giao diện ZION hiện tại.
- [ ] Có switch lớn, rõ ràng để chuyển giữa chơi với bạn bè và chơi với bot.
- [ ] Hiển thị đúng 4 slot; trạng thái thành viên và bot phản ánh dữ liệu thật.
- [ ] Có thể chơi solo với 0 bot, hoặc chọn 1, 2, 3 bot; không vượt quá 4 nhân vật trong đội.
- [ ] Có thể tạo đội và chơi cùng bạn bè với tối đa 4 người chơi thật.
- [ ] Chọn được bản đồ trước khi bắt đầu trận.
- [ ] Wave tăng độ khó bằng số lượng, nhịp độ, hành vi và thành phần zombie; HP của từng loại zombie không tăng vô hạn theo wave.
- [ ] Có giai đoạn nghỉ sau wave để loot và chuẩn bị.
- [ ] Khi đội bị hạ, kết quả được lưu và có thể chơi lại nhanh.
- [ ] Mỗi bản đồ có đủ 8 bảng xếp hạng, phân loại chính xác theo chế độ và số lượng người chơi.
- [ ] Kết quả xếp hạng được xác thực phía server và không bị ghi nhầm bảng.
- [ ] Multiplayer, bot, wave và UI xử lý đầy đủ các trạng thái lỗi cơ bản.
- [ ] Có kiểm thử cho các cấu hình đội hình, quy tắc phân bảng và luồng kết thúc trận.
- [ ] Không làm hỏng các chế độ chơi hoặc hệ thống hiện có.

**Cách triển khai:** Kiểm tra codebase và báo cáo ngắn kiến trúc hiện tại trước; sau đó triển khai xuyên suốt từ UI đến server, lưu trữ dữ liệu và kiểm thử. Không dừng ở mockup giao diện hoặc dữ liệu giả. Ưu tiên tái sử dụng code, tránh thay đổi ngoài phạm vi và báo rõ các giới hạn nếu hệ thống hiện tại chưa hỗ trợ một tính năng.