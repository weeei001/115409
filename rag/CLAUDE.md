# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案簡介
針對 6 檔台股（2330 台積電、2317 鴻海、2454 聯發科、2881 富邦金、2408 南亞、2615 萬海）的財經新聞 RAG 系統。

## 執行指令

```bash
# 啟動 Streamlit UI（主要入口）
streamlit run viewer.py

# 啟動 FastAPI 後端（供前端串接）
cd rag_deploy && uvicorn api_server:app --host 0.0.0.0 --port 8000

# 前端測試頁面
cd rag_deploy && python -m http.server 3000
# 開啟 http://localhost:3000/index.html

# 完整資料管線（依序執行）
python ingest_sources.py       # 1. 攝入 CSV + OtherNewWeb → news_db_local/
python run_chunking.py         # 2. 切塊 → news_db_local/*/chunks/*.json
python build_vector_db.py      # 3. 向量化 → qdrant_db/（有 Tkinter GUI）

# 個別爬蟲
python crawler_gui.py          # cnyes 爬蟲（Streamlit GUI）
python crawler_ltn_gui.py      # LTN Phase 1+2 爬蟲（Tkinter GUI）
python crawler_ltn_history_gui.py  # LTN Phase 3 歷史 ID 掃描
```

## 架構與資料流

```
crawler/*.csv + OtherNewWeb/**/*.txt/csv
    → ingest_sources.py
        → NewsStorageManager（news_storage.py）
        → news_db_local/index.json          # 所有文章的 metadata 索引（常駐記憶體）
        → news_db_local/{source}/content/   # 全文 .txt（依來源分資料夾）
    → run_chunking.py（RecursiveCharacterTextSplitter, chunk=400, overlap=50）
        → news_db_local/{source}/chunks/*_chunks.json
    → build_vector_db.py（MAX_WORKERS=4，Tkinter 進度 GUI）
        → NVIDIA NVIDIAEmbeddings（nvidia/nv-embedqa-e5-v5, 1024-dim）
        → qdrant_db/（Qdrant local，collection=news_chunks）
    → viewer.py（Streamlit）/ api_server.py（FastAPI）
        → AI Intent Classifier（meta/llama3-70b-instruct）
            → 回傳 JSON：{is_finance, stocks[], time_from, time_to}
            → fallback: regex 股票偵測 + extract_time_filter()
        → Qdrant query_points + stock_id Filter
        → 時間加權排序（範圍內 ★ 優先，指定時間之後的資料排除）
        → 分析 LLM（meta/llama-3.3-70b-instruct via OpenAI SDK）
        → qa_logger.py → qa_logs.db（SQLite）
```

## API 服務（rag_deploy/）

獨立部署資料夾，供前端串接。

| 方法 | 路徑 | 功能 |
|------|------|------|
| POST | `/api/ask` | AI 問答（支援 SSE stream） |
| GET | `/api/stocks` | 股票清單 |
| GET | `/api/history` | 歷史 QA 紀錄 |
| GET | `/api/history/{id}` | 單筆 QA 詳情 |
| GET | `/api/news` | 瀏覽新聞列表 |
| GET | `/api/health` | 健康檢查 |

**對外服務**：透過 Cloudflare Tunnel（Docker cloudflared）公開至 `ragggggggg.bobhsu.dpdns.org`

**時間處理邏輯**：
- AI Intent Classifier 一次回傳意圖 + 股票 + 時間範圍（JSON），regex 作為 fallback
- 時間作為加權排序而非硬過濾：範圍內新聞標 ★ 優先，範圍外保留當背景
- 有指定時間點時，過濾掉之後的資料（不用未來資料分析過去）
- `pub_time` 格式為 ISO（`2024-05-01T12:00:00+08:00`），比較前需 `normalize_time()` 轉換

## 關鍵設定

| 參數 | 值 |
|------|-----|
| Embedding | `nvidia/nv-embedqa-e5-v5`（1024 維）|
| Intent Classifier | `meta/llama3-70b-instruct`（ChatNVIDIA / LangChain）|
| 分析 LLM | `meta/llama-3.3-70b-instruct`（OpenAI SDK 呼叫 NVIDIA NIM）|
| Qdrant collection | `news_chunks`，路徑 `./qdrant_db/` |
| Chunk 大小 | 400 字，overlap 50 |
| RAG 檢索數量 | limit=10 |
| 向量化並行度 | MAX_WORKERS=4 |
| API Key 位置 | `.env` → `NVIDIA_API_KEY` |

## 模組說明

- **`news_storage.py` / `NewsStorageManager`**：本地新聞 DB 核心。index.json 常駐記憶體，全文依 source 分資料夾存 .txt。`_source_group()` 將非媒體來源（CMoney 作者帳號）統一歸入 `cmoney/` 資料夾。
- **`ingest_sources.py`**：讀取 `crawler/*.csv`（CMoney）與 `OtherNewWeb/` 媒體爬蟲輸出，透過 `NewsStorageManager.add_news()` 去重後寫入。股票代號從檔名或內容 regex 提取（找不到時 fallback 為 `tw_stock`）。
- **`run_chunking.py`**：使用中文優先 separators（`\n\n`, `\n`, `。`, `！`, `？`）的 `RecursiveCharacterTextSplitter`。
- **`build_vector_db.py`**：有 Tkinter GUI 顯示進度。先掃描已存在的 chunk ID 跳過重複向量化（斷點續傳）。
- **`viewer.py`**：三層 stock_id 決策（手動選 > 自動偵測單股 > 自動偵測多股 OR filter）。`@st.cache_resource` 快取 Qdrant client 與 LLM 物件。
- **`clean_news.py`** / **`clean_ltn.py`**：各來源清洗邏輯。`NewsStorageManager.clean_text()` 整合了 bottom_keywords 截斷、廣告移除。
- **`adapters/`**：`BaseAdapter` + `YahooAdapter`，設計為可擴充的爬蟲輸出格式轉換層。
- **`qa_logger.py`**：寫入 `qa_logs.db`，記錄 query、完整 prompt、chunks_json、LLM 回答、token 用量（input/output/thinking）、duration_ms。

## Qdrant Payload 欄位
`page_content`, `chunk_id`（`{article_id}_{i}`）, `stock_id`, `title`, `source`, `pub_time`, `url`, `tags`

## source 欄位對應
`cnyes`→鉅亨網、`ltn`→自由時報、`moneydj`→MoneyDJ、`udn`→聯合新聞網、`chinatimes`→中時新聞網、`yahoo`→Yahoo 財經、CMoney 作者帳號（tpshouse, firebro, lewis, newsyoudeservetoknow 等）→ CMoney 財經社群

## 常見問題與限制

- **Qdrant 鎖定**：`qdrant_db/` 同時只能一個 QdrantClient，執行 `build_vector_db.py` 前必須先停止 Streamlit
- **重新建庫**：`rm -rf qdrant_db/` 再執行 `build_vector_db.py`
- **NVIDIA NIM 限制**：免費方案 40 rpm。`stream=True` 部分模型會 `incomplete chunked read`，一律用 `stream=False`
- **DeepSeek R1**：`deepseek-r1-distill-qwen-7b/14b` 在 NVIDIA NIM 有 GPU 500 錯誤；`deepseek-r1` 已下架（410），勿使用
- **stock_id 品質**：`OtherNewWeb/` 來源的股票代號由 regex 從標題/標籤提取，有時會落入 `tw_stock`，影響 filter 精準度
- **無效 chunk**：部分 chunk 為廣告導流文字（如「點我訂購」），已在 `clean_text()` 部分處理但未完全清除
