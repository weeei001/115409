import time
import schedule
from datetime import datetime
import subprocess
import logging
import os
import locale
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# 設定 Logging
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

# 此處假設你剛才貼上的爬蟲程式存成了 twse_crawler.py
# 若檔名不同，請自行修改
CRAWLER_SCRIPT = os.getenv("CRAWLER_SCRIPT", "twse_crawler.py")
CRAWLER_PYTHON = os.getenv("CRAWLER_PYTHON", "env/Scripts/python.exe")
CRAWLER_SCHEDULE_TIME = os.getenv("CRAWLER_SCHEDULE_TIME", "15:00")
INDICATOR_SCRIPT = os.getenv("INDICATOR_SCRIPT", "technical_indicator_job.py")
INDICATOR_ENABLED = os.getenv("INDICATOR_ENABLED", "true").lower() == "true"
INSTITUTIONAL_TRADES_SCRIPT = os.getenv("INSTITUTIONAL_TRADES_SCRIPT", "institutional_trades_job.py")
INSTITUTIONAL_TRADES_ENABLED = os.getenv("INSTITUTIONAL_TRADES_ENABLED", "false").lower() == "true"


def _resolve_script_path(script_value: str) -> Path:
    script_path = Path(script_value)
    if script_path.is_absolute():
        return script_path

    # 先嘗試目前工作目錄，若不存在再退回 crawler 目錄
    cwd_candidate = Path.cwd() / script_path
    if cwd_candidate.exists():
        return cwd_candidate

    return Path(__file__).resolve().parent / script_path


def _resolve_python_command(python_value: str) -> str:
    python_path = Path(python_value)
    if python_path.is_absolute():
        return str(python_path)

    # 優先視為 backend 根目錄相對路徑（例如 env/Scripts/python.exe）
    backend_candidate = Path(__file__).resolve().parents[1] / python_path
    if backend_candidate.exists():
        return str(backend_candidate)

    # 其次視為目前工作目錄相對路徑
    cwd_candidate = Path.cwd() / python_path
    if cwd_candidate.exists():
        return str(cwd_candidate)

    # 最後才視為系統指令（例如 python）
    return python_value

def run_crawler_job():
    """
    執行爬蟲作業的核心邏輯
    我們會透過 subprocess 來呼叫你的爬蟲腳本
    """
    log.info("===================================")
    log.info("🚀 開始執行收盤後台股資料爬取作業...")
    
    script_path = _resolve_script_path(CRAWLER_SCRIPT)
    python_cmd = _resolve_python_command(CRAWLER_PYTHON)

    # 確認爬蟲檔案是否存在
    if not script_path.exists():
        log.error(f"找不到爬蟲檔案 '{script_path}'，請確認 CRAWLER_SCRIPT 設定。")
        return

    try:
        # 直接執行 python twse_crawler.py
        # 如果你只想抓取「當年」或「本月」資料，可以在這裡加上參數，例如：
        # ["python", CRAWLER_SCRIPT, "--years", "0"] (假設改用年份 0 代表今年)
        # 加上 --batch 參數，關閉所有互動式輸入
        command = [python_cmd, str(script_path), "--batch"]
        output_encoding = os.getenv("CRAWLER_OUTPUT_ENCODING") or locale.getpreferredencoding(False) or "utf-8"
        
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
            if INSTITUTIONAL_TRADES_ENABLED:
                run_institutional_trades_job(python_cmd)
            if INDICATOR_ENABLED:
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
    script_path = _resolve_script_path(INSTITUTIONAL_TRADES_SCRIPT)
    if not script_path.exists():
        log.error(f"找不到三大法人腳本 '{script_path}'，略過。")
        return

    try:
        command = [python_cmd, str(script_path)]
        output_encoding = os.getenv("CRAWLER_OUTPUT_ENCODING") or locale.getpreferredencoding(False) or "utf-8"
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
    script_path = _resolve_script_path(INDICATOR_SCRIPT)
    if not script_path.exists():
        log.error(f"找不到技術指標腳本 '{script_path}'，略過技術指標計算。")
        return

    try:
        command = [python_cmd, str(script_path)]
        output_encoding = os.getenv("CRAWLER_OUTPUT_ENCODING") or locale.getpreferredencoding(False) or "utf-8"
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

def main():
    """
    排程器主程式
    """
    log.info("🕒 啟動台股爬蟲排程器...")
    
    # 台灣股市大約 13:30 收盤，證交所盤後資料大約在 14:00 到 15:00 之間陸續更新完畢。
    # 建議保險起見，設定在 15:00 執行。
    schedule_time = CRAWLER_SCHEDULE_TIME
    
    # 設定每天執行一次
    schedule.every().day.at(schedule_time).do(run_crawler_job)
    log.info(f"✅ 已設定每天 {schedule_time} 定期執行爬蟲腳本 ({CRAWLER_SCRIPT})")

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
