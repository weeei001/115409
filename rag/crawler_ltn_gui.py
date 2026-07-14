# coding: utf-8
"""
自由財經（LTN）新聞爬蟲 — GUI 版 + headless 排程版
Phase 1: list_ajax API 取得近期文章（2025-06 起）— 並行 + 智慧早停
Phase 2: 抓取 Phase 1 的文章內文
Phase 3: 編號掃描歷史文章（2023-08 ~ 2025-05，不排入日常排程，手動執行）
Phase 2 & 3 可並行執行

headless 用法（供 scheduler_utils.py 呼叫，或手動回補缺口）：
    python crawler_ltn_gui.py --scheduled-once   # 跑一次 Phase 1+2 增量抓取
"""

import argparse
import logging
import tkinter as tk
from tkinter import ttk
import threading
import requests
import os
import csv
import json
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


# ─────────────────── 設定 ───────────────────
MAX_PAGES = 700            # API 頁數上限
WORKERS = 6                # 並行抓取文章的 thread 數
SCAN_WORKERS = 50          # 歷史掃描並行數
API_WORKERS = 5            # Phase 1 並行 API 請求數
API_BATCH_SIZE = 10        # Phase 1 每批抓幾頁
EARLY_EXIT_THRESHOLD = 5   # 連續幾頁全已知就停止 Phase 1
NEWS_DB_PATH = "OtherNewWeb/News_Crawler-master/NewsDB"
SCAN_CHECKPOINT = "OtherNewWeb/News_Crawler-master/NewsDB/ltn/scan_checkpoint.txt"
# 歷史文章編號範圍（2023-08 ~ 2025-05）
SCAN_ID_START = 4400004    # ~2023-08（跳過已完成的 4355000-4400000）
SCAN_ID_END = 5070313      # ~2025-06-10（API 列表起點）
HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
AJAX_HEADERS = {
    **HEADERS,
    "x-requested-with": "XMLHttpRequest",
    "referer": "https://ec.ltn.com.tw/list/securities",
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


# ─────────────────── 共用函式 ───────────────────
def _fetch_article(url):
    """抓取單篇文章內文，回傳 dict 或 None"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        h1 = soup.select_one("h1")
        title = h1.text.strip() if h1 else ""
        if not title:
            return None
        time_meta = soup.find("meta", attrs={"name": "pubdate"})
        pub_time = time_meta.get("content", "") if time_meta else ""
        content_div = soup.select_one(".content")
        paragraphs = content_div.select("p") if content_div else []
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


def _scan_article(article_id, existing_urls):
    """掃描單一歷史文章 ID，回傳 dict 或 None"""
    url = f"https://ec.ltn.com.tw/article/breakingnews/{article_id}"
    if url in existing_urls:
        return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=5)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, "html.parser")
        h1 = soup.select_one("h1")
        time_meta = soup.find("meta", attrs={"name": "pubdate"})
        content_div = soup.select_one(".content")
        if not (h1 and time_meta and content_div):
            return None
        title = h1.text.strip()
        pub_time = time_meta.get("content", "")
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


def _fetch_api_page(page_num):
    """抓取單頁 API 列表，回傳 (page_num, data_list 或 None)"""
    try:
        r = requests.get(
            f"https://ec.ltn.com.tw/list_ajax/securities/{page_num}",
            headers=AJAX_HEADERS, timeout=10
        )
        data = json.loads(r.text)
        return (page_num, data if data else None)
    except Exception:
        return (page_num, None)


def _load_existing_urls(csv_path):
    """從 CSV 載入已有的 URL 集合"""
    existing = set()
    if os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                existing.add(row.get("連結", ""))
    return existing


# ─────────────────── GUI ───────────────────
class LtnCrawlerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("LTN 自由財經爬蟲（API 加速版）")
        self.root.geometry("1100x920")
        self.root.configure(bg="#1a1a2e")
        self.root.resizable(True, True)
        self.root.minsize(900, 800)

        # State
        self.phase = "idle"
        self.page_count = 0
        self.page_max = MAX_PAGES
        self.url_count = 0
        self.fetch_done = 0
        self.fetch_fail = 0
        self.fetch_total = 0
        self.oldest_date = "—"
        self.newest_date = "—"
        self.stock_hits = {name: 0 for name in TARGET_STOCKS}
        self.latest_title = ""
        self.speed = "—"
        self.spinner_idx = 0
        self.pulse_val = 0
        self.pulse_dir = 1
        self._start_time = 0
        # Phase 3 state
        self.scan_current = SCAN_ID_START
        self.scan_total = SCAN_ID_END - SCAN_ID_START
        self.scan_found = 0
        self.scan_speed = "—"
        self._scan_start_time = 0
        # Parallel tracking
        self._phase2_running = False
        self._phase3_running = False

        self._build_ui()
        self._tick()

    def _build_ui(self):
        bg = "#1a1a2e"
        fg = "#eaf6ff"
        accent = "#e94560"
        card_bg = "#16213e"

        # Title bar
        title_frame = tk.Frame(self.root, bg=accent, height=52)
        title_frame.pack(fill="x")
        title_frame.pack_propagate(False)
        tk.Label(title_frame, text="  LTN 自由財經爬蟲（API 加速版）",
                 font=("Helvetica", 18, "bold"), bg=accent, fg="white",
                 anchor="w").pack(fill="x", padx=10, pady=11)

        # Phase + spinner
        phase_frame = tk.Frame(self.root, bg=bg)
        phase_frame.pack(fill="x", padx=20, pady=(15, 5))
        self.phase_label = tk.Label(phase_frame, text="待命中",
                                    font=("Helvetica", 14, "bold"), bg=bg, fg="#0f3460")
        self.phase_label.pack(side="left")
        self.spinner_label = tk.Label(phase_frame, text="",
                                      font=("Courier", 14), bg=bg, fg=accent)
        self.spinner_label.pack(side="left", padx=8)
        self.speed_label = tk.Label(phase_frame, text="",
                                     font=("Helvetica", 12), bg=bg, fg="#7f8c8d")
        self.speed_label.pack(side="right")

        # ── Phase 1: API listing ──
        list_card = tk.LabelFrame(self.root, text=" Phase 1：API 列表取得 ",
                                   font=("Helvetica", 12, "bold"),
                                   bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        list_card.pack(fill="x", padx=20, pady=8)

        row1 = tk.Frame(list_card, bg=card_bg)
        row1.pack(fill="x", padx=15, pady=5)
        tk.Label(row1, text="頁數：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.page_val = tk.Label(row1, text="0 / 700",
                                  font=("Helvetica", 12, "bold"), bg=card_bg, fg="#4ecca3")
        self.page_val.pack(side="left")
        tk.Label(row1, text="     文章連結：", font=("Helvetica", 12),
                 bg=card_bg, fg=fg).pack(side="left")
        self.url_val = tk.Label(row1, text="0",
                                 font=("Helvetica", 12, "bold"), bg=card_bg, fg="#4ecca3")
        self.url_val.pack(side="left")

        self.list_bar = ttk.Progressbar(list_card, length=770, mode="determinate",
                                         maximum=MAX_PAGES)
        self.list_bar.pack(padx=15, pady=(0, 10))

        # ── Phase 2: Fetch ──
        fetch_card = tk.LabelFrame(self.root, text=" Phase 2：文章內文抓取 ",
                                    font=("Helvetica", 12, "bold"),
                                    bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        fetch_card.pack(fill="x", padx=20, pady=8)

        row2 = tk.Frame(fetch_card, bg=card_bg)
        row2.pack(fill="x", padx=15, pady=5)
        tk.Label(row2, text="成功：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.fetch_ok_val = tk.Label(row2, text="0",
                                      font=("Helvetica", 12, "bold"), bg=card_bg, fg="#4ecca3")
        self.fetch_ok_val.pack(side="left")
        tk.Label(row2, text="  失敗：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.fetch_fail_val = tk.Label(row2, text="0",
                                        font=("Helvetica", 12, "bold"), bg=card_bg, fg=accent)
        self.fetch_fail_val.pack(side="left")
        tk.Label(row2, text="  總計：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.fetch_total_val = tk.Label(row2, text="0",
                                         font=("Helvetica", 12, "bold"), bg=card_bg, fg=fg)
        self.fetch_total_val.pack(side="left")

        self.fetch_bar = ttk.Progressbar(fetch_card, length=770, mode="determinate")
        self.fetch_bar.pack(padx=15, pady=(0, 5))

        self.title_label = tk.Label(fetch_card, text="等待中...",
                                     font=("Helvetica", 11), bg=card_bg, fg="#7f8c8d",
                                     anchor="w", wraplength=740)
        self.title_label.pack(fill="x", padx=15, pady=(0, 10))

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
        tk.Label(date_row, text="      最新：", font=("Helvetica", 13),
                 bg=card_bg, fg=fg).pack(side="left")
        self.newest_val = tk.Label(date_row, text="—",
                                    font=("Helvetica", 13, "bold"), bg=card_bg, fg="#4ecca3")
        self.newest_val.pack(side="left")

        # ── Phase 3: ID scan ──
        scan_card = tk.LabelFrame(self.root, text=" Phase 3：歷史文章掃描（2023-08 ~ 2025-05） ",
                                   font=("Helvetica", 12, "bold"),
                                   bg=card_bg, fg="#e0e0e0", bd=2, relief="groove")
        scan_card.pack(fill="x", padx=20, pady=8)

        row3 = tk.Frame(scan_card, bg=card_bg)
        row3.pack(fill="x", padx=15, pady=5)
        tk.Label(row3, text="掃描進度：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.scan_progress_val = tk.Label(row3, text="0 / 670,309",
                                           font=("Helvetica", 12, "bold"), bg=card_bg, fg="#4ecca3")
        self.scan_progress_val.pack(side="left")
        tk.Label(row3, text="  找到：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.scan_found_val = tk.Label(row3, text="0",
                                        font=("Helvetica", 12, "bold"), bg=card_bg, fg="#f39c12")
        self.scan_found_val.pack(side="left")
        tk.Label(row3, text="  速度：", font=("Helvetica", 12), bg=card_bg, fg=fg).pack(side="left")
        self.scan_speed_val = tk.Label(row3, text="—",
                                        font=("Helvetica", 12, "bold"), bg=card_bg, fg="#7f8c8d")
        self.scan_speed_val.pack(side="left")

        self.scan_bar = ttk.Progressbar(scan_card, length=770, mode="determinate",
                                         maximum=self.scan_total)
        self.scan_bar.pack(padx=15, pady=(0, 5))

        self.scan_title_label = tk.Label(scan_card, text="等待中...",
                                          font=("Helvetica", 11), bg=card_bg, fg="#7f8c8d",
                                          anchor="w", wraplength=740)
        self.scan_title_label.pack(fill="x", padx=15, pady=(0, 10))

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

        # ── Start buttons ──
        btn_frame = tk.Frame(self.root, bg=bg)
        btn_frame.pack(pady=15)
        self.start_btn = tk.Button(btn_frame, text="  完整爬取  ",
                                    font=("Helvetica", 14, "bold"),
                                    bg=accent, fg="white", activebackground="#c0392b",
                                    bd=0, padx=20, pady=8, command=self._start)
        self.start_btn.pack(side="left", padx=10)
        self.scan_btn = tk.Button(btn_frame, text="  僅歷史掃描 (Phase 3)  ",
                                   font=("Helvetica", 14, "bold"),
                                   bg="#0f3460", fg="white", activebackground="#16213e",
                                   bd=0, padx=20, pady=8, command=self._start_scan_only)
        self.scan_btn.pack(side="left", padx=10)

    # ──── Animation tick ────
    def _tick(self):
        spinners = ["◐", "◓", "◑", "◒"]
        active = self.phase in ("listing", "fetching", "scanning", "parallel")
        if active:
            self.spinner_idx = (self.spinner_idx + 1) % len(spinners)
            self.spinner_label.config(text=spinners[self.spinner_idx])
            # Pulse
            self.pulse_val += self.pulse_dir * 15
            if self.pulse_val > 255:
                self.pulse_val, self.pulse_dir = 255, -1
            elif self.pulse_val < 80:
                self.pulse_val, self.pulse_dir = 80, 1
            v = self.pulse_val
            if self.phase == "listing":
                self.phase_label.config(fg=f"#{0:02x}{v:02x}{0x60:02x}")
            elif self.phase == "parallel":
                self.phase_label.config(fg=f"#{v:02x}{0x80:02x}{v:02x}")
            elif self.phase == "fetching":
                self.phase_label.config(fg=f"#{0x40:02x}{0x80:02x}{v:02x}")
            else:  # scanning
                self.phase_label.config(fg=f"#{v:02x}{0x80:02x}{0x40:02x}")
        elif self.phase == "done":
            self.spinner_label.config(text="✅")

        self._refresh_values()
        self.root.after(150, self._tick)

    def _refresh_values(self):
        self.page_val.config(text=f"{self.page_count} / {self.page_max}")
        self.list_bar["value"] = self.page_count
        self.url_val.config(text=str(self.url_count))

        self.fetch_ok_val.config(text=str(self.fetch_done))
        self.fetch_fail_val.config(text=str(self.fetch_fail))
        self.fetch_total_val.config(text=str(self.fetch_total))
        if self.fetch_total > 0:
            self.fetch_bar["maximum"] = self.fetch_total
            self.fetch_bar["value"] = self.fetch_done + self.fetch_fail

        self.oldest_val.config(text=self.oldest_date)
        self.newest_val.config(text=self.newest_date)
        self.speed_label.config(text=self.speed)

        if self.latest_title:
            self.title_label.config(text=f"最新：{self.latest_title[:65]}", fg="#ecf0f1")

        for name, lbl in self.stock_labels.items():
            lbl.config(text=str(self.stock_hits[name]))

        # Phase 3 progress (always update)
        scanned = self.scan_current - SCAN_ID_START
        self.scan_progress_val.config(text=f"{scanned:,} / {self.scan_total:,}")
        self.scan_found_val.config(text=str(self.scan_found))
        self.scan_bar["value"] = scanned
        self.scan_speed_val.config(text=self.scan_speed)

        # Phase label + speed calculations
        if self.phase == "listing":
            self.phase_label.config(text="Phase 1：API 列表取得中...")
        elif self.phase == "parallel":
            # Phase 2 speed
            if self._phase2_running and self._start_time:
                elapsed = time.time() - self._start_time
                done = self.fetch_done + self.fetch_fail
                if done > 0 and elapsed > 0:
                    rate = done / elapsed
                    remaining = (self.fetch_total - done) / rate if rate > 0 else 0
                    self.speed = f"P2: {rate:.1f} 篇/秒 剩餘 {int(remaining//60)}:{int(remaining%60):02d}"
            # Phase 3 speed
            if self._phase3_running and self._scan_start_time:
                elapsed = time.time() - self._scan_start_time
                if scanned > 0 and elapsed > 0:
                    rate = scanned / elapsed
                    remaining = (self.scan_total - scanned) / rate if rate > 0 else 0
                    self.scan_speed = f"{rate:.0f} ID/秒 ｜ 剩餘 {int(remaining//60)}:{int(remaining%60):02d}"
            self.phase_label.config(text="Phase 2 + 3：並行執行中...")
        elif self.phase == "fetching":
            elapsed = time.time() - self._start_time if self._start_time else 0
            done = self.fetch_done + self.fetch_fail
            if done > 0 and elapsed > 0:
                rate = done / elapsed
                remaining = (self.fetch_total - done) / rate if rate > 0 else 0
                self.speed = f"{rate:.1f} 篇/秒 ｜ 剩餘 {int(remaining//60)}:{int(remaining%60):02d}"
            self.phase_label.config(text="Phase 2：抓取文章中...")
        elif self.phase == "scanning":
            elapsed = time.time() - self._scan_start_time if self._scan_start_time else 0
            if scanned > 0 and elapsed > 0:
                rate = scanned / elapsed
                remaining = (self.scan_total - scanned) / rate if rate > 0 else 0
                self.scan_speed = f"{rate:.0f} ID/秒 ｜ 剩餘 {int(remaining//60)}:{int(remaining%60):02d}"
            self.phase_label.config(text="Phase 3：歷史掃描中...")
        elif self.phase == "done":
            self.phase_label.config(text="完成！", fg="#2ecc71")

    # ──── Button handlers ────
    def _start(self):
        self.start_btn.config(state="disabled", text="執行中...", bg="#7f8c8d")
        self.scan_btn.config(state="disabled", bg="#7f8c8d")
        self.phase = "listing"
        threading.Thread(target=self._crawl_worker, daemon=True).start()

    def _start_scan_only(self):
        self.start_btn.config(state="disabled", bg="#7f8c8d")
        self.scan_btn.config(state="disabled", text="執行中...", bg="#7f8c8d")
        self.phase = "scanning"
        threading.Thread(target=self._scan_only_worker, daemon=True).start()

    # ──── Helper: update date range ────
    def _update_date(self, d):
        if d and d > "2000":
            if self.oldest_date == "—" or d < self.oldest_date:
                self.oldest_date = d
            if self.newest_date == "—" or d > self.newest_date:
                self.newest_date = d

    # ──── Helper: update stock hits ────
    def _update_stock_hits(self, data):
        text = data["標題"] + data["內文"][:300]
        for name, code in TARGET_STOCKS.items():
            if name in text or code in text:
                self.stock_hits[name] += 1

    # ──── Phase 1: API listing (parallel + smart early exit) ────
    def _phase1_listing(self, existing_urls):
        all_articles = {}
        all_known_count = 0
        empty_count = 0
        page = 2
        stop = False

        while page < MAX_PAGES + 2 and not stop:
            batch_end = min(page + API_BATCH_SIZE, MAX_PAGES + 2)
            pages_to_fetch = list(range(page, batch_end))

            # Fetch batch in parallel
            results = {}
            with ThreadPoolExecutor(max_workers=API_WORKERS) as pool:
                futures = {pool.submit(_fetch_api_page, p): p for p in pages_to_fetch}
                for future in as_completed(futures):
                    pg, data = future.result()
                    results[pg] = data

            # Process in page order (important for early exit)
            for pg in sorted(results.keys()):
                data = results[pg]
                if data is None:
                    empty_count += 1
                    if empty_count >= 3:
                        stop = True
                        break
                    continue
                empty_count = 0

                new_on_page = 0
                for item in data:
                    url = item.get("url", "")
                    if url and url not in existing_urls:
                        all_articles[url] = {
                            "title": item.get("LTNA_Title", ""),
                            "date": item.get("A_ViewTime", ""),
                        }
                        new_on_page += 1
                    d = item.get("A_ViewTime", "")[:10]
                    self._update_date(d)

                self.page_count = pg - 1
                self.url_count = len(all_articles)

                # Smart early exit: all articles on this page already known
                if new_on_page == 0 and len(data) > 0:
                    all_known_count += 1
                    if all_known_count >= EARLY_EXIT_THRESHOLD:
                        stop = True
                        break
                else:
                    all_known_count = 0

            page = batch_end

        self.page_max = self.page_count
        return all_articles

    # ──── Phase 2: Fetch article content ────
    def _phase2_fetch(self, csv_path, existing_urls, all_articles, write_lock):
        self._phase2_running = True
        self.fetch_total = len(all_articles)
        self._start_time = time.time()

        if not all_articles:
            self._phase2_running = False
            return

        fieldnames = ["標題", "發布時間", "內文", "連結", "來源"]
        csv_file = open(csv_path, "a", encoding="utf-8-sig", newline="")
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        if not existing_urls:
            writer.writeheader()

        urls = list(all_articles.keys())
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(_fetch_article, u): u for u in urls}
            for future in as_completed(futures):
                data = future.result()
                if data:
                    with write_lock:
                        writer.writerow(data)
                        csv_file.flush()
                    self.fetch_done += 1
                    self.latest_title = data["標題"]
                    self._update_date(data["發布時間"][:10])
                    self._update_stock_hits(data)
                else:
                    self.fetch_fail += 1

        csv_file.close()
        self._phase2_running = False

    # ──── Phase 3: Historical ID scan (with checkpoint) ────
    def _phase3_scan(self, csv_path, existing_urls, write_lock):
        self._phase3_running = True
        self._scan_start_time = time.time()

        # Load checkpoint (resume from last position)
        scan_start = SCAN_ID_START
        if os.path.exists(SCAN_CHECKPOINT):
            try:
                with open(SCAN_CHECKPOINT, "r") as f:
                    saved = int(f.read().strip())
                if SCAN_ID_START <= saved <= SCAN_ID_END:
                    scan_start = saved
            except (ValueError, IOError):
                pass

        # Already completed
        if scan_start >= SCAN_ID_END:
            self.scan_current = SCAN_ID_END
            self.scan_title_label.config(text="歷史掃描已完成 ✓", fg="#4ecca3")
            self._phase3_running = False
            return

        skipped = scan_start - SCAN_ID_START
        self.scan_current = scan_start
        self.scan_title_label.config(
            text=f"從 ID {scan_start:,} 續掃（已跳過 {skipped:,}）", fg="#ecf0f1")

        fieldnames = ["標題", "發布時間", "內文", "連結", "來源"]
        csv_file = open(csv_path, "a", encoding="utf-8-sig", newline="")
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)

        batch_size = 1000
        for batch_start in range(scan_start, SCAN_ID_END, batch_size):
            batch_end = min(batch_start + batch_size, SCAN_ID_END)
            ids = list(range(batch_start, batch_end))
            with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as pool:
                futures = {pool.submit(_scan_article, aid, existing_urls): aid for aid in ids}
                for future in as_completed(futures):
                    data = future.result()
                    if data:
                        with write_lock:
                            writer.writerow(data)
                            csv_file.flush()
                        self.scan_found += 1
                        self.latest_title = data["標題"]
                        self.scan_title_label.config(
                            text=f"找到：{data['標題'][:55]}", fg="#ecf0f1")
                        self._update_date(data["發布時間"][:10])
                        self._update_stock_hits(data)
            self.scan_current = batch_end
            # Save checkpoint every batch
            with open(SCAN_CHECKPOINT, "w") as f:
                f.write(str(batch_end))

        csv_file.close()
        self._phase3_running = False

    # ──── Main worker: 完整爬取 ────
    def _crawl_worker(self):
        ltn_dir = os.path.join(NEWS_DB_PATH, "ltn")
        os.makedirs(ltn_dir, exist_ok=True)
        csv_path = os.path.join(ltn_dir, "ltn_news.csv")

        # Load existing URLs
        existing_urls = _load_existing_urls(csv_path)

        # Phase 1: parallel API listing with smart early exit
        all_articles = self._phase1_listing(existing_urls)

        # Prepare shared resources
        write_lock = threading.Lock()
        # Merge Phase 1 URLs into existing for Phase 3 dedup
        existing_urls_for_phase3 = existing_urls | set(all_articles.keys())

        # Phase 2 + Phase 3 in parallel
        self.phase = "parallel"

        t2 = threading.Thread(
            target=self._phase2_fetch,
            args=(csv_path, existing_urls, all_articles, write_lock),
            daemon=True
        )
        t3 = threading.Thread(
            target=self._phase3_scan,
            args=(csv_path, existing_urls_for_phase3, write_lock),
            daemon=True
        )
        t2.start()
        t3.start()
        t2.join()
        t3.join()

        self.phase = "done"
        self.root.after(0, lambda: self.start_btn.config(
            state="normal", text="完成！", bg="#2ecc71"
        ))

    # ──── Scan-only worker: 僅歷史掃描 ────
    def _scan_only_worker(self):
        ltn_dir = os.path.join(NEWS_DB_PATH, "ltn")
        os.makedirs(ltn_dir, exist_ok=True)
        csv_path = os.path.join(ltn_dir, "ltn_news.csv")

        existing_urls = _load_existing_urls(csv_path)
        self.phase_label.config(text=f"Phase 3：歷史掃描中...（已有 {len(existing_urls):,} 篇）")

        write_lock = threading.Lock()
        self._phase3_scan(csv_path, existing_urls, write_lock)

        self.phase = "done"
        self.root.after(0, lambda: self.scan_btn.config(
            state="normal", text="完成！", bg="#2ecc71"
        ))


# ─────────────────── Headless（無 UI）版 Phase 1+2 ───────────────────
def _headless_phase1_listing(existing_urls):
    """與 LtnCrawlerGUI._phase1_listing 相同邏輯，改用 log 取代 UI 更新，回傳 (articles, oldest, newest)。"""
    all_articles = {}
    all_known_count = 0
    empty_count = 0
    page = 2
    stop = False
    oldest_date = "—"
    newest_date = "—"

    def update_date(d):
        nonlocal oldest_date, newest_date
        if d and d > "2000":
            if oldest_date == "—" or d < oldest_date:
                oldest_date = d
            if newest_date == "—" or d > newest_date:
                newest_date = d

    while page < MAX_PAGES + 2 and not stop:
        batch_end = min(page + API_BATCH_SIZE, MAX_PAGES + 2)
        pages_to_fetch = list(range(page, batch_end))

        results = {}
        with ThreadPoolExecutor(max_workers=API_WORKERS) as pool:
            futures = {pool.submit(_fetch_api_page, p): p for p in pages_to_fetch}
            for future in as_completed(futures):
                pg, data = future.result()
                results[pg] = data

        for pg in sorted(results.keys()):
            data = results[pg]
            if data is None:
                empty_count += 1
                if empty_count >= 3:
                    stop = True
                    break
                continue
            empty_count = 0

            new_on_page = 0
            for item in data:
                url = item.get("url", "")
                if url and url not in existing_urls:
                    all_articles[url] = {
                        "title": item.get("LTNA_Title", ""),
                        "date": item.get("A_ViewTime", ""),
                    }
                    new_on_page += 1
                update_date(item.get("A_ViewTime", "")[:10])

            if new_on_page == 0 and len(data) > 0:
                all_known_count += 1
                if all_known_count >= EARLY_EXIT_THRESHOLD:
                    stop = True
                    break
            else:
                all_known_count = 0

        page = batch_end

    return all_articles, oldest_date, newest_date


def _headless_phase2_fetch(csv_path, existing_urls, all_articles):
    """與 LtnCrawlerGUI._phase2_fetch 相同邏輯，改用 log 取代 UI 更新，回傳 (done, fail)。"""
    if not all_articles:
        return 0, 0

    fieldnames = ["標題", "發布時間", "內文", "連結", "來源"]
    write_lock = threading.Lock()
    csv_file = open(csv_path, "a", encoding="utf-8-sig", newline="")
    writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
    if not existing_urls:
        writer.writeheader()

    done, fail = 0, 0
    urls = list(all_articles.keys())
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(_fetch_article, u): u for u in urls}
        for future in as_completed(futures):
            data = future.result()
            if data:
                with write_lock:
                    writer.writerow(data)
                    csv_file.flush()
                done += 1
            else:
                fail += 1

    csv_file.close()
    return done, fail


def run_incremental_crawl() -> None:
    """Phase 1+2 增量抓取一次：取得近期列表、抓全文、寫入 CSV。供排程/手動回補使用。"""
    ltn_dir = os.path.join(NEWS_DB_PATH, "ltn")
    os.makedirs(ltn_dir, exist_ok=True)
    csv_path = os.path.join(ltn_dir, "ltn_news.csv")

    existing_urls = _load_existing_urls(csv_path)
    log.info("既有文章數：%d", len(existing_urls))

    log.info("Phase 1：取得近期文章列表...")
    all_articles, oldest_date, newest_date = _headless_phase1_listing(existing_urls)
    log.info("Phase 1 完成，新增 %d 篇（日期範圍 %s ~ %s）", len(all_articles), oldest_date, newest_date)

    log.info("Phase 2：抓取文章內文...")
    done, fail = _headless_phase2_fetch(csv_path, existing_urls, all_articles)
    log.info("Phase 2 完成，成功 %d 篇，失敗 %d 篇", done, fail)


def _scheduled_crawl_job() -> None:
    log.info("開始排程抓取 LTN 新聞（Phase 1+2 增量）")
    try:
        run_incremental_crawl()
    except Exception:
        log.exception("排程抓取發生未預期錯誤")


def main() -> None:
    parser = argparse.ArgumentParser(description="LTN 自由財經新聞爬蟲")
    parser.add_argument(
        "--scheduled-once",
        action="store_true",
        help="執行一次 Phase 1+2 增量抓取後結束，供 scheduler_utils 統一排程（不含 Phase 3 歷史回填）",
    )
    args = parser.parse_args()

    if args.scheduled_once:
        _scheduled_crawl_job()
    else:
        root = tk.Tk()
        app = LtnCrawlerGUI(root)
        root.mainloop()


if __name__ == "__main__":
    main()
