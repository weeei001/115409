# coding: utf-8
"""
LTN 歷史文章掃描器 — 用文章編號掃描 2023~2025/06 的舊財經新聞
"""

import tkinter as tk
from tkinter import ttk
import threading
import requests
import os
import csv
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed


# ─────────────────── 設定 ───────────────────
START_ID = 4300000       # ~2023-06
END_ID   = 5070000       # ~2025-06（API 覆蓋範圍起點）
WORKERS  = 20            # 並行數
NEWS_DB_PATH = "OtherNewWeb/News_Crawler-master/NewsDB"
HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
AD_PHRASES = [
    "點我訂閱自由財經Youtube頻道",
    "不用抽 不用搶 現在用APP看新聞 保證天天中獎",
    "點我下載APP",
]
TARGET_STOCKS = {
    "台積電": "2330", "鴻海": "2317", "聯發科": "2454",
    "富邦金": "2881", "南亞科": "2408", "萬海": "2615",
}


class LtnHistoryGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("LTN 歷史文章掃描器（2023~2025）")
        self.root.geometry("850x750")
        self.root.configure(bg="#1a1a2e")
        self.root.resizable(False, False)

        self.phase = "idle"
        self.scanned = 0
        self.total_ids = END_ID - START_ID
        self.found = 0
        self.skipped = 0
        self.oldest_date = "—"
        self.newest_date = "—"
        self.current_id = START_ID
        self.stock_hits = {name: 0 for name in TARGET_STOCKS}
        self.latest_title = ""
        self.speed = "—"
        self.spinner_idx = 0
        self.pulse_val = 80
        self.pulse_dir = 1
        self._start_time = 0

        self._build_ui()
        self._tick()

    def _build_ui(self):
        bg = "#1a1a2e"
        fg = "#eaf6ff"
        accent = "#e94560"
        card_bg = "#16213e"
        green = "#4ecca3"

        # Title
        title_frame = tk.Frame(self.root, bg="#0f3460", height=52)
        title_frame.pack(fill="x")
        title_frame.pack_propagate(False)
        tk.Label(title_frame, text="  LTN 歷史文章掃描器  2023 ~ 2025",
                 font=("Helvetica", 17, "bold"), bg="#0f3460", fg="white",
                 anchor="w").pack(fill="x", padx=10, pady=11)

        # Phase + spinner
        phase_frame = tk.Frame(self.root, bg=bg)
        phase_frame.pack(fill="x", padx=20, pady=(12, 5))
        self.phase_label = tk.Label(phase_frame, text="待命中",
                                    font=("Helvetica", 14, "bold"), bg=bg, fg="#555")
        self.phase_label.pack(side="left")
        self.spinner_label = tk.Label(phase_frame, text="",
                                      font=("Courier", 14), bg=bg, fg=accent)
        self.spinner_label.pack(side="left", padx=8)
        self.speed_label = tk.Label(phase_frame, text="",
                                     font=("Helvetica", 12), bg=bg, fg="#7f8c8d")
        self.speed_label.pack(side="right")

        # ── Scan progress ──
        scan_card = tk.LabelFrame(self.root, text=" 掃描進度 ",
                                   font=("Helvetica", 12, "bold"),
                                   bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        scan_card.pack(fill="x", padx=20, pady=8)

        row1 = tk.Frame(scan_card, bg=card_bg)
        row1.pack(fill="x", padx=15, pady=5)

        tk.Label(row1, text="編號範圍：", font=("Helvetica", 11), bg=card_bg, fg=fg).pack(side="left")
        tk.Label(row1, text=f"{START_ID:,} ~ {END_ID:,}",
                 font=("Courier", 11, "bold"), bg=card_bg, fg="#f39c12").pack(side="left")
        tk.Label(row1, text=f"  ({self.total_ids:,} 個)",
                 font=("Helvetica", 11), bg=card_bg, fg="#7f8c8d").pack(side="left")

        row1b = tk.Frame(scan_card, bg=card_bg)
        row1b.pack(fill="x", padx=15, pady=2)
        tk.Label(row1b, text="當前編號：", font=("Helvetica", 11), bg=card_bg, fg=fg).pack(side="left")
        self.current_id_val = tk.Label(row1b, text="—",
                                        font=("Courier", 12, "bold"), bg=card_bg, fg=green)
        self.current_id_val.pack(side="left")

        row2 = tk.Frame(scan_card, bg=card_bg)
        row2.pack(fill="x", padx=15, pady=5)
        tk.Label(row2, text="已掃描：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.scanned_val = tk.Label(row2, text="0",
                                     font=("Helvetica", 12, "bold"), bg=card_bg, fg=green)
        self.scanned_val.pack(side="left")
        tk.Label(row2, text="  找到財經文章：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.found_val = tk.Label(row2, text="0",
                                   font=("Helvetica", 12, "bold"), bg=card_bg, fg="#f39c12")
        self.found_val.pack(side="left")
        tk.Label(row2, text="  命中率：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.hit_rate_val = tk.Label(row2, text="—",
                                      font=("Helvetica", 12, "bold"), bg=card_bg, fg=accent)
        self.hit_rate_val.pack(side="left")

        self.scan_bar = ttk.Progressbar(scan_card, length=770, mode="determinate",
                                         maximum=self.total_ids)
        self.scan_bar.pack(padx=15, pady=(0, 5))

        self.pct_label = tk.Label(scan_card, text="0%", font=("Helvetica", 11, "bold"),
                                   bg=card_bg, fg="#7f8c8d")
        self.pct_label.pack(pady=(0, 8))

        # ── Latest article ──
        article_card = tk.LabelFrame(self.root, text=" 最新抓到的文章 ",
                                      font=("Helvetica", 12, "bold"),
                                      bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        article_card.pack(fill="x", padx=20, pady=8)
        self.title_label = tk.Label(article_card, text="等待中...",
                                     font=("Helvetica", 12), bg=card_bg, fg="#7f8c8d",
                                     anchor="w", wraplength=740)
        self.title_label.pack(fill="x", padx=15, pady=8)

        # ── Date range ──
        date_card = tk.LabelFrame(self.root, text=" 日期範圍 ",
                                   font=("Helvetica", 12, "bold"),
                                   bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        date_card.pack(fill="x", padx=20, pady=8)

        date_row = tk.Frame(date_card, bg=card_bg)
        date_row.pack(fill="x", padx=15, pady=8)
        tk.Label(date_row, text="最舊：", font=("Helvetica", 13), bg=card_bg, fg=fg).pack(side="left")
        self.oldest_val = tk.Label(date_row, text="—",
                                    font=("Helvetica", 13, "bold"), bg=card_bg, fg="#f39c12")
        self.oldest_val.pack(side="left")
        tk.Label(date_row, text="      最新：", font=("Helvetica", 13), bg=card_bg, fg=fg).pack(side="left")
        self.newest_val = tk.Label(date_row, text="—",
                                    font=("Helvetica", 13, "bold"), bg=card_bg, fg=green)
        self.newest_val.pack(side="left")

        # ── Stock hits ──
        stock_card = tk.LabelFrame(self.root, text=" 目標股票命中 ",
                                    font=("Helvetica", 12, "bold"),
                                    bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        stock_card.pack(fill="x", padx=20, pady=8)

        self.stock_labels = {}
        stock_grid = tk.Frame(stock_card, bg=card_bg)
        stock_grid.pack(padx=15, pady=8)
        colors = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"]
        for i, (name, code) in enumerate(TARGET_STOCKS.items()):
            col = i % 3
            row = i // 3
            cell = tk.Frame(stock_grid, bg=card_bg)
            cell.grid(row=row, column=col, padx=15, pady=4, sticky="w")
            tk.Label(cell, text=f"{code}", font=("Courier", 11, "bold"),
                     bg=colors[i], fg="white", width=5, anchor="center").pack(side="left")
            tk.Label(cell, text=f" {name}：", font=("Helvetica", 11),
                     bg=card_bg, fg=fg).pack(side="left")
            lbl = tk.Label(cell, text="0", font=("Helvetica", 12, "bold"),
                           bg=card_bg, fg=colors[i])
            lbl.pack(side="left")
            self.stock_labels[name] = lbl

        # ── Start button ──
        self.start_btn = tk.Button(self.root, text="  開始掃描  ",
                                    font=("Helvetica", 14, "bold"),
                                    bg="#e94560", fg="white", activebackground="#c0392b",
                                    bd=0, padx=20, pady=8, command=self._start)
        self.start_btn.pack(pady=12)

    def _tick(self):
        spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        if self.phase == "scanning":
            self.spinner_idx = (self.spinner_idx + 1) % len(spinners)
            self.spinner_label.config(text=spinners[self.spinner_idx])
            self.pulse_val += self.pulse_dir * 12
            if self.pulse_val > 255: self.pulse_val, self.pulse_dir = 255, -1
            elif self.pulse_val < 80: self.pulse_val, self.pulse_dir = 80, 1
            v = self.pulse_val
            self.phase_label.config(text="掃描中...", fg=f"#{v:02x}{0x80:02x}{0x40:02x}")
        elif self.phase == "done":
            self.spinner_label.config(text="✅")
            self.phase_label.config(text="掃描完成！", fg="#2ecc71")

        self._refresh()
        self.root.after(120, self._tick)

    def _refresh(self):
        self.scanned_val.config(text=f"{self.scanned:,}")
        self.found_val.config(text=f"{self.found:,}")
        self.current_id_val.config(text=f"{self.current_id:,}")
        self.scan_bar["value"] = self.scanned

        if self.scanned > 0:
            rate = self.found / self.scanned * 100
            self.hit_rate_val.config(text=f"{rate:.1f}%")
            pct = self.scanned / self.total_ids * 100
            self.pct_label.config(text=f"{pct:.1f}%")

        self.oldest_val.config(text=self.oldest_date)
        self.newest_val.config(text=self.newest_date)
        self.speed_label.config(text=self.speed)

        if self.latest_title:
            self.title_label.config(text=self.latest_title[:70], fg="#ecf0f1")

        for name, lbl in self.stock_labels.items():
            lbl.config(text=str(self.stock_hits[name]))

        if self.phase == "scanning" and self._start_time:
            elapsed = time.time() - self._start_time
            if elapsed > 0 and self.scanned > 0:
                rate = self.scanned / elapsed
                remaining = (self.total_ids - self.scanned) / rate
                mins = int(remaining // 60)
                secs = int(remaining % 60)
                self.speed = f"{rate:.0f} ID/秒 ｜ 剩餘 {mins}:{secs:02d}"

    def _start(self):
        self.start_btn.config(state="disabled", text="掃描中...", bg="#7f8c8d")
        self.phase = "scanning"
        self._start_time = time.time()
        threading.Thread(target=self._scan_worker, daemon=True).start()

    def _scan_worker(self):
        ltn_dir = os.path.join(NEWS_DB_PATH, "ltn")
        os.makedirs(ltn_dir, exist_ok=True)
        csv_path = os.path.join(ltn_dir, "ltn_news.csv")

        # Load existing URLs
        existing_urls = set()
        if os.path.exists(csv_path):
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    existing_urls.add(row.get("連結", ""))

        csv_file = open(csv_path, "a", encoding="utf-8-sig", newline="")
        fieldnames = ["標題", "發布時間", "內文", "連結", "來源"]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        if not existing_urls:
            writer.writeheader()

        import threading as _th
        write_lock = _th.Lock()

        def fetch_one(article_id):
            url = f"https://ec.ltn.com.tw/article/breakingnews/{article_id}"
            if url in existing_urls:
                return None
            try:
                r = requests.get(url, headers=HEADERS, timeout=10)
                if r.status_code != 200:
                    return None
                soup = BeautifulSoup(r.text, "html.parser")
                meta = soup.find("meta", attrs={"name": "pubdate"})
                h1 = soup.select_one("h1")
                content_div = soup.select_one(".content")
                if not (meta and h1 and content_div):
                    return None

                title = h1.text.strip()
                if not title:
                    return None
                pub_time = meta.get("content", "")
                paragraphs = content_div.select("p")
                content = "\n".join(p.text.strip() for p in paragraphs)
                for ad in AD_PHRASES:
                    content = content.replace(ad, "")
                content = "\n".join(line for line in content.split("\n") if line.strip())
                if not content or len(content) < 30:
                    return None
                return {"標題": title, "發布時間": pub_time, "內文": content,
                        "連結": url, "來源": "ltn"}
            except Exception:
                return None

        # Batch processing
        batch_size = 100
        ids = list(range(START_ID, END_ID))

        for batch_start in range(0, len(ids), batch_size):
            batch = ids[batch_start:batch_start + batch_size]
            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futures = {pool.submit(fetch_one, aid): aid for aid in batch}
                for future in as_completed(futures):
                    self.scanned += 1
                    self.current_id = futures[future]
                    data = future.result()
                    if data:
                        with write_lock:
                            writer.writerow(data)
                            csv_file.flush()
                        self.found += 1
                        self.latest_title = f"[{data['發布時間'][:10]}] {data['標題']}"

                        d = data["發布時間"][:10]
                        if d and d > "2000":
                            if self.oldest_date == "—" or d < self.oldest_date:
                                self.oldest_date = d
                            if self.newest_date == "—" or d > self.newest_date:
                                self.newest_date = d

                        text = data["標題"] + data["內文"][:300]
                        for name, code in TARGET_STOCKS.items():
                            if name in text or code in text:
                                self.stock_hits[name] += 1

        csv_file.close()
        self.phase = "done"
        self.root.after(0, lambda: self.start_btn.config(
            state="normal", text="完成！", bg="#2ecc71"
        ))


if __name__ == "__main__":
    root = tk.Tk()
    app = LtnHistoryGUI(root)
    root.mainloop()
