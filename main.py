
import tkinter as tk
from tkinter import ttk, messagebox
import threading, time, re, json
from pathlib import Path
import cv2
import numpy as np
from PIL import ImageGrab
import keyboard

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception as e:
    RapidOCR = None
    RAPID_IMPORT_ERROR = e

APP_TITLE = "Fast Code OCR v2"
CODE_LEN = 6
ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

class RegionSelector(tk.Toplevel):
    def __init__(self, master, callback):
        super().__init__(master)
        self.callback = callback
        self.attributes("-fullscreen", True)
        self.attributes("-alpha", 0.25)
        self.attributes("-topmost", True)
        self.configure(bg="black")
        self.canvas = tk.Canvas(self, cursor="cross", bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.sx = self.sy = 0
        self.rect = None
        self.canvas.bind("<ButtonPress-1>", self.down)
        self.canvas.bind("<B1-Motion>", self.move)
        self.canvas.bind("<ButtonRelease-1>", self.up)
        self.bind("<Escape>", lambda e: self.destroy())
        tk.Label(self, text="Kéo chuột khoanh CỘT CODE • ESC để hủy",
                 font=("Segoe UI", 18, "bold"), bg="black", fg="white").place(relx=.5, y=25, anchor="n")

    def down(self, e):
        self.sx, self.sy = e.x_root, e.y_root
        if self.rect: self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="red", width=3)

    def move(self, e):
        self.canvas.coords(self.rect, self.sx-self.winfo_rootx(), self.sy-self.winfo_rooty(), e.x, e.y)

    def up(self, e):
        l, r = sorted([self.sx, e.x_root]); t, b = sorted([self.sy, e.y_root])
        if r-l < 30 or b-t < 20:
            messagebox.showwarning("Vùng quá nhỏ", "Khoanh vùng lớn hơn một chút.")
            return
        self.destroy()
        self.callback((l,t,r,b))

def normalize(s):
    s = re.sub(r"[^A-Za-z0-9]", "", s).upper()
    return s

def valid_code(s):
    return len(s) == CODE_LEN and all(ch in ALLOWED for ch in s)

