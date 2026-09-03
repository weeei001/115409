# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案簡介
針對 6 檔台股（2330 台積電、2317 鴻海、2454 聯發科、2881 富邦金、2408 南亞、2615 萬海）的財經新聞 RAG 系統，整合股價走勢圖與 AI 問答。多人協作專案（見 README.md「開發者」一節）：`rag/` 由 wei 負責、`frontend/` + AI 顧問由 Victor 負責、`backend/`（FastAPI + MySQL 股價 API，獨立系統）由另一位開發者負責、Docker 部署與 RAG API 整合（`rag_deploy/`）由 bob（此帳號）負責。**本檔案內容聚焦 bob 負責的範圍（`rag_deploy/`、`rag/` 資料管線、Docker 部署），`backend/` 不屬於此範圍，除非明確被要求，否則不應修改。**

## ⚠️ 目錄結構重要說明（容易混淆之處）

- **`rag/`**：資料處理 pipeline 原始碼（爬蟲 → 清洗 → 切塊 → 向量化），排程器實際會呼叫這裡的腳本（見下方「爬蟲排程部署」）。**這裡的程式碼是現役、會被執行的**，不是舊版。
- **`rag_deploy/`**：只有 API 服務層（`api_server.py` FastAPI + `qa_logger.py`），消費 `rag/` pipeline 產出的 Qdrant 向量庫，是實際對外服務的部署單位（`docker-compose.yml` 的 `build: ./rag_deploy`）。
- repo 根目錄也有 `build_vector_db.py`、`crawl_to_qdrant.py` 等腳本，是 `rag/` 底下同名腳本的**獨立副本**（曾發生兩邊各自修改、需要手動同步的情況——修改向量化/爬蟲邏輯時，記得確認是否也要同步另一份）。
- `backend/` 是獨立的 FastAPI + MySQL 股價 API 系統，有自己的 `README.md`/`API_DOCS.md`、`.env`、依賴。**2026-08 資料庫整合後，`backend/` 與 `rag_deploy/` 已共用同一個 MySQL 資料庫 `topic_stock`**（原本 `rag_deploy/` 用的是獨立的 `rag_logs`，已合併）；`rag_deploy/` 的表（`news_articles`/`news_chunks`/`qa_logs`/`analysis_digests`）與 `backend/` 的表（股價、`rag_users`/`rag_user_views` 等）同庫不同表，**修改時仍需注意各自的表結構與寫入路徑互不相通，勿假設 schema 相容**。
- 若看到 `rag/` 底下巢狀出現另一份 `rag_deploy/`，那是舊快照（已於 2026-07 清理過一次），不應再出現；若重新出現代表有人誤操作，應確認後刪除。

## 執行指令

```bash
# 啟動 Streamlit UI（rag/ 底下，本地開發用）
cd rag && streamlit run viewer.py

# 啟動 FastAPI 後端（rag_deploy/，供前端串接，對外服務走這個）
cd rag_deploy && uvicorn api_server:app --host 0.0.0.0 --port 8000

# 前端測試頁面
cd rag_deploy && python -m http.server 3000
# 開啟 http://localhost:3000/index.html

# 完整資料管線（於 rag/ 目錄下依序執行，寫入 MySQL topic_stock，見下方「新聞儲存」）
cd rag
python ingest_sources.py       # 1. 攝入 CSV + OtherNewWeb → MySQL news_articles 表
python run_chunking.py         # 2. 切塊（斷點續傳）→ MySQL news_chunks 表
python build_vector_db.py      # 3. 向量化 → qdrant_db/（有 Tkinter GUI，headless 版見 build_vector_db_headless.py）

# 個別爬蟲（於 rag/ 目錄下）
python crawler_gui.py          # cnyes 爬蟲（Streamlit GUI）
python crawler_ltn_gui.py      # LTN Phase 1+2 爬蟲（Tkinter GUI）
python crawler_ltn_gui.py --scheduled-once  # LTN 排程用 headless 模式（不開 GUI，供 scheduler_utils.py 呼叫）
python crawler_ltn_history_gui.py  # LTN Phase 3 歷史 ID 掃描（手動觸發，不排入日常排程）

# 股價回測 / AI 預測準確率驗證（digest A/B 對照，rag_deploy/backtest_digest_eval.py）
cd rag_deploy && python backtest_digest_eval.py --stock 2330 --period week --start 2024-01-01 --end 2024-12-31 --horizon 5
```

