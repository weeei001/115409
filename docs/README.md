# 開發與操作文件

安裝與啟動見 [根目錄 README](../README.md)，代理協作指引見 [AGENTS.md](../AGENTS.md)。此處保留架構背景、操作流程與文件來源。

## 後端邊界

| 層級 | 責任 |
| --- | --- |
| `app/main.py` | 建立 FastAPI、掛載 router，透過 lifespan 管理 HTTP client 與資料庫 engine |
| `features/*/router.py` | HTTP 輸入、回應、驗證、依賴注入與串流 headers |
| `features/*/service.py` | 協調使用案例、業務判斷與交易 |
| `features/*/repository.py` | 查詢與資料持久化操作，不自行 commit／rollback |
| `app/clients/` | LLM、向量、郵件與其他外部服務介接 |
| `app/db/` | 連線、session 與資料表定義 |
| `app/jobs/` | 匯入、排程與研究工作；FastAPI lifespan 管理後台排程器 |

API 與 worker 共用 feature／db 層；只有 `app/main.py` 的 lifespan 載入 `app.jobs.runtime` 管理排程，feature／client 不反向依賴 jobs。`features/retrieval/chunking.py` 提供新聞切段，`features/news/sentiment.py` 提供股票辨識，`db/models/news_chunk.py` 保留獨立 metadata。API 啟動不建立資料表。後台設定與授權見[管理後台](admin.md)。

`core/streaming.py` 統一 SSE 編碼與來源 iterator 關閉；各 router 保留自己的 headers 與數值序列化政策。架構邊界與串流行為的可執行檢查分別位於 [test_architecture.py](../backend/tests/test_architecture.py) 與 [test_streaming.py](../backend/tests/test_streaming.py)。

