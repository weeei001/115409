import locale
import logging
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
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
FINMIND_FETCH_SCRIPT = CRAWLER_DIR / "finmind" / "fetch_finmind.py"
FINMIND_IMPORT_SCRIPT = CRAWLER_DIR / "finmind" / "import_finmind_csv.py"
FINMIND_OUT_DIR = CRAWLER_DIR / "finmind" / "finmind_output"
FINMIND_START_DATE = "2021-01-01"
FINMIND_SCHEDULE_TIME = "17:00"  
FINMIND_SYMBOLS = ["2330", "2317", "2454", "2881", "2408", "2615"]
RUN_CNYES_NEWS_CRAWL = True
CNYES_INTERVAL_MINUTES = 30
CNYES_SCHEDULE_LOOKBACK_DAYS = 5
TZ_TAIPEI = timezone(timedelta(hours=8))


def _python_executable() -> str:
    return sys.executable


def _subprocess_text_encoding() -> str:
    return locale.getpreferredencoding(False) or "utf-8"


def _finmind_end_date() -> str:
    return datetime.now(tz=TZ_TAIPEI).strftime("%Y-%m-%d")


def _run_python_command(command: list[str], job_name: str) -> bool:
    output_encoding = _subprocess_text_encoding()
    log.info("%s", job_name)
    log.info("執行指令: %s", " ".join(command))
    result = subprocess.run(
        command,
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


def run_finmind_job() -> None:
    script_path = FINMIND_FETCH_SCRIPT
    import_script_path = FINMIND_IMPORT_SCRIPT
    python_cmd = _python_executable()

    if not script_path.exists():
        log.error("找不到 FinMind 爬蟲檔案 '%s'。", script_path)
        return
    if not import_script_path.exists():
        log.error("找不到 FinMind 匯入腳本 '%s'。", import_script_path)
        return

    start_date = FINMIND_START_DATE
    end_date = _finmind_end_date()
    symbols = ",".join(FINMIND_SYMBOLS)

    fetch_command = [
        python_cmd,
        str(script_path),
        "--stocks",
        symbols,
        "--start",
        start_date,
        "--end",
        end_date,
        "--out",
        str(FINMIND_OUT_DIR),
    ]
    log.info("開始執行 FinMind 抓取作業（%s -> %s）...", start_date, end_date)
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


def run_cnyes_job() -> None:
    """鉅亨台股新聞：排程固定回補最近 5 天。"""
    if not RUN_CNYES_NEWS_CRAWL:
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


def main():
    """
    排程器主程式
    """
    log.info("🕒 啟動台股爬蟲排程器...")

    schedule.every().day.at(FINMIND_SCHEDULE_TIME).do(run_finmind_job)
    log.info(
        "✅ 已設定每日 %s 執行：FinMind（起點 %s，迄今日）",
        FINMIND_SCHEDULE_TIME,
        FINMIND_START_DATE,
    )

    if RUN_CNYES_NEWS_CRAWL:
        interval = max(1, CNYES_INTERVAL_MINUTES)
        schedule.every(interval).minutes.do(run_cnyes_job)
        log.info(
            "✅ 已設定每 %s 分鐘執行：%s（--scheduled-once，固定回補最近 %s 天）",
            interval,
            CNYES_CRAWLER_SCRIPT.name,
            CNYES_SCHEDULE_LOOKBACK_DAYS,
        )

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
