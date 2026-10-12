# Trọng lượng và vũ khí mới

Thông số gameplay nằm trong `packages/shared/src/weapons.ts`, dùng chung cho máy chủ và client.

- Chỉ vũ khí đang cầm ảnh hưởng di chuyển và thể lực. Vũ khí trên lưng hoặc trong túi không tính.
- Tốc độ vũ khí: giảm 1,8% mỗi kg, tối đa 40%. Nhân với hệ số tốc độ của giáp.
- Hao thể lực vũ khí: tăng 5,5% mỗi kg khi chạy, lướt và tấn công.
- Giáp tăng hao thể lực 1,5% mỗi kg; nhân với hệ số vũ khí.
- Không thay đổi trọng lượng làm tròn trên giao diện; tính toán dùng số thực.

| Vũ khí | Trọng lượng | Sát thương | Băng đạn | Ghi chú |
| --- | ---: | ---: | ---: | --- |
| PKM | 15 kg | 22 | 100 | 600 phát/phút; nạp 4 giây |
| Barrett M82 | 14 kg | 145 | 10 | .50 BMG; 10×; nạp 4,2 giây; đẩy lùi ×1,8 |
| AWM | 6,5 kg | 95 | 5 | 8× |
| Rìu cứu hỏa | 3,5 kg | 65 | — | 1,05 giây/đòn; tầm 2,8 m; chặt đầu 18% |
| Katana | 1,4 kg | 38 | — | Chặt đầu 12% |
| Quắm | 2,2 kg | 50 | — | Chặt đầu 16% |

Máy chủ chỉ thử tỷ lệ chặt đầu sau khi xác nhận đòn đánh trúng zombie, trong tầm và không bị tường chặn. Áp dụng cả đòn chính và chém lan, kể cả zombie khổng lồ. Không áp dụng lên người chơi hoặc động vật; xẻng, búa và tay không không có tỷ lệ này.

Chặt đầu kích hoạt luồng chết, nhiệm vụ và rơi vật phẩm hiện có. Bit 6 trong byte trạng thái zombie lưu việc mất đầu; bit 4–5 vẫn lưu biến thể. Client tách bản sao đầu từ model đang dùng, mô phỏng rơi xuống địa hình và dọn cùng xác zombie. Snapshot cũng khôi phục được trạng thái mất đầu khi vào vùng nhìn sau đó.

Barrett, hộp đạn .50 BMG và rìu có trong shop. Barrett dùng ô vũ khí nặng 8×2. Cần cập nhật đồng thời client/server vì phiên bản giao thức tăng lên 17.
