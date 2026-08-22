# THÁNH NỮ v0.5.2

- Đổi logic gửi từ **mọi acc × mọi code** sang **ghép 1-1 theo thứ tự**.
- Ví dụ quét 5 code thì chỉ dùng 5 tài khoản đầu tiên:
  - code 1 → acc 1
  - code 2 → acc 2
  - code 3 → acc 3
- Nếu code nhiều hơn acc: phần code dư bỏ qua.
- Nếu acc nhiều hơn code: acc dư không chạy.
- Vẫn giữ fix OCR của v0.5.1.

# SỬA LỖI v0.5.1
- Sửa lỗi `ENOENT ... app.asar.unpacked/node_modules/screenshot-desktop...` khi bấm F2 trên file EXE portable.
- Không dùng `screenshot-desktop` nữa; chuyển sang `Electron desktopCapturer`, nên không phụ thuộc file binary ngoài bị thiếu khi đóng gói.
- Giữ nguyên F1 chọn vùng, F2 OCR và batch API-first.

# THÁNH NỮ v0.5.1 — API-FIRST

Bản v0.5 sửa các điểm yếu của v0.4.

## Đã sửa
- Có nút **STOP** để hủy batch đang chạy.
- Request hỗ trợ **JSON / application/x-www-form-urlencoded / query params**.
- Lưu **vùng OCR** sau khi tắt/mở lại tool.
- OCR worker được warm-up khi mở app để giảm độ trễ lần F2 đầu tiên.
- OCR chỉ chạy một lượt cho cả vùng; có chọn scale 1.0x / 1.5x / 2.0x.
- Thử hỗ trợ chọn vùng trên màn hình nơi con trỏ đang đứng.
- Phát hiện challenge chắc hơn:
  - nội dung Turnstile / challenge-platform / verify-human
  - header `cf-ray` / `server: cloudflare`
  - kết hợp HTTP 403 / 429 / 503
- Mặc định **dừng toàn bộ batch** khi phát hiện challenge.
- Có progress `done/total`.
- Có trạng thái riêng cho từng account/code.
- Request đang chạy có thể bị Abort khi bấm STOP.

## Cấu hình request
Tool vẫn chưa hard-code endpoint của mm88code.com.
Cần lấy từ một request hợp lệ của chính website:
- Request URL
- Method
- Body mode: JSON / Form / Query
- Field tài khoản
- Field code
- Headers/cookie hợp lệ nếu website yêu cầu

Không dùng CAPTCHA/Turnstile token để né xác minh.

## Build
GitHub → Actions → `Build Thánh Nữ v0.5 API Portable` → Run workflow.
Tải artifact `ThanhNu-v05-API-Windows-Portable`.
File EXE: `ThanhNu-0.5.0-portable.exe`.

## Lưu ý OCR
Tesseract.js vẫn là OCR portable dễ build nhất trong bản này.
Nếu cần <1 giây ổn định trên máy net yếu, bước nâng cấp tiếp theo là thay OCR bằng engine ONNX/native.
