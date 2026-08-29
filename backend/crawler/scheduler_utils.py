import argparse
import locale
import logging
import subprocess
import sys
import time
from pathlib import Path

import schedule

# 設定 Logging
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

# 定期更新流程固定於此：若要改時間或腳本，請直接改常數。
CRAWLER_DIR = Path(__file__).resolve().parent
CNYES_CRAWLER_SCRIPT = CRAWLER_DIR / "cnyes_crawlwer.py"
LTN_CRAWLER_SCRIPT = CRAWLER_DIR / "ltn_crawler.py"
FINMIND_FETCH_SCRIPT = CRAWLER_DIR / "finmind" / "fetch_finmind.py"
FINMIND_IMPORT_SCRIPT = CRAWLER_DIR / "finmind" / "import_finmind_csv.py"
FINMIND_OUT_DIR = CRAWLER_DIR / "finmind" / "finmind_output"
RAG_DIR = CRAWLER_DIR.parents[1] / "rag"
RAG_CHUNK_SCRIPT = RAG_DIR / "run_chunking.py"
RAG_VECTOR_SCRIPT = RAG_DIR / "build_vector_db_headless.py"
FINMIND_START_DATE = "2021-01-01"
FINMIND_SCHEDULE_TIME = "17:00"
FINMIND_SYMBOLS = ["2330", "2317", "2454", "2881", "2408", "2615"]
RUN_FINMIND = True
RUN_CNYES_NEWS_CRAWL = True
CNYES_INTERVAL_MINUTES = 30
CNYES_SCHEDULE_LOOKBACK_DAYS = 30
# LTN（自由時報）：ltn_crawler.py --scheduled-once 抓到就直接寫入 news_articles，不經 CSV。
RUN_LTN_NEWS_CRAWL = True
LTN_INTERVAL_MINUTES = 30
LTN_SCHEDULE_LOOKBACK_DAYS = 30
# 向量管線：新聞抓完後隔 RAG_DELAY_MINUTES 分鐘跑一次 切塊 → 向量化。
# 兩支腳本都是斷點續傳（切塊看 news_chunks、向量化看 Qdrant 既有 chunk_id），重跑安全。
RUN_RAG_PIPELINE = True
RAG_DELAY_MINUTES = 10
_rag_followup_armed = False
# AI 個股分析：向量管線跑完（＝股價、新聞、向量都齊了）後產生 text-brief，個股頁只讀快取。
# 不帶 force_refresh，所以同一檔＋同一基準日只會真的呼叫一次 LLM，之後每輪都是空跑。
RUN_TEXT_BRIEF = True
TEXT_BRIEF_SCRIPT = CRAWLER_DIR.parent / "scripts" / "warm_text_brief.py"
TEXT_BRIEF_SYMBOLS = FINMIND_SYMBOLS


def _python_executable() -> str:
    return sys.executable


def _subprocess_text_encoding() -> str:
    return locale.getpreferredencoding(False) or "utf-8"


def _run_python_command(command: list[str], job_name: str, cwd: Path | None = None) -> bool:
    output_encoding = _subprocess_text_encoding()
    log.info("%s", job_name)
    log.info("執行指令: %s", " ".join(command))
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding=output_encoding,
        errors="replace",
    )
    if result.returncode == 0:
        return True
    log.error("%s 失敗 (Return code: %s)", job_name, result.returncode)
    if result.stderr:
        log.error("錯誤訊息：\n%s", result.stderr)
    return False


def run_finmind_job(start_date: str = FINMIND_START_DATE) -> None:
    script_path = FINMIND_FETCH_SCRIPT
    import_script_path = FINMIND_IMPORT_SCRIPT
    python_cmd = _python_executable()

    if not script_path.exists():
        log.error("找不到 FinMind 爬蟲檔案 '%s'。", script_path)
        return
    if not import_script_path.exists():
        log.error("找不到 FinMind 匯入腳本 '%s'。", import_script_path)
        return

    symbols = ",".join(FINMIND_SYMBOLS)

    fetch_command = [
        python_cmd,
        str(script_path),
        "--stocks",
        symbols,
        "--start",
        start_date,
        "--out",
        str(FINMIND_OUT_DIR),
    ]
    log.info("開始執行 FinMind 抓取作業（%s -> 今日）...", start_date)
    if not _run_python_command(fetch_command, "FinMind 抓取"):
        return

    import_command = [
        python_cmd,
        str(import_script_path),
        "--input-dir",
        str(FINMIND_OUT_DIR),
    ]
    if not _run_python_command(import_command, "FinMind CSV 匯入 MySQL"):
        return

    log.info("✅ FinMind 抓取與匯入完成！")


