# CODE BY THÁNH NỮ v0.5.9 — AUDIT FIX

## Luồng chính
- F1: tool tạm ẩn rồi cho chọn vùng OCR.
- F2: tool tạm ẩn → chụp vùng → OCR → tự chạy batch ngay.
- Mapping giữ đúng thứ tự: code 1 → acc 1, code 2 → acc 2...
- OCR chỉ lấy mã đúng 6 ký tự A-Z/0-9.
- Không tự sửa O/0 hoặc I/1.
- Các phiên MM88 được khởi chạy song song.
- Phiên nào Turnstile tự xác minh hợp lệ thì tiếp tục ngay.
- Nếu nhiều phiên cùng cần thao tác người dùng, cửa sổ xác minh được hiện lần lượt để không tranh focus.

## Fix audit
- Khóa OCR: bấm F2 liên tục không tạo nhiều OCR chồng nhau.
- Khóa khởi tạo Tesseract worker: warm-up và F2 không tạo 2 worker cùng lúc.
- Chặn F1/F2 khi batch cũ vẫn đang chạy.
- Clamp vùng crop theo kích thước screenshot thật, tránh lỗi extract ở Windows scaling 125%/150%.
- Không âm thầm chụp nhầm monitor nếu Electron không map được display_id.
- F1 luôn hiện lại cửa sổ tool nếu overlay lỗi.
- Giữ code OCR theo đúng thứ tự, không dedupe làm dịch mapping.
- Các cửa sổ cần xác minh tay không còn cùng lúc giành focus.
- Giao diện ghi đúng là gửi qua trang MM88, không gây hiểu nhầm là API thuần.
- Pin version dependency để build GitHub ổn định hơn.
- Sửa các tên artifact/version bị sót từ bản trước.

## Turnstile
Tool chỉ để Turnstile chạy theo cơ chế bình thường trên trang MM88. Tool không tạo, replay hoặc bypass captchaToken.

## Build
GitHub → Actions → `Build Code By Thánh Nữ v0.5.9 MM88 Portable`

Artifact:
`CodeByThanhNu-v059-MM88-Windows-Portable`

EXE:
`CodeByThanhNu-0.5.9-portable.exe`
