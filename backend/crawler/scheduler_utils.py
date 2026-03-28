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

# 定期更新流程固定於此：若要改時間、腳本或是否跑三大法人，請直接改常數。
CRAWLER_DIR = Path(__file__).resolve().parent
SCHEDULE_TIME = "15:00"  # 台股盤後資料約 14:00–15:00 釋出，預設收盤後一小時執行
TWSE_CRAWLER_SCRIPT = CRAWLER_DIR / "twse_crawler.py"
CNYES_CRAWLER_SCRIPT = CRAWLER_DIR / "cnyes_crawlwer.py"
INDICATOR_SCRIPT = CRAWLER_DIR / "technical_indicator_job.py"
INSTITUTIONAL_TRADES_SCRIPT = CRAWLER_DIR / "institutional_trades_job.py"
RUN_TECHNICAL_INDICATOR_AFTER_CRAWL = True
RUN_INSTITUTIONAL_TRADES_AFTER_CRAWL = True
RUN_CNYES_NEWS_CRAWL = True
CNYES_INTERVAL_MINUTES = 30


def _python_executable() -> str:
    return sys.executable


def _subprocess_text_encoding() -> str:
    return locale.getpreferredencoding(False) or "utf-8"

def run_crawler_job():
    """
    執行爬蟲作業的核心邏輯
    我們會透過 subprocess 來呼叫你的爬蟲腳本
    """
    log.info("===================================")
    log.info("🚀 開始執行收盤後台股資料爬取作業...")

    script_path = TWSE_CRAWLER_SCRIPT
    python_cmd = _python_executable()

    # 確認爬蟲檔案是否存在
    if not script_path.exists():
        log.error("找不到爬蟲檔案 '%s'。", script_path)
        return

    try:
        # 加上 --batch 參數，關閉所有互動式輸入
        command = [python_cmd, str(script_path), "--batch"]
        output_encoding = _subprocess_text_encoding()
        
        log.info(f"執行指令: {' '.join(command)}")
        
        # 執行指令並等待完成
        result = subprocess.run(
            command,
            capture_output=True, # 捕捉 stdout 和 stderr
            text=True,           # 以字串格式回傳
            encoding=output_encoding,
            errors="replace"     # 遇到非目標編碼字元時避免崩潰
        )

        # 根據回傳碼判斷是否成功 (0 代表成功)
        if result.returncode == 0:
            log.info("✅ 爬取作業順利完成！")
            if RUN_INSTITUTIONAL_TRADES_AFTER_CRAWL:
                run_institutional_trades_job(python_cmd)
            if RUN_TECHNICAL_INDICATOR_AFTER_CRAWL:
                run_indicator_job(python_cmd)
            # 如果想看爬蟲的輸出，可以把下面這行解除註解
            # print(result.stdout)
        else:
            log.error(f"❌ 爬取作業發生錯誤 (Return code: {result.returncode})")
            log.error(f"錯誤訊息：\n{result.stderr}")
            
    except Exception as e:
        log.error(f"執行爬蟲時發生未預期的例外錯誤: {e}")


def run_institutional_trades_job(python_cmd: str) -> None:
    """三大法人 T86：單次執行僅對「一個交易日」發一筆 GET（腳本內保證不連發）。"""
    script_path = INSTITUTIONAL_TRADES_SCRIPT
    if not script_path.exists():
        log.error(f"找不到三大法人腳本 '{script_path}'，略過。")
        return

    try:
        command = [python_cmd, str(script_path)]
        output_encoding = _subprocess_text_encoding()
        log.info("🏛️ 開始抓取三大法人買賣超（單日單請求）...")
        log.info(f"執行指令: {' '.join(command)}")

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding=output_encoding,
            errors="replace",
        )

        if result.returncode == 0:
            log.info("✅ 三大法人資料寫入完成！")
        else:
            log.error(f"❌ 三大法人作業失敗 (Return code: {result.returncode})")
            log.error(f"錯誤訊息：\n{result.stderr}")
    except Exception as e:
        log.error(f"執行三大法人腳本時發生未預期例外: {e}")


def run_indicator_job(python_cmd: str) -> None:
    script_path = INDICATOR_SCRIPT
    if not script_path.exists():
        log.error(f"找不到技術指標腳本 '{script_path}'，略過技術指標計算。")
        return

    try:
        command = [python_cmd, str(script_path)]
        output_encoding = _subprocess_text_encoding()
        log.info("📈 開始計算技術指標...")
        log.info(f"執行指令: {' '.join(command)}")

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding=output_encoding,
            errors="replace",
        )

        if result.returncode == 0:
            log.info("✅ 技術指標計算完成！")
        else:
            log.error(f"❌ 技術指標計算失敗 (Return code: {result.returncode})")
            log.error(f"錯誤訊息：\n{result.stderr}")
    except Exception as e:
        log.error(f"執行技術指標腳本時發生未預期例外: {e}")


def run_cnyes_job() -> None:
    """鉅亨台股新聞：與 cnyes_crawlwer 內 SCHEDULE_LOOKBACK_DAYS 一致，僅增量區間。"""
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
    
    schedule_time = SCHEDULE_TIME

    # 設定每天執行一次
    schedule.every().day.at(schedule_time).do(run_crawler_job)
    log.info(
        "✅ 已設定每天 %s 執行：%s",
        schedule_time,
        TWSE_CRAWLER_SCRIPT.name,
    )
    if RUN_INSTITUTIONAL_TRADES_AFTER_CRAWL:
        log.info("  ↳ 三大法人買賣超：爬蟲成功後自動執行")
    if RUN_TECHNICAL_INDICATOR_AFTER_CRAWL:
        log.info("  ↳ 技術指標計算：爬蟲成功後自動執行")

    if RUN_CNYES_NEWS_CRAWL:
        interval = max(1, CNYES_INTERVAL_MINUTES)
        schedule.every(interval).minutes.do(run_cnyes_job)
        log.info(
            "✅ 已設定每 %s 分鐘執行：%s（--scheduled-once，回溯天數見該腳本 SCHEDULE_LOOKBACK_DAYS）",
            interval,
            CNYES_CRAWLER_SCRIPT.name,
        )

    # ----------------------------------------------------
    # [開發測試用] 
    # 如果你想先測試排程器是否會動，可以暫時解開下一行註解 (每分鐘執行一次)：
    # schedule.every(1).minutes.do(run_crawler_job)
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