這些是本專案的設計選擇。FastAPI 官方提供 [APIRouter 與依賴組合](https://fastapi.tiangolo.com/tutorial/bigger-applications/)及 [lifespan](https://fastapi.tiangolo.com/advanced/events/) 機制，並未要求每個專案都新增 service、repository 或抽象基底。

## 首次初始化

先建立目標 MySQL 資料庫並配置該環境的連線；從 `backend/` 執行：

```powershell
python -m app.jobs init-schema --sync-catalog
```

此命令建立缺少的 27 張現行資料表，包含獨立 metadata 的 `news_chunks`、三張新聞版本表與四張後台管理表。新 MySQL 表使用 InnoDB／utf8mb4。命令不清除資料、不修改既有表結構、不建立資料庫，也不建立舊 `news_sentiments` 或 `analysis_digests` 表。既有表需要升級時仍使用對應遷移，不能以重跑初始化代替。`--help` 與不支援的參數不會連線。

`--sync-catalog` 會重新取得 TWSE／TPEx 官方全市場公司目錄、儲存該環境的公司目錄快取，再將下列 40 檔同步到 `stock_info`。省略此旗標只建立資料表；不建立預設使用者，不呼叫 embedding 或 LLM。官方目錄失敗或缺少指定公司時命令失敗，已建立的資料表保留，可重跑。

啟動 scheduler 前還須取得首批行情與新聞，並明確建立向量集合。既有 `market-fetch` 的多數資料是當日快照，`--start` 不代表補齊歷史；歷史價格使用 `market-backfill`。抓取新聞後，首次索引使用 `news-ingest --create-collection`，須設定明確的 `NEWS_INDEX_VERSION`、非 legacy 的 `QDRANT_COLLECTION` 與 `EMBED_TRUNCATE=NONE`。集合會在第一批有效 embedding 寫入時建立；完全沒有新聞時不會產生空集合。這些抓取、向量化與分析工作應依部署所需的期間及模型預算執行。

空庫不能直接以 scheduler 完成初始化：行情工作依賴 `stock_info`，正常索引不自動建立集合。初始化與首批資料驗證完成後再啟動排程；`/health` 只驗證 HTTP 程序。

### 逐批補齊新聞事件分析

正常排程預設處理最近 30 天新聞。已有歷史新聞需要逐批分析時，可在 scheduler 啟動參數加上 `--impact-since 2026-01-01`；此設定只擴大新聞事件分析與事件向量標記同步期間，不改行情起日。每輪仍受 `--impact-limit`（預設 100 篇）及 `--impact-max-cost-usd`（預設 0.50 美元估計成本）限制，成功且內容／分析設定 hash 未變者會略過。單獨 worker 對應 `news-impact-batch --since 2026-01-01 --execute`；`--since` 與 `--backfill-days` 不能同時使用。

`rag` 管線的新聞向量匯入失敗時，仍會執行獨立的 SQL 新聞事件分析，並跳過該輪向量標記同步。簡報暖機也會獨立嘗試，依既有證據檢查回傳 limited／unavailable，不將缺資料改成 verified。管線保留第一個錯誤的非零結束碼；事件分析若有失敗文章，即使未達連續失敗停止門檻也回非零。來源爬蟲即使有失敗頁，也會依既有延遲合併觸發一次後續分析，讓已入庫新聞與待分析資料持續處理；失敗來源與退出碼仍記錄於日誌。服務仍由後續排程逐批重試，單輪結束不代表歷史資料已全部完成。

歷史個股簡報已有獨立日期參數，無須改正常排程的最新簡報行為：`python -m app.jobs cache-warmup --start 2026-09-21 --end 2026-09-28`。未指定股票時使用 `stock_info`，並只處理各股已有日行情的交易日；缺行情或結果 unavailable 會回報失敗。

### 公司目錄範圍

`stock_info` 的服務名單固定為 40 檔，涵蓋 20 個官方產業分類、每產業 2 檔。`init-schema --sync-catalog` 與 `stock-info-sync` 共用 [SUPPORTED_SYMBOLS](../backend/app/jobs/market/stock_info.py)，後續同步不會重新匯入全市場。同步只更新與新增指定公司，不自動刪除既有資料；從全市場縮減的既有環境須另行執行資料清理。

| 產業 | 股票 |
| --- | --- |
| 水泥工業 | 1101 台泥、1102 亞泥 |
| 食品工業 | 1216 統一、1231 聯華食 |
| 塑膠工業 | 1301 台塑、1303 南亞 |
| 紡織纖維 | 1402 遠東新、1476 儒鴻 |
| 電機機械 | 1504 東元、1519 華城 |
| 鋼鐵工業 | 2002 中鋼、2014 中鴻 |
| 橡膠工業 | 2105 正新、2106 建大 |
| 汽車工業 | 2201 裕隆、2207 和泰車 |
| 半導體業 | 2330 台積電、2454 聯發科 |
| 電腦及週邊設備業 | 2382 廣達、2357 華碩 |
| 光電業 | 2409 友達、3008 大立光 |
| 通信網路業 | 2412 中華電、3045 台灣大 |
| 電子零組件業 | 2308 台達電、2327 國巨* |
| 航運業 | 2603 長榮、2609 陽明 |
| 金融保險 | 2881 富邦金、2882 國泰金 |
| 生技醫療業 | 1795 美時、6446 藥華藥 |
| 建材營造 | 2501 國建、2542 興富發 |
| 觀光餐旅 | 2707 晶華、2727 王品 |
| 貿易百貨 | 2903 遠百、2912 統一超 |
| 其他電子 | 2317 鴻海、2354 鴻準 |

公司名稱與產業名稱由官方目錄更新；上表依 2026-09-28 目錄列出。行情 `--from-stock-info`、scheduler 預設行情工作及未指定股票的 AI 快取預熱都使用 SQL 中的這份服務名單。股票選單另需有行情資料才會顯示，首次匯入完成前可能少於 40 檔。

`company_catalog.json` 保留完整官方目錄，供新聞實體辨識與產業對應使用。例如即使長榮航未納入服務名單，仍須能辨識「長榮航」，避免錯配為長榮。這份辨識目錄不代表全市場都有行情資料或可提供完整個股分析。

## 背景工作

新聞來源版本使用三張額外資料表；升級既有資料庫前先執行唯讀盤點，再明確套用遷移，API 不會自行建表。指令、選版與回復步驟見 [新聞來源版本](news-source-versions.md)。本輪品質變更與驗證界線見 [新聞品質實作報告](../reports/news-quality-implementation.md)。

FastAPI 啟動時管理後台排程；單次資料工作仍可使用 CLI 獨立執行。從 `backend/` 使用已安裝依賴的 Python 查看工作清單；開發時先設定程序環境 `APP_ENV=development`：

```bash
python -m app.jobs --help
```

工作涵蓋行情、新聞、索引、分析、scheduler 與研究。實際執行可能寫入 MySQL／Qdrant 或呼叫模型，執行前需確認目標環境與該命令的執行模式。

目前 `migrate-news-schema` 與 `migrate-news-impact-schema` 不解析後續參數，附加 `--help` 仍會執行遷移；查看行為時請閱讀 [dispatch](../backend/app/jobs/__main__.py)。

## 已知驗證限制

需要完整後端回歸時，從專案根目錄使用已安裝依賴的 Python 執行：

```bash
python -m pytest backend/tests -q
```

目前保留以下已知問題（2026-09-26）：

- `backend/tests/test_contract.py` 的部分案例需要已移除的 legacy 模組，例如 `backend/config.py`。
- `npm test` 與 `npm run sync:openapi` 指向缺失的 `scripts/openapiMapper.test.ts`、`scripts/sync-openapi.mjs`；`test:all` 也會因先執行 `npm test` 而中止。

判讀完整測試結果時，應區分上述既有問題與新變更造成的失敗。手動 benchmark 與實際 worker 不屬於離線測試。

## 大盤資料匯入

比較 API 使用 TWSE TAIEX 收盤價格指數，不含現金股利。資料來源為 [TWSE 歷史資料](https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html)；不是含息報酬指數。

以下為實際寫入操作，需先配置目標 MySQL。從 `backend/` 使用已安裝依賴的 Python 執行；日期範圍請依所需資料調整：

```powershell
python -m app.jobs market-backfill --benchmark-only --start 2024-09-25 --end 2026-09-25
```

Worker 會在缺少時建立 `market_benchmark_prices`，再匯入或更新每月歷史資料；首次操作的資料庫帳號需要建表權限。這項工作不初始化整個專案資料庫。API 不建立該表：未初始化時 benchmark endpoint 回傳 HTTP 503，表存在但區間無資料時回傳 `data: []`。

增量匯入會重新整理最近已儲存月份與後續資料；省略 `--end` 時使用當天日期：

```powershell
python -m app.jobs market-backfill --benchmark-only --incremental --start 2024-09-25
```

既有 market scheduler 會在個股匯入後更新 benchmark。可透過 `/stocks/benchmark/history?start_date=2024-09-25&end_date=2026-09-25` 查詢；metadata 標示 `TAIEX`、`TWSE` 與 `price_index_excluding_dividends`，缺少的日期不會補值。

離線驗證，工作目錄同為 `backend/`：

```powershell
python -m pytest tests/test_benchmark.py tests/test_scheduler.py -q
```

## 歷史資料

[歷史設計圖](圖檔/)與[學期進度](上學期進度/)保留設計脈絡；介面與命令應以目前程式碼、執行中的 OpenAPI 及根目錄 README 為準。

`docs/` 可納入版本控制；本機產生的報告與匯出檔請放在已忽略的 `output/` 或 `artifacts/`。

## 文件依據

查核日期：**2026-09-26**。以下區分文件格式、工具行為與建議；不把範例規則套成專案的強制流程。

| 官方來源 | 本次採用方式 |
| --- | --- |
| [GitHub：About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) | 根目錄說明用途、啟動、驗證與協作；專案內連結使用相對路徑，延伸內容放在此頁 |
| [AGENTS.md 開放格式](https://agents.md/) | 使用確切檔名 `AGENTS.md` 與一般 Markdown；格式沒有固定必填欄位 |
| [OpenAI：AGENTS.md 載入規則](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | 採單一根目錄指引；有實際子專案差異時才新增分層指引 |
| [OpenAI：精簡代理指引，2026-09-11](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) | 以成果、專案事實與必要邊界為主，讓模型決定方法；依任務選擇閱讀與驗證範圍 |
| [Next.js：環境需求](https://nextjs.org/docs/app/getting-started/installation) | 對照官方最低要求與本專案 lockfile；不因更新文件而更換套件版本 |

Codex 會沿專案根目錄到啟動工作目錄載入指引；同層先找 `AGENTS.override.md`，再找 `AGENTS.md`，較深層指引可覆寫較上層內容。預設合併上限為 32 KiB，這是 Codex 的設定值，不是 AGENTS.md 格式限制。完整行為見上方 OpenAI 官方文件。
