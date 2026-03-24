import streamlit as st
import subprocess
import csv
import os
import time
import datetime
import pandas as pd

CSV_PATH = "OtherNewWeb/News_Crawler-master/NewsDB/cnyes/cnyes_news.csv"
LOG_PATH = "/tmp/cnyes_crawler.log"
CRAWLER_CMD = [
    "python3", "-u", "-c",
    "import sys; sys.path.insert(0, 'OtherNewWeb/News_Crawler-master'); from CrawlerPy import Crawler_for_cnyes; Crawler_for_cnyes.Main('OtherNewWeb/News_Crawler-master/NewsDB')"
]

st.set_page_config(page_title="鉅亨網爬蟲控制台", layout="wide")
st.title("📰 鉅亨網爬蟲控制台")

# ── Session State ──────────────────────────────────────────────
if "process" not in st.session_state:
    st.session_state.process = None

# ── 讀取 CSV 統計 ──────────────────────────────────────────────
def read_stats():
    if not os.path.exists(CSV_PATH):
        return 0, None, None, {}
    rows = []
    try:
        with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) >= 8:
                    rows.append(row)
    except Exception:
        return 0, None, None, {}

    if not rows:
        return 0, None, None, {}

    total = len(rows)
    newest = rows[0][2] if rows else None
    oldest = rows[-1][2] if rows else None

    industry_count = {}
    for row in rows:
        for ind in row[7].split("|"):
            ind = ind.strip()
            if ind:
                industry_count[ind] = industry_count.get(ind, 0) + 1

    return total, newest, oldest, industry_count

# ── 爬蟲狀態 ──────────────────────────────────────────────────
def is_running():
    p = st.session_state.process
    return p is not None and p.poll() is None

# ── 上方指標卡 ─────────────────────────────────────────────────
total, newest, oldest, industry_count = read_stats()

col1, col2, col3, col4 = st.columns(4)
col1.metric("📦 已抓取筆數", f"{total:,}")
col2.metric("🕐 最新資料", newest or "-")
col3.metric("📅 最舊資料", oldest or "-")
col4.metric("🔄 爬蟲狀態", "🟢 執行中" if is_running() else "⚫ 已停止")

st.divider()

# ── 控制按鈕 ──────────────────────────────────────────────────
col_start, col_stop, col_clear = st.columns([1, 1, 1])

with col_start:
    if st.button("▶ 啟動爬蟲", disabled=is_running(), use_container_width=True, type="primary"):
        # 先強制清除所有殘留爬蟲進程
        subprocess.run(["pkill", "-f", "Crawler_for_cnyes"], capture_output=True)
        import time as _t; _t.sleep(1)
        with open(LOG_PATH, "w") as log_f:
            st.session_state.process = subprocess.Popen(
                CRAWLER_CMD,
                stdout=log_f,
                stderr=log_f,
            )
        st.rerun()

with col_stop:
    if st.button("⏹ 停止爬蟲", use_container_width=True):
        subprocess.run(["pkill", "-f", "Crawler_for_cnyes"], capture_output=True)
        st.session_state.process = None
        st.rerun()

with col_clear:
    if st.button("🗑 清空 CSV", use_container_width=True):
        with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerow(["新聞 ID", "標題", "發布時間", "來源", "標籤", "連結", "內文", "產業分類"])
        st.success("CSV 已清空！")
        st.rerun()

st.divider()

# ── 產業分類統計 ───────────────────────────────────────────────
st.subheader("📊 產業分類統計")
if industry_count:
    df_ind = pd.DataFrame(
        [(k, v) for k, v in sorted(industry_count.items(), key=lambda x: -x[1])],
        columns=["產業", "筆數"]
    )
    st.bar_chart(df_ind.set_index("產業"))
else:
    st.info("尚無資料")

st.divider()

# ── 即時 Log ──────────────────────────────────────────────────
st.subheader("📋 執行 Log")

if os.path.exists(LOG_PATH):
    with open(LOG_PATH, "r") as f:
        lines = f.readlines()
    log_text = "".join(lines[-80:]) if lines else "（尚無 log）"
else:
    log_text = "（尚無 log）"
st.code(log_text, language=None)

# ── 最新 10 筆資料預覽 ─────────────────────────────────────────
st.divider()
st.subheader("🗞 最新 10 筆資料")
if total > 0:
    try:
        df = pd.read_csv(CSV_PATH, encoding="utf-8-sig", nrows=10,
                         names=["ID","標題","時間","來源","標籤","連結","內文","產業"],
                         skiprows=1)
        st.dataframe(df[["時間","標題","產業","標籤"]].fillna(""), use_container_width=True)
    except Exception as e:
        st.warning(f"讀取失敗: {e}")
else:
    st.info("尚無資料")

# ── 自動重新整理（執行中時每 5 秒刷新）─────────────────────────
if is_running():
    time.sleep(5)
    st.rerun()
