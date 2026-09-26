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
| `app/jobs/` | 獨立執行的匯入、排程與研究工作 |

API 與 worker 共用 feature／db 層；API 不反向依賴 jobs。`features/retrieval/chunking.py` 提供新聞切段，`features/news/sentiment.py` 提供股票辨識，`db/models/news_chunk.py` 保留獨立 metadata。API 啟動不建立資料表。

`core/streaming.py` 統一 SSE 編碼與來源 iterator 關閉；各 router 保留自己的 headers 與數值序列化政策。架構邊界與串流行為的可執行檢查分別位於 [test_architecture.py](../backend/tests/test_architecture.py) 與 [test_streaming.py](../backend/tests/test_streaming.py)。

這些是本專案的設計選擇。FastAPI 官方提供 [APIRouter 與依賴組合](https://fastapi.tiangolo.com/tutorial/bigger-applications/)及 [lifespan](https://fastapi.tiangolo.com/advanced/events/) 機制，並未要求每個專案都新增 service、repository 或抽象基底。

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