## 架構與資料流

```
crawler/*.csv + OtherNewWeb/**/*.txt/csv
    → ingest_sources.py
        → NewsStorageManagerMySQL（news_storage_mysql.py）
        → MySQL topic_stock.news_articles（含全文 content 欄位，article_id 為 PK 去重）
    → run_chunking.py（RecursiveCharacterTextSplitter, chunk=400, overlap=50）
        → chunk_storage_mysql.py → MySQL topic_stock.news_chunks（斷點續傳：以 article_id 判斷是否已切過塊）
    → build_vector_db.py（MAX_WORKERS=4，Tkinter 進度 GUI；headless 版見 build_vector_db_headless.py）
        → 從 news_chunks 表讀取（chunk_storage_mysql.iter_chunks_grouped_by_stock）
        → NVIDIA NVIDIAEmbeddings（nvidia/nemotron-3-embed-1b, 2048-dim；2026-09-02 起，見下方「Embedding 模型變更」）
        → qdrant_db/（Qdrant local，collection=news_chunks，斷點續傳：以 chunk_id 判斷是否已向量化）
    → viewer.py（Streamlit）/ api_server.py（FastAPI）
        → AI Intent Classifier（meta/llama3-70b-instruct）
            → 回傳 JSON：{is_finance, stocks[], time_from, time_to}
            → fallback: regex 股票偵測 + extract_time_filter()
        → Qdrant query_points + stock_id Filter
        → 時間加權排序（範圍內 ★ 優先，指定時間之後的資料排除）
        → 分析 LLM（meta/llama-3.3-70b-instruct via OpenAI SDK）
        → qa_logger.py → MySQL topic_stock.qa_logs
```

**注意**：`viewer.py` Tab2 與 `api_server.py` 的 `/api/news` 目前仍直接讀 `crawler/*.csv`，尚未改接 `news_articles` 表（見下方「新聞儲存」）。

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
| GET | `/api/trend_predict` | 股價走勢 AI 預測（迴歸線 + 新聞情緒，未來 20 交易日） |
| GET | `/api/trend_predict_stream` | 同上，SSE 逐週推送版本 |

**對外服務**：透過 Cloudflare Tunnel（Docker cloudflared）公開至 `ragggggggg.bobhsu.dpdns.org`

**時間處理邏輯**：
- AI Intent Classifier 一次回傳意圖 + 股票 + 時間範圍（JSON），regex 作為 fallback
- 時間作為加權排序而非硬過濾：範圍內新聞標 ★ 優先，範圍外保留當背景
- 有指定時間點時，過濾掉之後的資料（不用未來資料分析過去）
- `pub_time` 格式為 ISO（`2024-05-01T12:00:00+08:00`），比較前需 `normalize_time()` 轉換
- Qdrant payload 另有數值型 `pub_ts`（Unix timestamp）欄位，供未來改用 Range filter 做數值區間查詢（目前 `/api/ask` 仍是撈出後字串比對，尚未改用 `pub_ts` 篩選）

**股價走勢預測（`prediction_core.py`）**：
- `get_trend_predict`/`trend_predict_stream` 的核心邏輯（加權線性迴歸、動能+均值回歸曲線、prompt 組裝、LLM 呼叫與 JSON 解析）已抽出至 `rag_deploy/prediction_core.py`，供未來的歷史回測腳本（`rag_deploy/backtest/`，開發中）共用同一套預測邏輯，避免即時預測與回測各寫一份。
- 兩個端點目前皆為**即時查詢**：股價即時打 `yfinance`（未存檔）、新聞即時查 Qdrant 最近 30 天，預測結果**不落地**（無資料庫記錄），因此無法回頭驗證預測準確率——這是 `rag_deploy/backtest/` 想補上的部分。