def run_cnyes_job(force: bool = False) -> None:
    """鉅亨台股新聞：排程固定回補最近 5 天。force=True 時忽略 RUN_CNYES_NEWS_CRAWL 開關。"""
    if not force and not RUN_CNYES_NEWS_CRAWL:
        return
    script_path = CNYES_CRAWLER_SCRIPT
    python_cmd = _python_executable()
    if not script_path.exists():
        log.error("找不到鉅亨爬蟲檔案 '%s'。", script_path)
        return
    try:
        command = [python_cmd, str(script_path), "--scheduled-once"]
        output_encoding = _subprocess_text_encoding()
        log.info("📰 開始執行鉅亨新聞排程抓取...")
        log.info(f"執行指令: {' '.join(command)}")
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding=output_encoding,
            errors="replace",
        )
        if result.returncode == 0:
            log.info("✅ 鉅亨新聞抓取完成！")
        else:
            log.error(f"❌ 鉅亨新聞抓取失敗 (Return code: {result.returncode})")
            log.error(f"錯誤訊息：\n{result.stderr}")
    except Exception as e:
        log.error(f"執行鉅亨爬蟲時發生未預期例外: {e}")


def run_ltn_job(force: bool = False) -> None:
    """自由時報新聞：排程固定回補最近 30 天，抓到就寫進 news_articles。force=True 時忽略 RUN_LTN_NEWS_CRAWL 開關。"""
    if not force and not RUN_LTN_NEWS_CRAWL:
        return
    script_path = LTN_CRAWLER_SCRIPT
    if not script_path.exists():
        log.error("找不到 LTN 爬蟲檔案 '%s'。", script_path)
        return
    try:
        command = [
            _python_executable(),
            str(script_path),
            "--scheduled-once",
            "--lookback-days",
            str(LTN_SCHEDULE_LOOKBACK_DAYS),
        ]
        if _run_python_command(command, "📰 LTN 新聞抓取"):
            log.info("✅ LTN 新聞抓取完成！")
    except Exception as e:
        log.error("執行 LTN 排程時發生未預期例外: %s", e)


def run_rag_job() -> None:
    """向量管線：run_chunking.py 切塊 → build_vector_db_headless.py 向量化。

    兩支都必須在 rag/ 底下執行：run_chunking 靠 cwd 讀 rag/.env，
    build_vector_db_headless 的 qdrant_db 路徑也是相對於 cwd。
    """
    for script_path in (RAG_CHUNK_SCRIPT, RAG_VECTOR_SCRIPT):
        if not script_path.exists():
            log.error("找不到向量管線腳本 '%s'。", script_path)
            return

    python_cmd = _python_executable()
    log.info("🧩 開始執行向量管線（切塊 → 向量化）...")
    if not _run_python_command([python_cmd, str(RAG_CHUNK_SCRIPT)], "新聞切塊 run_chunking", cwd=RAG_DIR):
        log.error("🛑 切塊失敗，本輪不進行向量化。")
        return
    if _run_python_command([python_cmd, str(RAG_VECTOR_SCRIPT)], "向量化 build_vector_db_headless", cwd=RAG_DIR):
        log.info("✅ 向量管線完成！")
        run_text_brief_job()


def run_text_brief_job(force: bool = False) -> None:
    """產生 AI 個股分析並寫進快取；已有當日快照的檔會直接跳過。"""
    if not force and not RUN_TEXT_BRIEF:
        return
    if not TEXT_BRIEF_SCRIPT.exists():
        log.error("找不到 text-brief 排程腳本 '%s'。", TEXT_BRIEF_SCRIPT)
        return
    command = [
        _python_executable(),
        str(TEXT_BRIEF_SCRIPT),
        "--symbols",
        ",".join(TEXT_BRIEF_SYMBOLS),
    ]
    log.info("開始產生 AI 個股分析（%s）...", ",".join(TEXT_BRIEF_SYMBOLS))
    if _run_python_command(command, "AI 個股分析 warm_text_brief", cwd=CRAWLER_DIR.parent):
        log.info("✅ AI 個股分析完成！")


def _arm_rag_followup() -> None:
    """新聞抓完後排一次性的向量管線；已排隊時不重複排（cnyes、LTN 可能前後腳跑完）。"""
    global _rag_followup_armed
    if not RUN_RAG_PIPELINE or _rag_followup_armed:
        return

    _rag_followup_armed = True

    def _once():
        global _rag_followup_armed
        _rag_followup_armed = False
        run_rag_job()
        return schedule.CancelJob

    schedule.every(RAG_DELAY_MINUTES).minutes.do(_once)
    log.info("⏳ 已排定 %s 分鐘後執行向量管線。", RAG_DELAY_MINUTES)


