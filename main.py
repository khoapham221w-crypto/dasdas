
import tkinter as tk
from tkinter import ttk, messagebox
import threading
import time
import re
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from PIL import ImageGrab, Image, ImageTk
import keyboard

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception as e:
    RapidOCR = None
    RAPID_IMPORT_ERROR = e


APP_TITLE = "Fast Code OCR"
CODE_LEN = 6
ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

# Cặp ký tự dễ nhầm theo mẫu code người dùng cung cấp
AMBIGUOUS_PAIRS = {
    "O": "0",
    "0": "O",
    "I": "1",
    "1": "I",
}

def normalize_text(s: str) -> str:
    s = s.upper().strip()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s

def looks_like_code(s: str) -> bool:
    return len(s) == CODE_LEN and all(c in ALLOWED for c in s)

def ambiguity_distance(a: str, b: str) -> bool:
    """True nếu hai chuỗi chỉ khác nhau ở O/0 hoặc I/1."""
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if AMBIGUOUS_PAIRS.get(x) != y:
            return False
    return True

def pick_consensus(candidates):
    """
    Ưu tiên:
    1) chuỗi xuất hiện nhiều nhất
    2) nếu chỉ khác O/0, I/1 thì vote theo từng vị trí
    """
    candidates = [c for c in candidates if looks_like_code(c)]
    if not candidates:
        return None

    counts = Counter(candidates)
    best, n = counts.most_common(1)[0]
    if n >= 2 or len(candidates) == 1:
        return best

    # Gom nhóm các chuỗi gần nhau chỉ khác ký tự mơ hồ
    groups = []
    for c in candidates:
        placed = False
        for g in groups:
            if ambiguity_distance(c, g[0]):
                g.append(c)
                placed = True
                break
        if not placed:
            groups.append([c])

    groups.sort(key=len, reverse=True)
    g = groups[0]
    if len(g) == 1:
        return best

    out = []
    for i in range(CODE_LEN):
        chars = [x[i] for x in g]
        out.append(Counter(chars).most_common(1)[0][0])
    return "".join(out)