## 關鍵設定

| 參數 | 值 |
|------|-----|
| Embedding | `nvidia/nemotron-3-embed-1b`（2048 維，2026-09-02 起，見下方「Embedding 模型變更」）|
| Intent Classifier | `meta/llama3-70b-instruct`（ChatNVIDIA / LangChain）|
| 分析 LLM | `meta/llama-3.3-70b-instruct`（OpenAI SDK 呼叫 NVIDIA NIM）|
| Qdrant collection | `news_chunks`，路徑 `./qdrant_db/` |
| Chunk 大小 | 400 字，overlap 50 |
| RAG 檢索數量 | limit=10 |
| 向量化並行度 | MAX_WORKERS=4 |
| API Key 位置 | `.env` → `NVIDIA_API_KEY` |

## 模組說明

- **`news_storage_mysql.py` / `NewsStorageManagerMySQL`**：新聞儲存現役實作，讀寫 MySQL `topic_stock.news_articles`（含全文 `content` 欄位）。`add_news()` 以 `article_id = md5(f"{source}_{title}_{pub_time}")` 去重（PK 唯一鍵）。`_source_group()` 將非媒體來源（CMoney 作者帳號）統一歸為 `cmoney`。
- **`chunk_storage_mysql.py`**：切塊資料存取層，讀寫 `topic_stock.news_chunks`。`get_chunked_article_ids()` 供 `run_chunking.py` 判斷斷點續傳；`iter_chunks_grouped_by_stock()` 供 `build_vector_db.py` 依股票分組讀取。
- **`news_storage.py` / `NewsStorageManager`**（舊版，已停用）：檔案系統版本，index.json + 依 source 分資料夾存 .txt。2026-07 已改為 MySQL 驅動，此檔僅保留供參考，不應再作為寫入路徑使用。
- **`migrate_news_to_mysql.py`**：一次性遷移腳本，將舊檔案系統版 `news_db_filtered/` 匯入 MySQL 新表。僅在需要重新遷移舊資料時使用，日常 pipeline 不會呼叫它。
- **`ingest_sources.py`**：讀取 `crawler/*.csv`（CMoney）與 `OtherNewWeb/` 媒體爬蟲輸出，透過 `NewsStorageManagerMySQL.add_news()` 去重後寫入 MySQL。股票代號從檔名或內容 regex 提取（找不到時 fallback 為 `tw_stock`）。
- **`run_chunking.py`**：使用中文優先 separators（`\n\n`, `\n`, `。`, `！`, `？`）的 `RecursiveCharacterTextSplitter`，只處理 `news_chunks` 表裡尚無資料的 `article_id`（斷點續傳）。
- **`build_vector_db.py`**：有 Tkinter GUI 顯示進度，從 MySQL `news_chunks` 表讀取。先掃描 Qdrant 已存在的 chunk_id 跳過重複向量化（斷點續傳）。`build_vector_db_headless.py` 為無 GUI 純終端機版本，邏輯相同，僅將 Qdrant 寫入集中在主執行緒（local/SQLite-backed QdrantClient 不支援跨執行緒操作）。
- **`viewer.py`**：三層 stock_id 決策（手動選 > 自動偵測單股 > 自動偵測多股 OR filter）。`@st.cache_resource` 快取 Qdrant client 與 LLM 物件。目前 Tab2 新聞瀏覽仍讀 `crawler/*.csv`，未接 MySQL。
- **`clean_news.py`** / **`clean_ltn.py`**：各來源清洗邏輯，產出 `*_cleaned.csv` 供 `ingest_sources.py` 讀取。`clean_ltn.py` 目前僅能手動執行，**未排入自動排程**（見下方「爬蟲排程部署」的已知落差）。
- **`adapters/`**：`BaseAdapter` + `YahooAdapter`，設計為可擴充的爬蟲輸出格式轉換層。
- **`qa_logger.py`**：寫入 MySQL `topic_stock.qa_logs`，記錄 query、完整 prompt、chunks_json、LLM 回答、token 用量（input/output/thinking）、duration_ms。