def run_cnyes_scheduled_job() -> None:
    run_cnyes_job()
    _arm_rag_followup()


def run_ltn_scheduled_job() -> None:
    run_ltn_job()
    _arm_rag_followup()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="台股爬蟲排程器")
    parser.add_argument("--start", default=FINMIND_START_DATE, help="FinMind 回補起始日 YYYY-MM-DD；結束日固定為今天")
    parser.add_argument("--run-now", action="store_true", help="啟動後立刻執行一次 FinMind 回補，然後進入排程")
    parser.add_argument(
        "--job",
        choices=["finmind", "cnyes", "ltn", "rag", "text-brief", "all"],
        help="立刻執行指定工作後結束，不進入排程迴圈",
    )
    return parser.parse_args()


def run_job_once(job: str, start_date: str = FINMIND_START_DATE) -> None:
    """單次執行指定工作，供 --job 使用；不受 RUN_* 開關限制。"""
    if job in ("finmind", "all"):
        run_finmind_job(start_date)
    if job in ("cnyes", "all"):
        run_cnyes_job(force=True)
    if job in ("ltn", "all"):
        run_ltn_job(force=True)
    if job in ("rag", "all"):
        run_rag_job()
    elif job == "text-brief":
        run_text_brief_job(force=True)


def main():
    """
    排程器主程式
    """
    args = parse_args()

    if args.job:
        log.info("▶️ 單次執行工作：%s", args.job)
        run_job_once(args.job, args.start)
        return

    log.info("🕒 啟動台股爬蟲排程器...")

    if RUN_FINMIND:
        schedule.every().day.at(FINMIND_SCHEDULE_TIME).do(run_finmind_job, args.start)
        log.info(
            "✅ 已設定每日 %s 執行：FinMind（起點 %s，迄今日）",
            FINMIND_SCHEDULE_TIME,
            args.start,
        )
        if args.run_now:
            run_finmind_job(args.start)
    else:
        log.info("⏸️ FinMind 股價排程已停用（RUN_FINMIND=False，待負責人確認）")

    if RUN_CNYES_NEWS_CRAWL:
        interval = max(1, CNYES_INTERVAL_MINUTES)
        schedule.every(interval).minutes.do(run_cnyes_scheduled_job)
        log.info(
            "✅ 已設定每 %s 分鐘執行：%s（--scheduled-once，固定回補最近 %s 天）",
            interval,
            CNYES_CRAWLER_SCRIPT.name,
            CNYES_SCHEDULE_LOOKBACK_DAYS,
        )

    if RUN_LTN_NEWS_CRAWL:
        ltn_interval = max(1, LTN_INTERVAL_MINUTES)
        schedule.every(ltn_interval).minutes.do(run_ltn_scheduled_job)
        log.info(
            "✅ 已設定每 %s 分鐘執行：%s（--scheduled-once，固定回補最近 %s 天，直接寫入 news_articles）",
            ltn_interval,
            LTN_CRAWLER_SCRIPT.name,
            LTN_SCHEDULE_LOOKBACK_DAYS,
        )

    if RUN_RAG_PIPELINE:
        log.info("✅ 已設定：新聞抓取完成後 %s 分鐘執行向量管線（切塊 → 向量化）", RAG_DELAY_MINUTES)
    else:
        log.info("⏸️ 向量管線已停用（RUN_RAG_PIPELINE=False）")

    if RUN_TEXT_BRIEF:
        log.info("✅ 已設定：向量管線完成後產生 AI 個股分析（%s，同一基準日只跑一次）", ",".join(TEXT_BRIEF_SYMBOLS))
    else:
        log.info("⏸️ AI 個股分析排程已停用（RUN_TEXT_BRIEF=False）")

    # ----------------------------------------------------
    # [開發測試用]
    # 如果你想先測試排程器是否會動，可以暫時解開下一行註解 (每分鐘執行一次)：
    # schedule.every(1).minutes.do(run_cnyes_job)
    # ----------------------------------------------------

    # 進入無窮迴圈，持續檢查是否到達排程時間
    try:
        while True:
            schedule.run_pending()
            time.sleep(1) # 每秒檢查一次
    except KeyboardInterrupt:
        log.info("🛑 收到中斷訊號，排程器已停止。")

if __name__ == "__main__":
    main()
