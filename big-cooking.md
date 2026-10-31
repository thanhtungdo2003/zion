# TASK: BUILD ADVANCED AUTONOMOUS BATTLEFIELD AI FOR ZION

Nâng cấp toàn diện hệ thống Bot AI trong chế độ Battlefield của Zion. Không chỉ sửa lỗi tìm đường mà phải xây dựng hệ thống AI tác chiến có khả năng tự nhận thức, lập kế hoạch, phối hợp nhóm và chiến đấu độc lập.

## 1. RESEARCH SOURCE CODE

Nghiên cứu và tận dụng các source code, thuật toán sau:

- Recast Navigation: https://github.com/recastnavigation/recastnavigation
- BehaviorTree.CPP: https://github.com/BehaviorTree/BehaviorTree.CPP
- Game AI Algorithms: https://github.com/CanReader/game-ai-cheatsheet
- Hannibal AI: https://github.com/agentx-cgn/Hannibal
- Game AI Pro: https://www.gameaipro.com/
- Jeff Orkin GOAP / F.E.A.R.: https://static.hlt.bme.hu/szemantika/Index/goap.html
- Craig Reynolds Steering Behaviors: https://ics-websites.science.uu.nl/docs/vakken/mcrws/papers_new/Reynolds%20-%201999%20-%20Steering%20behaviors%20for%20autonomous%20characters.pdf
- Multi-Agent Pathfinding: https://arxiv.org/abs/2505.19219
- Real-Time Game AI Planning: https://ojs.aaai.org/index.php/AIIDE/article/view/18724

Không chỉ đọc tên repository. Hãy kiểm tra implementation, lựa chọn thuật toán phù hợp và tái sử dụng thư viện nếu tương thích với kiến trúc Zion. Không tích hợp những dependency không cần thiết.

## 2. AUTONOMOUS NAVIGATION

Đây là ưu tiên cao nhất.

- Tìm đường thông minh qua hàng rào, tường, nhà cửa và địa hình phức tạp.
- Tự tìm đường vòng khi bị chặn.
- Phát hiện dead-end và trạng thái stuck.
- Tự tính toán lại đường đi khi thất bại.
- Không lặp vô hạn một tuyến đường lỗi.
- Tránh va chạm với đồng đội.
- Hỗ trợ nhiều bot di chuyển cùng lúc.

Nghiên cứu và áp dụng NavMesh, A*, D* Lite, DetourCrowd, Steering Behaviors và các thuật toán phù hợp.

## 3. INDIVIDUAL INTELLIGENCE

Mỗi bot phải có bộ não riêng, bao gồm:

- Perception: nhận biết địch, đồng đội, âm thanh và vật cản.
- Memory: ghi nhớ vị trí địch đã phát hiện và môi trường.
- Behavior Tree: điều phối hành vi.
- Utility AI: lựa chọn hành động phù hợp.
- GOAP: tự lập kế hoạch hành động.
- Cover Selection: tìm và lựa chọn vị trí ẩn nấp.
- Personality: mỗi bot có phong cách chiến đấu riêng.

Bot không được biết vị trí đối phương nếu chưa phát hiện hoặc nhận thông tin từ đồng đội.

## 4. SQUAD INTELLIGENCE

Tổ chức bot thành các nhóm 3–4 thành viên, có Squad Leader.

Mỗi thành viên có nhiệm vụ riêng:
- Leader: điều phối và lập kế hoạch.
- Assault: tiến công.
- Support: hỗ trợ đồng đội.
- Recon: quan sát và phát hiện địch.

Áp dụng HTN, Squad Blackboard, Task Allocation và Steering Behaviors.

Nhóm phải có khả năng:
- Di chuyển theo đội hình.
- Chia sẻ thông tin.
- Phân công nhiệm vụ.
- Thay đổi chiến thuật.
- Tự tập hợp lại khi bị phân tán.
- Phân công lại khi một thành viên bị hạ.

## 5. ADVANCED TACTICAL AI

Bot phải biết:
- Tìm vị trí che chắn thực sự.
- Quan sát và đánh giá khu vực.
- Lựa chọn vị trí chiến thuật.
- Thay đổi đường tiếp cận.
- Phối hợp với đồng đội.
- Phòng thủ và kiểm soát khu vực.
- Phản ứng với tình huống bất ngờ.
- Tự lập kế hoạch mới khi chiến thuật thất bại.

Sử dụng Influence Maps, Tactical Position Scoring, Cover Selection và Dynamic Replanning.

Mỗi bot có personality riêng: Aggressive, Defensive, Tactical hoặc Cautious.

## 6. SERVER PERFORMANCE

Zion sử dụng server authoritative với simulation tick 30 Hz.

- Không chạy toàn bộ AI nặng ở mỗi tick.
- Sử dụng Event-driven AI và Staggered Updates.
- Cache kết quả perception và pathfinding.
- Chia sẻ tính toán giữa các thành viên trong squad.
- Giới hạn ngân sách CPU cho từng nhóm AI.
- Không để AI làm chậm physics, networking hoặc server tick.

Server vẫn kiểm soát kết quả cuối cùng và trạng thái game.

## 7. IMPLEMENTATION REQUIREMENTS

Trước tiên, kiểm tra toàn bộ kiến trúc AI, navigation, movement, physics và server hiện tại của Zion.

Sau đó:
1. Đánh giá những gì đã có và những gì đang thiếu.
2. Thiết kế kiến trúc AI thống nhất.
3. Triển khai trực tiếp vào codebase.
4. Không tạo hệ thống mới trùng lặp với hệ thống hiện có.
5. Giữ tương thích với multiplayer và authoritative server.
6. Tạo công cụ debug trực quan: đường đi, waypoint, trạng thái bot, mục tiêu, vị trí nấp và squad assignments.
7. Viết test mô phỏng nhiều bot trong bản đồ có hàng rào, nhà cửa, đường cụt và vật cản.

**ACCEPTANCE CRITERIA:**

- Bot không còn mắc kẹt liên tục trước hàng rào.
- Tự tìm đường vòng khi gặp vật cản.
- Mỗi bot có quyết định và tính cách riêng.
- Nhóm 3–4 bot phối hợp tác chiến thực sự.
- Biết tìm chỗ nấp, quan sát và thay đổi chiến thuật.
- Có khả năng tự phục hồi khi kế hoạch thất bại.
- Hoạt động ổn định với nhiều bot mà không gây quá tải server.

Không dừng lại ở việc viết tài liệu hoặc đề xuất kiến trúc. Hãy thực sự nghiên cứu, lập kế hoạch và triển khai code. Không giả lập trí thông minh bằng các hành vi hardcode đơn giản.