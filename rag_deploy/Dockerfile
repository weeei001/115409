FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt fastapi uvicorn

COPY api_server.py qa_logger.py .env index.html chart_demo.html ./

# qdrant_db, crawler 從外部掛載（太大不放進 image）

EXPOSE 8000

CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