class App:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("780x620")
        self.engine = None
        self.region = None
        self.busy = False
        self.last_codes = []
        self.seen = set()

        self.status = tk.StringVar(value="Đang khởi tạo OCR...")
        self.region_text = tk.StringVar(value="Chưa chọn vùng")
        self.speed = tk.StringVar(value="-")
        self.count = tk.StringVar(value="0 code")
        self.autocopy = tk.BooleanVar(value=True)

        self.ui()
        threading.Thread(target=self.init_engine, daemon=True).start()
        keyboard.add_hotkey("f1", lambda: self.root.after(0, self.select_region))
        keyboard.add_hotkey("f2", lambda: self.root.after(0, self.scan_async))
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def ui(self):
        top = ttk.Frame(self.root, padding=12); top.pack(fill="x")
        ttk.Label(top, text="FAST CODE OCR v2", font=("Segoe UI",18,"bold")).pack(side="left")
        ttk.Label(top, textvariable=self.status).pack(side="right")

        g = ttk.LabelFrame(self.root, text="Điều khiển", padding=10); g.pack(fill="x", padx=12, pady=(0,10))
        ttk.Button(g, text="F1 - Chọn vùng", command=self.select_region).grid(row=0,column=0,padx=5,pady=5)
        ttk.Button(g, text="F2 - Quét nhanh", command=self.scan_async).grid(row=0,column=1,padx=5,pady=5)
        ttk.Button(g, text="Copy", command=self.copy_now).grid(row=0,column=2,padx=5,pady=5)
        ttk.Button(g, text="Xóa", command=self.clear).grid(row=0,column=3,padx=5,pady=5)
        ttk.Checkbutton(g, text="Tự copy sau OCR", variable=self.autocopy).grid(row=0,column=4,padx=8)
        ttk.Label(g, text="Vùng:").grid(row=1,column=0,sticky="e")
        ttk.Label(g, textvariable=self.region_text).grid(row=1,column=1,columnspan=4,sticky="w")
        ttk.Label(g, text="Thời gian:").grid(row=2,column=0,sticky="e")
        ttk.Label(g, textvariable=self.speed, font=("Segoe UI",10,"bold")).grid(row=2,column=1,sticky="w")
        ttk.Label(g, text="Tổng:").grid(row=2,column=2,sticky="e")
        ttk.Label(g, textvariable=self.count, font=("Segoe UI",10,"bold")).grid(row=2,column=3,sticky="w")

        f = ttk.LabelFrame(self.root, text="Code nhận được", padding=8); f.pack(fill="both", expand=True, padx=12, pady=(0,10))
        self.txt = tk.Text(f, font=("Consolas",16,"bold"), wrap="none"); self.txt.pack(fill="both", expand=True)

        ttk.Label(self.root, text="v2: chỉ chạy OCR cả vùng 1 lần để giảm mạnh thời gian xử lý.").pack(anchor="w", padx=14, pady=(0,12))

    def init_engine(self):
        if RapidOCR is None:
            self.root.after(0, lambda: self.status.set("Thiếu thư viện OCR"))
            self.root.after(0, lambda: messagebox.showerror("Thiếu thư viện", str(RAPID_IMPORT_ERROR)))
            return
        try:
            self.engine = RapidOCR()
            self.root.after(0, lambda: self.status.set("Sẵn sàng • F1 chọn vùng • F2 quét"))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("OCR lỗi", str(e)))

    def select_region(self):
        RegionSelector(self.root, self.set_region)

    def set_region(self, r):
        self.region = r
        l,t,rr,b = r
        self.region_text.set(f"x={l}, y={t}, w={rr-l}, h={b-t}")

    def scan_async(self):
        if self.busy: return
        if self.engine is None:
            messagebox.showwarning("Chưa sẵn sàng", "Đợi OCR khởi tạo xong.")
            return
        if not self.region:
            self.select_region(); return
        self.busy = True
        self.status.set("Đang quét...")
        threading.Thread(target=self.scan, daemon=True).start()

    def scan(self):
        t0 = time.perf_counter()
        try:
            img = ImageGrab.grab(bbox=self.region, all_screens=True)
            arr = np.array(img.convert("RGB"))

            # Chỉ 1 lần OCR cho toàn vùng.
            result, _ = self.engine(arr)

            items = []
            if result:
                for item in result:
                    if len(item) >= 2:
                        box, text = item[0], str(item[1])
                        # top y để giữ thứ tự từ trên xuống
                        try:
                            top_y = min(float(p[1]) for p in box)
                        except Exception:
                            top_y = len(items)
                        items.append((top_y, text))

            items.sort(key=lambda x: x[0])

            codes = []
            for _, raw in items:
                n = normalize(raw)
                if valid_code(n):
                    codes.append(n)
                else:
                    # trường hợp OCR dính nhiều đoạn
                    chunks = re.findall(r"[A-Z0-9]{6}", n)
                    codes.extend(chunks)

            # loại trùng cục bộ, giữ thứ tự
            unique = []
            local = set()
            for c in codes:
                if c not in local:
                    unique.append(c); local.add(c)

            ms = (time.perf_counter()-t0)*1000
            self.root.after(0, lambda: self.finish(unique, ms))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Lỗi quét", str(e)))
            self.root.after(0, lambda: self.status.set("Quét lỗi"))
            self.busy = False

    def finish(self, codes, ms):
        self.last_codes = codes
        new = 0
        for c in codes:
            if c not in self.seen:
                self.seen.add(c)
                self.txt.insert("end", c+"\n")
                new += 1
        self.txt.see("end")
        self.speed.set(f"{ms:.0f} ms")
        self.count.set(f"{len(self.seen)} code")
        self.status.set(f"Đọc {len(codes)} code • mới {new}" if codes else "Không thấy code")
        if self.autocopy.get() and codes:
            self.root.clipboard_clear()
            self.root.clipboard_append("\n".join(codes))
        self.busy = False

    def copy_now(self):
        s = self.txt.get("1.0","end").strip()
        if s:
            self.root.clipboard_clear(); self.root.clipboard_append(s)
            self.status.set("Đã copy")

    def clear(self):
        self.seen.clear(); self.last_codes=[]
        self.txt.delete("1.0","end")
        self.count.set("0 code"); self.speed.set("-")

    def close(self):
        try: keyboard.unhook_all_hotkeys()
        except Exception: pass
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    try: ttk.Style().theme_use("vista")
    except Exception: pass
    App(root)
    root.mainloop()
