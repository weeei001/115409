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

## 規劃中:架構拆分(本地 Qdrant + 異地遠端後端)

決策日期 2026-05-25。完整計畫:`~/.claude/plans/server-swift-zephyr.md`。

**目標**:Qdrant 向量庫 + 爬蟲排程留本地;FastAPI api_server + MySQL 搬到異地遠端 server,透過網址跨網查本地 Qdrant。

**已確認決策**:
- 暴露方式:**Cloudflare Tunnel + Qdrant API Key**(沿用現有 cloudflared,新增 `qdrant.bobhsu.dpdns.org` hostname)。
- MySQL **跟後端一起搬遠端**(同機內網,不再暴露第二個服務)。
- 維持 Docker 部署,拆成兩份 `docker-compose.yml`(本地版/遠端版)。
- 排程器 `backend/crawler/scheduler_utils.py` 與 `build_vector_db.py` 仍**在本地主機裸跑**(非容器),透過 `127.0.0.1:6333` 寫入 qdrant 容器。

**關鍵程式碼改動**(僅一處查詢端必改):
- `rag_deploy/api_server.py` 行 260-269:`QdrantClient` 須帶 `api_key` + `url="https://..."` + `prefer_grpc=False`(gRPC over Cloudflare 不可靠)。
- 開 API Key 後,本地寫入腳本須加 `api_key=`:`crawl_to_qdrant.py:103`、`build_vector_db.py:287`。

**結構性弱點**(知悉即可):家用機當向量庫伺服器 = 單點故障在你家(停電/斷網/IP 變動會讓問答服務掛掉)。每次查詢多 30–120ms 跨網延遲。適合 demo / 個人專案,不適合高可用正式服務;長期正解是把 Qdrant 也上雲。

## 爬蟲排程部署（launchd 常駐）

決策日期 2026-07-05~08。背景：爬蟲曾在 2026-03-31 後完全停跑 3 個多月無人發現（RAG 檢索因此撈到大量舊聞），根因是排程器只能人工手動啟動、當掉或重開機後沒有任何自動恢復機制。

**現況**：
- `backend/crawler/scheduler_utils.py` 已透過 macOS launchd 常駐執行（`~/Library/LaunchAgents/com.rag.scheduler.plist`），`KeepAlive=true`（當掉自動重啟）+ `RunAtLoad=true`（開機/登入自動啟動）。
- 排程內容：每天 15:00 跑 TWSE 股價（`run_crawler_job`）；每 30 分鐘跑 cnyes 新聞（`run_cnyes_job`）；每 30 分鐘跑 LTN 新聞（`run_ltn_job`，新增）。
- log 輸出：`backend/crawler/scheduler.out.log` / `scheduler.err.log`（新增，先前完全沒有 log 檔）。
- 心跳機制：三個 job 每次成功跑完都會寫入 `backend/crawler/.last_run`（新增），可用來判斷排程器是否還活著。
- 手動管理指令：`launchctl load/unload ~/Library/LaunchAgents/com.rag.scheduler.plist`。

**LTN 爬蟲已 headless 化**：
- `rag/crawler_ltn_gui.py` 新增 `--scheduled-once` CLI 入口（`python crawler_ltn_gui.py --scheduled-once`），只跑 Phase 1（近期列表）+ Phase 2（抓全文）的增量抓取，不含 Phase 3 歷史 ID 回填。原本的 Tkinter GUI 完全保留、未受影響。
- Phase 3（`_phase3_scan`，ID 範圍歷史回填）與 `crawler_ltn_history_gui.py` 刻意不排入日常排程，仍需手動觸發（一次性/大範圍回補時用）。
- 排程呼叫時會固定 `cwd` 為 `rag/`，因為 `NEWS_DB_PATH` 是相對路徑。

**已知限制**：
- moneydj / udn / chinatimes / yahoo / CMoney 這 5 個來源目前仍**沒有**排入自動排程（本專案內完全沒有對應的爬蟲程式碼，或只是靜態檔案 adapter），仍依賴外部工具/手動匯入，現況待另外評估。
- ltn 抓取的並行度設定（`SCAN_WORKERS=50`、`WORKERS=6`、`API_WORKERS=5`）是唯一的防封鎖節流手段，沒有顯式 sleep；長期無人值守運作時應留意是否觸發對方網站速率限制。

## 常見問題與限制

- **Qdrant 鎖定**：`qdrant_db/` 同時只能一個 QdrantClient，執行 `build_vector_db.py` 前必須先停止 Streamlit
- **重新建庫**：`rm -rf qdrant_db/` 再執行 `build_vector_db.py`
- **NVIDIA NIM 限制**：免費方案 40 rpm。`stream=True` 部分模型會 `incomplete chunked read`，一律用 `stream=False`
- **DeepSeek R1**：`deepseek-r1-distill-qwen-7b/14b` 在 NVIDIA NIM 有 GPU 500 錯誤；`deepseek-r1` 已下架（410），勿使用
- **stock_id 品質**：`OtherNewWeb/` 來源的股票代號由 regex 從標題/標籤提取，有時會落入 `tw_stock`，影響 filter 精準度
- **無效 chunk**：部分 chunk 為廣告導流文字（如「點我訂購」），已在 `clean_text()` 部分處理但未完全清除
- **排程器健康檢查**：若懷疑排程沒在跑，先看 `backend/crawler/.last_run` 心跳檔的時間戳，再用 `launchctl list | grep com.rag.scheduler` 確認 process 存在
