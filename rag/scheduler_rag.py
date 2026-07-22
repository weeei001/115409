"""
RAG 新聞爬蟲排程器（獨立於 backend/crawler/scheduler_utils.py，各自的 launchd job）。

目前只排 LTN（自由時報），因為 crawler_gui.py（cnyes）是 Streamlit GUI，
沒有 headless 入口，無法排程；如需自動化 cnyes，之後要另外做一支
headless 版腳本再加進這裡。
"""
import locale
import logging
import subprocess
import sys
import time
from pathlib import Path

import schedule

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

RAG_DIR = Path(__file__).resolve().parent
LTN_CRAWLER_SCRIPT = RAG_DIR / "crawler_ltn_gui.py"
LTN_INTERVAL_MINUTES = 30


def _python_executable() -> str:
    return sys.executable


def _subprocess_text_encoding() -> str:
    return locale.getpreferredencoding(False) or "utf-8"


def run_ltn_job() -> None:
    """自由時報新聞：排程跑 Phase 1+2 增量抓取（--scheduled-once），不含 Phase 3 歷史回填。"""
    script_path = LTN_CRAWLER_SCRIPT
    python_cmd = _python_executable()
    if not script_path.exists():
        log.error("找不到 LTN 爬蟲檔案 '%s'。", script_path)
        return
    try:
        command = [python_cmd, str(script_path), "--scheduled-once"]
        output_encoding = _subprocess_text_encoding()
        log.info("📰 開始執行 LTN 新聞排程抓取...")
        log.info(f"執行指令: {' '.join(command)}")
        result = subprocess.run(
            command,
            cwd=str(script_path.parent),  # NEWS_DB_PATH 為相對路徑，須在 rag/ 下執行
            capture_output=True,
            text=True,
            encoding=output_encoding,
            errors="replace",
        )
        if result.returncode == 0:
            log.info("✅ LTN 新聞抓取完成！")
        else:
            log.error(f"❌ LTN 新聞抓取失敗 (Return code: {result.returncode})")
            log.error(f"錯誤訊息：\n{result.stderr}")
    except Exception as e:
        log.error(f"執行 LTN 爬蟲時發生未預期例外: {e}")


def main():
    log.info("🕒 啟動 RAG 新聞爬蟲排程器...")

    interval = max(1, LTN_INTERVAL_MINUTES)
    schedule.every(interval).minutes.do(run_ltn_job)
    log.info(
        "✅ 已設定每 %s 分鐘執行：%s（--scheduled-once，Phase 1+2 增量）",
        interval,
        LTN_CRAWLER_SCRIPT.name,
    )

    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("🛑 收到中斷訊號，排程器已停止。")


if __name__ == "__main__":
    main()
