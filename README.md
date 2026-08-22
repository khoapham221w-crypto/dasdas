# Fast Code OCR

Tool OCR dành cho code dạng chữ/số nằm thành nhiều dòng trên màn hình.

## Chức năng
- **F1**: khoanh vùng cột code.
- **F2**: quét toàn bộ code trong vùng chỉ với một lần bấm.
- Tự tách nhiều dòng code.
- Chỉ giữ code **6 ký tự A-Z / 0-9**.
- OCR nhiều biến thể ảnh rồi vote kết quả.
- Tăng kiểm tra với hai cặp dễ nhầm: **O ↔ 0** và **I ↔ 1**.
- Tự loại code trùng.
- Hiển thị thời gian OCR theo **ms**.
- **Copy tất cả** code ra clipboard.
- OCR chạy local, không cần API.

## Cài lần đầu
1. Cài **Python 3.11 hoặc 3.12 (64-bit)**.
2. Khi cài Python, tick **Add Python to PATH**.
3. Mở thư mục tool và chạy `install.bat`.
4. Sau khi cài xong chạy `run.bat`.

## Dùng
1. Mở màn hình có danh sách code.
2. Nhấn **F1**.
3. Kéo chuột khoanh sát **cột trắng chứa code**.
4. Khi code xuất hiện, nhấn **F2**.
5. Tool sẽ đưa các code đọc được vào danh sách.

## Build thành EXE
Chạy `build_exe.bat`.

File sau khi build:
`dist\FastCodeOCR.exe`

Lưu ý: EXE one-file có thể mất vài giây lúc mở lần đầu vì phải giải nén model OCR. Khi tool đã mở, các lượt F2 sau sẽ nhanh hơn nhiều.

## Mẹo để nhanh và chính xác
- Khoanh vùng càng nhỏ càng tốt, chỉ chứa code.
- Không khoanh avatar, tên tài khoản, nút bấm.
- Nếu font nhỏ, trình duyệt để zoom 100% hoặc 110%.
- Nên để cửa sổ code có nền trắng, chữ đậm rõ.
- Tool hiện mặc định code dài 6 ký tự. Nếu hệ thống đổi độ dài code, sửa `CODE_LEN = 6` trong `main.py`.

## Về O/0 và I/1
Không có OCR nào đảm bảo 100% nếu hai glyph của font gần như giống hệt nhau. Tool này chạy nhiều preprocessing và vote để giảm lỗi. Nếu website có quy luật riêng (ví dụ không bao giờ dùng chữ O hoặc không bao giờ dùng số 1), có thể khóa quy luật đó để độ chính xác tăng mạnh.
