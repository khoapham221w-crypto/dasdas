# CODE BY THÁNH NỮ v0.5.5 — MM88 PRESET

Mình rà soát lại v0.5.3 và phát hiện 2 lỗi thật, nên v0.5.4 sửa chúng:

1. Danh sách đã lưu ở v0.5.3 có thể hiện `\n` thành chữ thay vì xuống dòng thật sau khi mở lại app.
2. Bộ lọc OCR v0.5.3 vẫn cho phép chuỗi 4–12 ký tự; v0.5.4 chỉ giữ đúng **6 ký tự A-Z/0-9**.

Sửa thêm:
- Code dán thủ công cũng bị lọc đúng 6 ký tự trước khi chạy.
- Crop OCR xử lý DPI tốt hơn.
- Mapping vẫn là **1 code → 1 acc theo thứ tự**.

MM88 preset:
- `https://api.mm88code.com/codes/use-code-public`
- POST / JSON
- `username`, `code`
- concurrency 1

Giới hạn:
- Backend còn yêu cầu `captchaToken`.
- Tool không tạo/replay/bypass Cloudflare/Turnstile token.
- Nếu API yêu cầu verification, tool dừng và báo `CẦN XÁC MINH`.

Build:
GitHub → Actions → `Build Code By Thánh Nữ v0.5.5 MM88 Portable`
Artifact: `CodeByThanhNu-v055-MM88-Windows-Portable`
