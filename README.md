# Fast Code OCR v2

## Điểm khác bản v1
- Bản v1 OCR lại từng dòng nhiều lần nên có thể rất chậm.
- Bản v2 chỉ chạy OCR **1 lần cho toàn bộ vùng đã chọn**.
- F1: chọn vùng.
- F2: quét nhanh.
- Tự copy các code vừa quét nếu bật "Tự copy sau OCR".
- Giữ thứ tự từ trên xuống.
- Chỉ lấy chuỗi 6 ký tự A-Z/0-9.

## Build trên GitHub
Upload toàn bộ file, bao gồm `.github/workflows/build.yml`.
Vào Actions -> Build FastCodeOCR v2 Windows EXE -> Run workflow.
Sau khi thành công tải artifact `FastCodeOCR-v2-Windows`.

## Lưu ý
Bản này chỉ làm OCR và copy code. Không bypass Cloudflare/Turnstile và không tự submit hàng loạt.
