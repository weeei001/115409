# RAG API 啟動方式

```bash
pip install -r requirements.txt
uvicorn api_server:app --reload --port 8000
```

啟動後開 http://localhost:8000/docs 查看所有 API 文件與測試介面。

## 主要端點

| 方法 | 路徑 | 用途 |
|------|------|------|
| POST | /api/ask | AI 問答（支援 stream） |
| GET | /api/stocks | 股票清單 |
| GET | /api/news?stock_id=2330 | 瀏覽新聞 |
| GET | /api/history | QA 歷史紀錄 |
