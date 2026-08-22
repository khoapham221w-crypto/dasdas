# CODE BY THÁNH NỮ v0.5.7 — F2 AUTO + MM88 VERIFY

## Luồng hoạt động
- **F1**: chọn vùng OCR.
- **F2**: OCR vùng đã chọn → lấy code → tự chạy ngay, không cần bấm nút Chạy.
- Mapping giữ nguyên **code 1 → acc 1, code 2 → acc 2...**
- Các cặp hợp lệ được khởi chạy song song.
- Nếu số tài khoản và code lệch nhau, chỉ dùng `min(acc, code)` cặp đầu tiên.
- OCR chỉ giữ code đúng **6 ký tự A-Z/0-9**.

## Xác minh MM88 / Turnstile
- Mỗi cặp chạy trên **trang MM88 thật** trong Chromium của Electron.
- Tool tự điền tài khoản và code.
- Turnstile được để chạy theo cơ chế bình thường của website.
- Nếu Turnstile tự xác minh thành công, tool tự bấm gửi và tiếp tục ngầm.
- Nếu Turnstile yêu cầu thao tác người dùng, cửa sổ MM88 của cặp đó sẽ hiện ra. Sau khi bạn xác minh hợp lệ, tool tự bấm gửi và đóng cửa sổ khi có kết quả.
- Tool **không tạo, lấy ra, replay hoặc bypass `captchaToken`**.
- **STOP** đóng toàn bộ cửa sổ xác minh đang chạy.

## Lưu ý
Website có thể giới hạn tốc độ. Khởi chạy nhiều cặp cùng lúc vẫn có thể nhận `RATE_LIMIT_EXCEEDED`; việc xác minh hợp lệ không loại bỏ rate-limit của server.

## Build
GitHub → Actions → `Build Code By Thánh Nữ v0.5.7 MM88 Portable`

Artifact: `CodeByThanhNu-v057-MM88-Windows-Portable`

EXE: `CodeByThanhNu-0.5.7-portable.exe`
