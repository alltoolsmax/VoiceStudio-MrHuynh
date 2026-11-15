"""App cấp key Voice Studio - Mr.Huỳnh (chỉ dùng trên máy của Mr.Huỳnh).

Nhập mã máy khách gửi → tạo key kích hoạt vĩnh viễn. Khóa bí mật được nạp một
lần từ tệp vsmh-private-key.txt và lưu trong %APPDATA%\\VSMH-KeyGen; nó không
nằm trong mã nguồn hay trong file .exe.
"""
from __future__ import annotations

import csv
import os
import sys
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import vsmh_license as lic

APP_TITLE = "Cấp key Voice Studio - Mr.Huỳnh"
# Khóa công khai có trong Voice Studio (electron/src/main/license/index.ts).
EXPECTED_PUBLIC_KEY = "c6b424e5d1f327c5c8b3befd5dd0522e660e7bda559607cd18eb715354439cad"
HISTORY_FIELDS = ["thoi_gian", "ma_may", "khach_hang", "ghi_chu", "key"]


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    path = Path(base) / "VSMH-KeyGen"
    path.mkdir(parents=True, exist_ok=True)
    return path


def resource(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return base / name


class KeyGenApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.private_key = None
        self.key_file = data_dir() / "private.key"
        self.history_file = data_dir() / "history.csv"
        root.title(APP_TITLE)
        root.geometry("900x640")
        root.minsize(760, 520)
        try:
            root.iconbitmap(default=str(resource("icon.ico")))
        except tk.TclError:
            pass
        self._build()
        self._load_private_key()
        self._load_history()

    # ── giao diện ─────────────────────────────────────────────────────────
    def _build(self):
        style = ttk.Style()
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Big.TButton", font=("Segoe UI", 11, "bold"), padding=8)

        top = ttk.Frame(self.root, padding=14)
        top.pack(fill="x")
        try:
            self.logo = tk.PhotoImage(file=str(resource("logo-64.png")))
            ttk.Label(top, image=self.logo).pack(side="left", padx=(0, 12))
        except tk.TclError:
            pass
        head = ttk.Frame(top)
        head.pack(side="left", fill="x", expand=True)
        ttk.Label(head, text=APP_TITLE, style="Title.TLabel").pack(anchor="w")
        self.key_status = ttk.Label(head, text="", foreground="#b45309")
        self.key_status.pack(anchor="w")
        ttk.Button(top, text="Nạp khóa bí mật…", command=self._choose_private_key).pack(side="right")

        form = ttk.LabelFrame(self.root, text="Tạo key vĩnh viễn", padding=14)
        form.pack(fill="x", padx=14)
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="Mã máy khách gửi:").grid(row=0, column=0, sticky="w", pady=4)
        self.machine = tk.StringVar()
        self.machine.trace_add("write", lambda *_: self._validate_machine())
        entry = ttk.Entry(form, textvariable=self.machine, font=("Consolas", 13))
        entry.grid(row=0, column=1, sticky="ew", padx=8)
        entry.focus_set()
        ttk.Button(form, text="Dán", command=self._paste_machine).grid(row=0, column=2)
        self.machine_hint = ttk.Label(form, text="Ví dụ: VSMH-K4V4-99VS-J484-XGTN", foreground="#6b7280")
        self.machine_hint.grid(row=1, column=1, sticky="w", padx=8)

        ttk.Label(form, text="Tên khách hàng:").grid(row=2, column=0, sticky="w", pady=4)
        self.customer = tk.StringVar()
        ttk.Entry(form, textvariable=self.customer).grid(row=2, column=1, columnspan=2, sticky="ew", padx=8)
        ttk.Label(form, text="Ghi chú:").grid(row=3, column=0, sticky="w", pady=4)
        self.note = tk.StringVar()
        ttk.Entry(form, textvariable=self.note).grid(row=3, column=1, columnspan=2, sticky="ew", padx=8)

        self.generate_btn = ttk.Button(form, text="Tạo key", style="Big.TButton", command=self._generate)
        self.generate_btn.grid(row=4, column=1, sticky="w", padx=8, pady=(10, 4))

        out = ttk.LabelFrame(self.root, text="Key kích hoạt (gửi cho khách)", padding=14)
        out.pack(fill="x", padx=14, pady=10)
        self.output = tk.Text(out, height=3, wrap="char", font=("Consolas", 11))
        self.output.pack(side="left", fill="x", expand=True)
        self.output.configure(state="disabled")
        ttk.Button(out, text="Sao chép key", command=self._copy_output).pack(side="left", padx=8)

        hist = ttk.LabelFrame(self.root, text="Lịch sử cấp key", padding=10)
        hist.pack(fill="both", expand=True, padx=14, pady=(0, 14))
        bar = ttk.Frame(hist)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text="Tìm:").pack(side="left")
        self.search = tk.StringVar()
        self.search.trace_add("write", lambda *_: self._refresh_history())
        ttk.Entry(bar, textvariable=self.search, width=30).pack(side="left", padx=6)
        ttk.Button(bar, text="Xuất Excel…", command=self._export).pack(side="right")
        ttk.Button(bar, text="Sao chép key đã chọn", command=self._copy_selected).pack(side="right", padx=6)

        columns = ("thoi_gian", "ma_may", "khach_hang", "ghi_chu")
        self.tree = ttk.Treeview(hist, columns=columns, show="headings", height=8)
        for col, label, width in (
            ("thoi_gian", "Thời gian", 140),
            ("ma_may", "Mã máy", 220),
            ("khach_hang", "Khách hàng", 180),
            ("ghi_chu", "Ghi chú", 240),
        ):
            self.tree.heading(col, text=label)
            self.tree.column(col, width=width, anchor="w")
        scroll = ttk.Scrollbar(hist, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", lambda _e: self._copy_selected())

    # ── khóa bí mật ───────────────────────────────────────────────────────
    def _set_private_key(self, text: str, save: bool) -> bool:
        try:
            key = lic.load_private_key(text)
        except Exception:  # noqa: BLE001
            messagebox.showerror(APP_TITLE, "Tệp khóa bí mật không hợp lệ.")
            return False
        if lic.public_key_hex(key) != EXPECTED_PUBLIC_KEY:
            messagebox.showerror(
                APP_TITLE,
                "Khóa bí mật này không khớp với Voice Studio.\n"
                "Key tạo ra sẽ không kích hoạt được. Hãy chọn đúng tệp vsmh-private-key.txt.",
            )
            return False
        self.private_key = key
        if save:
            self.key_file.write_text(text.strip() + "\n", encoding="utf-8")
        self.key_status.configure(text="Đã nạp khóa bí mật. Sẵn sàng cấp key.", foreground="#15803d")
        return True

    def _load_private_key(self):
        if self.key_file.exists():
            self._set_private_key(self.key_file.read_text(encoding="utf-8"), save=False)
        if self.private_key is None:
            self.key_status.configure(
                text="Chưa nạp khóa bí mật: bấm \"Nạp khóa bí mật…\" và chọn tệp vsmh-private-key.txt.",
                foreground="#b45309",
            )

    def _choose_private_key(self):
        path = filedialog.askopenfilename(
            title="Chọn tệp vsmh-private-key.txt",
            filetypes=[("Tệp khóa", "*.txt *.key"), ("Tất cả", "*.*")],
        )
        if path:
            self._set_private_key(Path(path).read_text(encoding="utf-8"), save=True)

    # ── cấp key ───────────────────────────────────────────────────────────
    def _validate_machine(self) -> str | None:
        text = self.machine.get().strip()
        body = lic.parse_machine_code(text) if text else None
        if not text:
            self.machine_hint.configure(text="Ví dụ: VSMH-K4V4-99VS-J484-XGTN", foreground="#6b7280")
        elif body:
            self.machine_hint.configure(text="✓ Mã máy hợp lệ", foreground="#15803d")
        else:
            self.machine_hint.configure(text="✗ Mã máy sai hoặc gõ nhầm ký tự", foreground="#b91c1c")
        return body

    def _paste_machine(self):
        try:
            self.machine.set(self.root.clipboard_get().strip())
        except tk.TclError:
            pass

    def _generate(self):
        if self.private_key is None:
            messagebox.showwarning(APP_TITLE, "Hãy nạp khóa bí mật trước.")
            return
        body = self._validate_machine()
        if not body:
            messagebox.showwarning(APP_TITLE, "Mã máy không hợp lệ. Hãy kiểm tra lại mã khách gửi.")
            return
        machine = lic.format_machine_code(body)
        key = lic.issue_key(self.private_key, machine)
        self._show_output(key)
        self._copy(key)
        row = {
            "thoi_gian": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "ma_may": machine,
            "khach_hang": self.customer.get().strip(),
            "ghi_chu": self.note.get().strip(),
            "key": key,
        }
        self.history.append(row)
        self._save_history()
        self._refresh_history()
        self.customer.set("")
        self.note.set("")

    def _show_output(self, key: str):
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.insert("1.0", key)
        self.output.configure(state="disabled")

    def _copy(self, text: str):
        self.root.clipboard_clear()
        self.root.clipboard_append(text)

    def _copy_output(self):
        text = self.output.get("1.0", "end").strip()
        if text:
            self._copy(text)
            messagebox.showinfo(APP_TITLE, "Đã sao chép key.")

    # ── lịch sử ───────────────────────────────────────────────────────────
    def _load_history(self):
        self.history: list[dict] = []
        if self.history_file.exists():
            with self.history_file.open(encoding="utf-8-sig", newline="") as f:
                self.history = [dict(row) for row in csv.DictReader(f)]
        self._refresh_history()

    def _save_history(self):
        with self.history_file.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
            writer.writeheader()
            writer.writerows(self.history)

    def _refresh_history(self):
        query = self.search.get().strip().lower()
        self.tree.delete(*self.tree.get_children())
        for index, row in reversed(list(enumerate(self.history))):
            text = " ".join(str(row.get(k, "")) for k in HISTORY_FIELDS).lower()
            if query and query not in text:
                continue
            self.tree.insert(
                "", "end", iid=str(index),
                values=(row["thoi_gian"], row["ma_may"], row["khach_hang"], row["ghi_chu"]),
            )

    def _copy_selected(self):
        selected = self.tree.selection()
        if not selected:
            return
        key = self.history[int(selected[0])]["key"]
        self._show_output(key)
        self._copy(key)
        messagebox.showinfo(APP_TITLE, "Đã sao chép key của dòng đã chọn.")

    def _export(self):
        path = filedialog.asksaveasfilename(
            title="Xuất lịch sử ra Excel",
            defaultextension=".xlsx",
            initialfile=f"lich-su-cap-key-{datetime.now():%Y%m%d}.xlsx",
            filetypes=[("Excel", "*.xlsx")],
        )
        if not path:
            return
        from openpyxl import Workbook
        from openpyxl.styles import Font

        wb = Workbook()
        ws = wb.active
        ws.title = "Lịch sử cấp key"
        ws.append(["Thời gian", "Mã máy", "Khách hàng", "Ghi chú", "Key"])
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in self.history:
            ws.append([row.get(k, "") for k in HISTORY_FIELDS])
        for col, width in zip("ABCDE", (18, 28, 24, 30, 90)):
            ws.column_dimensions[col].width = width
        ws.freeze_panes = "A2"
        wb.save(path)
        messagebox.showinfo(APP_TITLE, f"Đã xuất {len(self.history)} dòng ra:\n{path}")


def main():
    root = tk.Tk()
    KeyGenApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