## Qdrant Payload 欄位
`page_content`, `chunk_id`（`{article_id}_{i}`）, `stock_id`, `title`, `source`, `pub_time`, `url`, `tags`

## source 欄位對應
`cnyes`→鉅亨網、`ltn`→自由時報、`moneydj`→MoneyDJ、`udn`→聯合新聞網、`chinatimes`→中時新聞網、`yahoo`→Yahoo 財經、CMoney 作者帳號（tpshouse, firebro, lewis, newsyoudeservetoknow 等）→ CMoney 財經社群

## 新聞儲存架構：檔案系統 → MySQL（2026-07-17 完成）

背景：原本新聞原文與切塊資料存在檔案系統（`news_db_filtered/index.json` + 依 source 分資料夾的 `.txt`/`chunks/*.json`），難以核對「資料是否同步、最新到什麼時候」，且與 `qa_logs` 已使用 MySQL 的做法不一致。已改為統一由 MySQL `topic_stock` 資料庫驅動。

**新表結構**（`topic_stock` 資料庫，與 `qa_logs` 表同一個 DB）：
- `news_articles`：`article_id`(PK) / `source` / `source_group` / `stock_id` / `title` / `pub_time` / `url` / `tags` / `content`(LONGTEXT，含全文)
- `news_chunks`：`chunk_id`(PK，格式 `{article_id}_{i}`) / `article_id` / `stock_id` / `source` / `pub_time` / `title` / `url` / `tags` / `content_chunk`

**MySQL 對主機開放**：`docker-compose.yml` 的 `mysql` service 新增 `ports: 127.0.0.1:3306:3306`（僅綁 localhost），因為 `ingest_sources.py`/`run_chunking.py` 等排程腳本在主機裸跑（非容器內執行），原本只有 `expose: 3306`（僅 Docker 內部網路可見）連不到。

**已遷移**：舊 `news_db_filtered/`（10,913 篇文章、11,461 個 chunk）已透過 `migrate_news_to_mysql.py` 一次性匯入，資料未遺漏。

**尚未涵蓋的範圍**（本次改動刻意只涵蓋 `rag/` pipeline 與排程實際用到的腳本）：
- `viewer.py` Tab2、`api_server.py` 的 `/api/news` 仍讀 `crawler/*.csv`，未改接 `news_articles` 表
- `evaluate_news_quality.py` 仍讀舊檔案系統路徑
- 舊 `news_storage.py`（檔案系統版）與 `news_db_filtered/` 目錄未刪除，僅停用寫入路徑，供備查/回滾

**注意**：`export_news_to_sql.py`（一次性匯出 `.sql` 檔案給外部同事用的工具）已隨此次改動過時，其產出的 `news_articles.sql`/`news_chunks.sql` 不進版控。

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

## Embedding 模型變更（2026-09-02）

背景：`nvidia/nv-embedqa-e5-v5`（1024 維）於 2026-09-02 前後在 NVIDIA NIM 端下架（410 Gone），RAG 檢索完全無法使用。官方公告的替代模型 `nvidia/llama-3.2-nv-embedqa-1b-v2` 實測**也已下架**（410，EOL 2026-05-18，早於公告文件記載）；實際查詢帳號 `/v1/models` 清單並逐一實測後，僅 `nvidia/nemotron-3-embed-1b` 可正常呼叫，已改用此模型。

**關鍵差異**：新模型固定輸出 **2048 維**（不支援 `dimensions` 參數指定 1024），與舊向量庫的 1024 維不相容，**無法沿用舊向量、必須重建整個 Qdrant collection**。