class RegionSelector(tk.Toplevel):
    def __init__(self, master, callback):
        super().__init__(master)
        self.callback = callback
        self.attributes("-fullscreen", True)
        self.attributes("-alpha", 0.28)
        self.attributes("-topmost", True)
        self.configure(bg="black")
        self.canvas = tk.Canvas(self, cursor="cross", bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        self.start_x = self.start_y = 0
        self.rect = None

        self.canvas.bind("<ButtonPress-1>", self.on_down)
        self.canvas.bind("<B1-Motion>", self.on_move)
        self.canvas.bind("<ButtonRelease-1>", self.on_up)
        self.bind("<Escape>", lambda e: self.destroy())

        label = tk.Label(
            self,
            text="Kéo chuột khoanh vùng CỘT CODE • ESC để hủy",
            font=("Segoe UI", 18, "bold"),
            bg="black",
            fg="white",
        )
        label.place(relx=0.5, y=30, anchor="n")

    def on_down(self, e):
        self.start_x, self.start_y = e.x_root, e.y_root
        if self.rect:
            self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(
            e.x, e.y, e.x, e.y, outline="red", width=3
        )

    def on_move(self, e):
        x1 = self.start_x - self.winfo_rootx()
        y1 = self.start_y - self.winfo_rooty()
        self.canvas.coords(self.rect, x1, y1, e.x, e.y)

    def on_up(self, e):
        x1, y1 = self.start_x, self.start_y
        x2, y2 = e.x_root, e.y_root
        left, right = sorted([x1, x2])
        top, bottom = sorted([y1, y2])

        if right - left < 30 or bottom - top < 20:
            messagebox.showwarning("Vùng quá nhỏ", "Hãy khoanh vùng lớn hơn.")
            return

        self.destroy()
        self.callback((left, top, right, bottom))


class OCRApp:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("760x610")
        self.root.minsize(700, 540)

        self.region = None
        self.engine = None
        self.busy = False
        self.seen_codes = set()
        self.last_image = None

        self.status_var = tk.StringVar(value="Đang khởi tạo OCR...")
        self.region_var = tk.StringVar(value="Chưa chọn vùng")
        self.speed_var = tk.StringVar(value="-")
        self.count_var = tk.StringVar(value="0 code")

        self.build_ui()
        threading.Thread(target=self.init_ocr, daemon=True).start()

        # Global hotkey: F1 chọn vùng, F2 quét
        keyboard.add_hotkey("f1", lambda: self.root.after(0, self.select_region))
        keyboard.add_hotkey("f2", lambda: self.root.after(0, self.scan_async))

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def build_ui(self):
        top = ttk.Frame(self.root, padding=12)
        top.pack(fill="x")

        ttk.Label(top, text="FAST CODE OCR", font=("Segoe UI", 18, "bold")).pack(side="left")
        ttk.Label(top, textvariable=self.status_var).pack(side="right")

        info = ttk.LabelFrame(self.root, text="Điều khiển", padding=10)
        info.pack(fill="x", padx=12, pady=(0, 10))

        ttk.Button(info, text="F1 - Chọn vùng code", command=self.select_region).grid(row=0, column=0, padx=5, pady=5)
        ttk.Button(info, text="F2 - Quét ngay", command=self.scan_async).grid(row=0, column=1, padx=5, pady=5)
        ttk.Button(info, text="Copy tất cả", command=self.copy_all).grid(row=0, column=2, padx=5, pady=5)
        ttk.Button(info, text="Xóa kết quả", command=self.clear_results).grid(row=0, column=3, padx=5, pady=5)

        ttk.Label(info, text="Vùng:").grid(row=1, column=0, sticky="e", pady=4)
        ttk.Label(info, textvariable=self.region_var).grid(row=1, column=1, columnspan=3, sticky="w")
        ttk.Label(info, text="Thời gian:").grid(row=2, column=0, sticky="e")
        ttk.Label(info, textvariable=self.speed_var, font=("Segoe UI", 10, "bold")).grid(row=2, column=1, sticky="w")
        ttk.Label(info, text="Tổng:").grid(row=2, column=2, sticky="e")
        ttk.Label(info, textvariable=self.count_var, font=("Segoe UI", 10, "bold")).grid(row=2, column=3, sticky="w")

        result_box = ttk.LabelFrame(self.root, text="Code nhận được (mỗi dòng 1 code)", padding=8)
        result_box.pack(fill="both", expand=True, padx=12, pady=(0, 10))

        self.text = tk.Text(result_box, font=("Consolas", 16, "bold"), wrap="none")
        self.text.pack(fill="both", expand=True)

        bottom = ttk.Frame(self.root, padding=(12, 0, 12, 12))
        bottom.pack(fill="x")
        ttk.Label(
            bottom,
            text="Mẹo: chỉ khoanh đúng cột trắng chứa code. Tool ưu tiên chuỗi 6 ký tự A-Z/0-9 và kiểm tra lại O↔0, I↔1.",
        ).pack(anchor="w")

    def init_ocr(self):
        if RapidOCR is None:
            self.root.after(0, lambda: self.status_var.set("Thiếu rapidocr_onnxruntime"))
            self.root.after(0, lambda: messagebox.showerror(
                "Thiếu thư viện",
                f"Không import được RapidOCR:\n{RAPID_IMPORT_ERROR}\n\nHãy chạy install.bat."
            ))
            return
        try:
            # RapidOCR dùng ONNX local, không cần API.
            self.engine = RapidOCR()
            self.root.after(0, lambda: self.status_var.set("OCR sẵn sàng • F1 chọn vùng • F2 quét"))
        except Exception as e:
            self.root.after(0, lambda: self.status_var.set("Lỗi khởi tạo OCR"))
            self.root.after(0, lambda: messagebox.showerror("OCR lỗi", str(e)))

    def select_region(self):
        RegionSelector(self.root, self.set_region)

    def set_region(self, region):
        self.region = region
        l, t, r, b = region
        self.region_var.set(f"x={l}, y={t}, w={r-l}, h={b-t}")
        self.status_var.set("Đã chọn vùng • Nhấn F2 để quét")

    def scan_async(self):
        if self.busy:
            return
        if self.engine is None:
            messagebox.showwarning("OCR chưa sẵn sàng", "Đợi OCR khởi tạo xong hoặc chạy install.bat.")
            return
        if not self.region:
            self.select_region()
            return
        self.busy = True
        self.status_var.set("Đang quét...")
        threading.Thread(target=self.scan, daemon=True).start()

    def preprocess_variants(self, pil_img):
        rgb = np.array(pil_img.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

        # Phóng 2x để giữ chi tiết I/1 và O/0
        gray2 = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

        # Variant 1: ảnh xám
        v1 = gray2

        # Variant 2: threshold Otsu
        _, v2 = cv2.threshold(gray2, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Variant 3: tăng tương phản + threshold adaptive
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        c = clahe.apply(gray2)
        v3 = cv2.adaptiveThreshold(
            c, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 31, 9
        )
        return [v1, v2, v3]

    def run_ocr_variant(self, img):
        try:
            result, elapsed = self.engine(img)
        except Exception:
            return []

        if not result:
            return []

        texts = []
        for item in result:
            # RapidOCR thường: [box, text, score]
            if len(item) >= 2:
                txt = normalize_text(str(item[1]))
                if txt:
                    texts.append(txt)
        return texts

    def extract_candidates(self, texts):
        out = []
        for txt in texts:
            # OCR có thể ghép nhiều code thành một chuỗi dài
            if looks_like_code(txt):
                out.append(txt)
                continue

            # Cắt mọi đoạn đúng 6 ký tự A-Z0-9
            chunks = re.findall(r"[A-Z0-9]{6}", txt)
            out.extend(chunks)
        return out

    def detect_line_boxes(self, pil_img):
        """
        Tìm từng dòng chữ trong vùng code.
        Đây là bước quan trọng để 5-10 code được OCR độc lập nhưng vẫn trong 1 lần bấm F2.
        """
        rgb = np.array(pil_img.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

        # Chữ tối trên nền sáng -> invert
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

        # Gom các ký tự cùng dòng
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
        merged = cv2.dilate(bw, kernel, iterations=1)

        contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        h_img, w_img = gray.shape[:2]
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w < 25 or h < 8:
                continue
            if w > w_img * 0.95 and h > h_img * 0.5:
                continue
            pad_x, pad_y = 8, 6
            boxes.append((
                max(0, x-pad_x),
                max(0, y-pad_y),
                min(w_img, x+w+pad_x),
                min(h_img, y+h+pad_y)
            ))

        # Sắp xếp từ trên xuống; gom gần cùng y
        boxes.sort(key=lambda b: (b[1], b[0]))
        return boxes

    def ocr_one_line(self, pil_line):
        all_candidates = []
        for variant in self.preprocess_variants(pil_line):
            texts = self.run_ocr_variant(variant)
            all_candidates += self.extract_candidates(texts)

        # Nếu OCR đọc dính dấu cách/ký tự lạ, chạy thêm trên ảnh màu nguyên bản
        raw = np.array(pil_line.convert("RGB"))
        texts = self.run_ocr_variant(raw)
        all_candidates += self.extract_candidates(texts)

        return pick_consensus(all_candidates)

    def scan(self):
        t0 = time.perf_counter()
        try:
            img = ImageGrab.grab(bbox=self.region, all_screens=True)
            self.last_image = img

            # 1) Ưu tiên tách theo từng dòng
            boxes = self.detect_line_boxes(img)
            found = []
            for box in boxes:
                crop = img.crop(box)
                code = self.ocr_one_line(crop)
                if code:
                    found.append((box[1], code))

            # 2) Fallback: OCR cả vùng nếu line detector không đủ
            if not found:
                candidates = []
                for variant in self.preprocess_variants(img):
                    texts = self.run_ocr_variant(variant)
                    candidates += self.extract_candidates(texts)
                # Giữ thứ tự xuất hiện tốt nhất có thể
                seen = set()
                for c in candidates:
                    if c not in seen:
                        found.append((len(found), c))
                        seen.add(c)

            found.sort(key=lambda x: x[0])
            codes = []
            seen_local = set()
            for _, c in found:
                if c not in seen_local:
                    codes.append(c)
                    seen_local.add(c)

            ms = (time.perf_counter() - t0) * 1000
            self.root.after(0, lambda: self.finish_scan(codes, ms))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Lỗi quét", str(e)))
            self.root.after(0, lambda: self.status_var.set("Quét lỗi"))
            self.busy = False

    def finish_scan(self, codes, ms):
        new_count = 0
        for code in codes:
            if code not in self.seen_codes:
                self.seen_codes.add(code)
                self.text.insert("end", code + "\n")
                new_count += 1

        self.text.see("end")
        self.count_var.set(f"{len(self.seen_codes)} code")
        self.speed_var.set(f"{ms:.0f} ms")
        if codes:
            self.status_var.set(f"Đọc {len(codes)} code • mới {new_count}")
        else:
            self.status_var.set("Không thấy code • thử khoanh vùng sát hơn")
        self.busy = False

    def copy_all(self):
        content = self.text.get("1.0", "end").strip()
        if not content:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(content)
        self.status_var.set("Đã copy toàn bộ code")

    def clear_results(self):
        self.seen_codes.clear()
        self.text.delete("1.0", "end")
        self.count_var.set("0 code")
        self.speed_var.set("-")

    def on_close(self):
        try:
            keyboard.unhook_all_hotkeys()
        except Exception:
            pass
        self.root.destroy()


def main():
    root = tk.Tk()
    try:
        # theme sẵn có trên Windows
        ttk.Style().theme_use("vista")
    except Exception:
        pass
    OCRApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
