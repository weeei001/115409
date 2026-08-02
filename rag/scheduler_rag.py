"""
RAG 新聞排程工作：LTN 抓取 → 清洗 → 匯入 MySQL `news_articles`。

三個步驟都用 subprocess 跑，cwd 固定在 rag/（各腳本的 NEWS_DB_PATH 都是相對路徑）：
    1. crawler_ltn_gui.py --scheduled-once  取列表＋抓內文 → ltn_news.csv
    2. clean_ltn.py                         清洗 → ltn_news_cleaned.csv
    3. ingest_sources.py --ltn-only         寫入 MySQL news_articles（依 article_id 去重）

執行方式：
    python scheduler_rag.py              # 自己跑 30 分鐘迴圈
    python scheduler_rag.py --run-once   # 跑一次就結束，供 backend/crawler/scheduler_utils.py 統一排程

cnyes 那支 crawler_gui.py 是 Streamlit GUI、沒有 headless 入口所以不在這裡；
鉅亨新聞由 backend/crawler/cnyes_crawlwer.py 直接寫入 news_articles。
"""
import argparse
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
LTN_CLEAN_SCRIPT = RAG_DIR / "clean_ltn.py"
LTN_INGEST_SCRIPT = RAG_DIR / "ingest_sources.py"
LTN_INTERVAL_MINUTES = 30


def _python_executable() -> str:
    return sys.executable


def _subprocess_text_encoding() -> str:
    return locale.getpreferredencoding(False) or "utf-8"


def _run_step(script_path: Path, args: list[str], label: str) -> bool:
    """跑一支 rag/ 腳本，成功回傳 True。"""
    if not script_path.exists():
        log.error("找不到腳本 '%s'。", script_path)
        return False

    command = [_python_executable(), str(script_path), *args]
    log.info("▶️ %s：%s", label, " ".join(command))
    try:
        result = subprocess.run(
            command,
            cwd=str(RAG_DIR),  # 各腳本的 NEWS_DB_PATH 為相對路徑，須在 rag/ 下執行
            capture_output=True,
            text=True,
            encoding=_subprocess_text_encoding(),
            errors="replace",
        )
    except Exception as e:
        log.error("執行 %s 時發生未預期例外: %s", label, e)
        return False

    if result.returncode != 0:
        log.error("❌ %s 失敗 (Return code: %s)", label, result.returncode)
        if result.stderr:
            log.error("錯誤訊息：\n%s", result.stderr)
        return False

    if result.stdout:
        log.info("%s 輸出：\n%s", label, result.stdout.strip())
    log.info("✅ %s 完成", label)
    return True


def run_ltn_job() -> None:
    """LTN 新聞：增量抓取 → 清洗 → 匯入 news_articles，任一步失敗就中止後續。"""
    log.info("📰 開始執行 LTN 新聞排程（抓取 → 清洗 → 匯入 MySQL）...")

    steps = [
        (LTN_CRAWLER_SCRIPT, ["--scheduled-once"], "LTN 抓取（Phase 1+2 增量）"),
        (LTN_CLEAN_SCRIPT, [], "LTN 清洗"),
        (LTN_INGEST_SCRIPT, ["--ltn-only"], "LTN 匯入 news_articles"),
    ]
    for script_path, args, label in steps:
        if not _run_step(script_path, args, label):
            log.error("🛑 LTN 排程於「%s」中止，本輪不再往下跑。", label)
            return

    log.info("🎉 LTN 新聞排程完成，資料已更新至 news_articles。")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RAG 新聞排程器（LTN）")
    parser.add_argument(
        "--run-once",
        action="store_true",
        help="執行一次 LTN 抓取＋清洗＋匯入後結束，供 backend/crawler/scheduler_utils.py 統一排程",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.run_once:
        run_ltn_job()
        return

    log.info("🕒 啟動 RAG 新聞爬蟲排程器...")

    interval = max(1, LTN_INTERVAL_MINUTES)
    schedule.every(interval).minutes.do(run_ltn_job)
    log.info("✅ 已設定每 %s 分鐘執行：LTN 抓取 → 清洗 → 匯入 news_articles", interval)

    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("🛑 收到中斷訊號，排程器已停止。")


if __name__ == "__main__":
    main()