**已完成**：
- 7 個呼叫點已改為 `NVIDIAEmbeddings(model="nvidia/nemotron-3-embed-1b")`（無 `dimensions` 參數）：`crawl_to_qdrant.py`、`rag_deploy/build_analysis_digests.py`、`rag_deploy/api_server.py`、`rag/build_vector_db.py`（2 處）、`rag/build_vector_db_headless.py`、`rag/viewer.py`。建 collection 時 vector size 皆用 `len(vectors[0])` 動態取得，未寫死 1024，故程式碼本身無需再改。
- 舊向量庫已備份為 `qdrant_db_old_e5v5/`（1024 維，未刪除，供備查/回滾），`qdrant_db/` 已重建為新 2048 維 collection。
- 新增一次性腳本 `rag/build_vector_db_2025plus.py`：僅向量化 `pub_time >= 2025-01-01` 的 chunk（12,208 筆，已於當日跑完，0 失敗），用於應急恢復服務，避免等全量 14,000+ 筆跑完才能上線。

**尚未完成**：
- **2025 年以前的歷史 chunk（約 3,157 筆）尚未補向量化**，目前 `qdrant_db/` 檢索範圍僅 2025-01-01 起。需要補齊時執行 `cd rag && python build_vector_db_headless.py`（全量掃描，靠 `existing_ids` 斷點續傳，不會重複算 2025+ 已做過的部分）。
- CLAUDE.md 各處「關鍵設定」「架構與資料流」已同步更新為新模型/新維度；`rag_deploy/simulate_trading.py` 內仍留有舊的「e5-v5 已下架」說明文字（`fetch_pit_articles()` 附近），待該功能重新啟用語意檢索時應一併更新措辭。

## 常見問題與限制

- **Qdrant 鎖定**：`qdrant_db/` 同時只能一個 QdrantClient，執行 `build_vector_db.py` 前必須先停止 Streamlit
- **重新建庫**：`rm -rf qdrant_db/` 再執行 `build_vector_db.py`
- **NVIDIA NIM 限制**：免費方案 40 rpm。`stream=True` 部分模型會 `incomplete chunked read`，一律用 `stream=False`
- **DeepSeek R1**：`deepseek-r1-distill-qwen-7b/14b` 在 NVIDIA NIM 有 GPU 500 錯誤；`deepseek-r1` 已下架（410），勿使用
- **stock_id 品質**：`OtherNewWeb/` 來源的股票代號由 regex 從標題/標籤提取，有時會落入 `tw_stock`，影響 filter 精準度
- **無效 chunk**：部分 chunk 為廣告導流文字（如「點我訂購」），已在 `clean_text()` 部分處理但未完全清除
- **排程器健康檢查**：若懷疑排程沒在跑，先看 `backend/crawler/.last_run` 心跳檔的時間戳，再用 `launchctl list | grep com.rag.scheduler` 確認 process 存在（注意：目前程式碼中實際上找不到寫入 `.last_run` 的邏輯，此心跳機制可能已失效，判斷排程存活仍應優先看 `scheduler.err.log` 的時間戳）
- **`build_vector_db.py` 的 Tkinter 崩潰**：若執行時直接印出 `macOS XX required, have instead YY` 並中止，是系統內建 Python（如 CommandLineTools 版）綁定的 Tcl/Tk 版本過舊、無法辨識新版 macOS 版本號所致，非程式碼問題。可改用 `build_vector_db_headless.py`（無 GUI 純終端機版本，邏輯相同）繞過，或改用有裝新版 Tcl/Tk 的 Python。
- **`.env` 與 `rag_deploy/.env` 可能不同步**：`NVIDIA_API_KEY` 等金鑰曾只存在 `rag_deploy/.env` 而根目錄 `.env` 沒有，導致在根目錄執行 `build_vector_db.py`/`build_vector_db_headless.py` 時 embedding API 回傳 401。兩份 `.env` 目前需手動保持同步。
- **MySQL 連線環境變數**：`news_storage_mysql.py`/`chunk_storage_mysql.py`/`qa_logger.py` 預設讀 `MYSQL_HOST`（預設 `127.0.0.1`，容器內則需設為 `mysql`）、`MYSQL_PORT`（預設 `3306`）、`MYSQL_USER`（預設 `rag`）、`MYSQL_PASSWORD`、`MYSQL_DATABASE`（預設 `topic_stock`）。主機裸跑腳本需確保 `docker-compose.yml` 的 `mysql` service 有映射 `127.0.0.1:3306:3306`，否則連線會被拒絕。
