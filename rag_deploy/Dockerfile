FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt fastapi uvicorn

# api_server 執行期會 import 的本地模組（/api/trend_predict、/api/analysis_digest、
# /api/simulate_trading_stream 分別依賴 prediction_core、digest_*、simulate_trading）
COPY api_server.py qa_logger.py \
     prediction_core.py digest_core.py digest_store.py \
     simulate_trading.py backtest_digest_eval.py \
     .env index.html chart_demo.html ./

# qdrant_db, crawler 從外部掛載（太大不放進 image）

EXPOSE 8000

CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
