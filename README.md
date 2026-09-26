# 股海明燈 · G115409

台股資料與 AI 分析專案，提供行情與新聞查詢、多股比較、具來源引用的 AI 對話、個股分析、模擬下單與回測。前端使用 Next.js；後端使用 FastAPI、SQLAlchemy 與 MySQL，並透過 Qdrant、embedding 與 LLM 服務處理新聞檢索及分析。

## 專案入口

| 路徑 | 用途 |
| --- | --- |
| [backend/app/main.py](backend/app/main.py) | FastAPI app factory、路由組裝與資源生命週期 |
| [backend/app/features/](backend/app/features/) | auth、market、news、orders、analysis、chat、retrieval、simulation |
| [backend/app/jobs/](backend/app/jobs/) | 爬蟲、資料匯入、新聞處理、排程與研究工作 |
| [frontend/Topic/](frontend/Topic/) | 正式前端，使用 Next.js Pages Router 與 npm |
| [docs/README.md](docs/README.md) | 架構說明、大盤資料匯入、官方文件依據 |
| [AGENTS.md](AGENTS.md) | 程式代理的專案協作指引 |

`frontend/topictest/` 保留舊檔案與本機產物，並非目前的前端啟動目錄。

## 環境

- Python 3.12：本專案後端測試使用的版本；套件版本見 [requirements.txt](backend/requirements.txt)。
- Node.js 22.9+ 與 npm：符合目前完整開發依賴的要求；使用 [package-lock.json](frontend/Topic/package-lock.json) 安裝。Next.js 本身的最低 Node 版本為 20.9，但專案另有要求較高版本的開發工具。
- MySQL 與既有專案 schema：資料頁面與帳號功能需要資料庫。目前沒有完整的空白資料庫初始化流程。
- Qdrant、embedding 與 LLM：使用新聞檢索及 AI 功能時配置；檢查 `/health`、`/docs` 不需要這些服務可連線。

以下範例使用 Windows PowerShell。macOS／Linux 可將虛擬環境 Python 路徑換成 `.venv/bin/python`，並以 `npm` 取代 `npm.cmd`。

## 啟動後端

從專案根目錄執行：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

編輯 `backend/.env`。範例檔含有空值，啟動前應填入要使用的設定；完整欄位與預設值以 [Settings](backend/app/core/config.py) 為準。

| 功能 | 設定 |
| --- | --- |
| 資料庫 | `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_USER`、`DATABASE_PASSWORD`、`DATABASE_NAME` |
| 帳號與本機前端 | 設定自己的 `JWT_SECRET`；`CORS_ALLOW_ORIGINS=http://127.0.0.1:3000,http://localhost:3000` |
| 個股分析 | `ANALYSIS_LLM_API_KEY`、`ANALYSIS_LLM_BASE_URL`、`ANALYSIS_LLM_MODEL` |
| 串流模型 | 可選 `STREAM_LLM_API_KEY`、`STREAM_LLM_BASE_URL`、`STREAM_LLM_MODEL`；三者皆有值時才啟用覆寫 |
| 新聞向量檢索 | `QDRANT_URL` 或 `QDRANT_HOST`／`QDRANT_PORT`，以及 `QDRANT_COLLECTION`、`QDRANT_API_KEY`、`EMBED_*`；`NEWS_INDEX_VERSION` 應與既有索引一致 |
| Google 登入／重設密碼 | 依需求設定 `GOOGLE_CLIENT_ID`、`FRONTEND_PASSWORD_RESET_URL`、`SMTP_*` |

在同一個 `backend/` 終端機啟動：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

開啟 [API 文件](http://127.0.0.1:8002/docs)、[OpenAPI](http://127.0.0.1:8002/openapi.json) 或 [健康檢查](http://127.0.0.1:8002/health)。`/health` 只確認 HTTP 程序正常，不代表 MySQL、Qdrant 或模型服務可用。

上面的連接埠由 Uvicorn `--port` 決定。若改用 `.\.venv\Scripts\python.exe -m app.main`，才會採用 `APP_HOST`、`APP_PORT`、`APP_RELOAD`；程式預設 `APP_PORT=8002`，目前 `.env.example` 則列出 `58080`。修改後端設定後須重啟程序。

API 啟動不會建立資料表或啟動排程。第一次使用資料功能，需要先取得適用的資料庫 schema 與資料；新聞 migration 只處理特定既有資料表，不是完整初始化工具。

## 啟動前端

另開終端機，從專案根目錄執行：

```powershell
cd frontend/Topic
npm.cmd ci
$env:NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8002'
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

開啟 [本機前端](http://127.0.0.1:3000)。所有 API，包括聊天 `/api/ask`，共用 `NEXT_PUBLIC_API_URL`；未設定時程式會連到 `http://127.0.0.1:8003`，與上述後端不同。

也可將公開設定存入 `frontend/Topic/.env.local`。`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 用於 Google 登入，`NEXT_PUBLIC_RAG_API_TIMEOUT_MS` 控制聊天逾時，預設為 `120000` 毫秒。`NEXT_PUBLIC_*` 會送到瀏覽器，不應放入私密金鑰。

需要建置與執行正式版時，在同一目錄與已設定 API URL 的環境執行：

```powershell
npm.cmd run build
npm.cmd start
```

目前 `start` 固定使用 `0.0.0.0:53000`。建置前須設定正確的公開 URL；切換前端位置時也須調整後端允許的 CORS origins。Android 匯出流程見 [build-capacitor-release.ps1](frontend/Topic/build-capacitor-release.ps1)。

## 驗證

依變更範圍選擇檢查。以下後端範例從專案根目錄執行，使用前述虛擬環境：

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q
```

需要完整後端回歸時：

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
```

測試 fixture 使用記憶體 SQLite 並停用本機 `.env` 載入。手動 benchmark 與實際 worker 不屬於這組離線測試。

前端檢查從 `frontend/Topic/` 執行：

```powershell
npm.cmd run lint -- --incremental false
npm.cmd run test:chat
npm.cmd run test:compare
```

`lint` 執行 TypeScript 型別檢查，並非 ESLint。其他功能可直接執行對應的 `tsx` 測試檔。

### 已知驗證限制（2026-09-26）

- `backend/tests/test_contract.py` 的部分案例需要已移除的 legacy 模組，例如 `backend/config.py`；不能作為目前 checkout 必然通過的契約基準。
- `backend/tests/test_sentiment_jobs.py` 有三個案例仍期待已移除的 `News.sentiments`，目前新聞回應使用 `event_analysis`。
- `npm test` 與 `npm run sync:openapi` 指向缺失的 `scripts/openapiMapper.test.ts`、`scripts/sync-openapi.mjs`；`test:all` 也會因先執行 `npm test` 而中止。

判讀結果時應區分既有問題與此次變更造成的失敗，並保留實際錯誤資訊。

## 背景工作

Worker 與 API 各自啟動。從 `backend/` 查看工作清單：

```powershell
.\.venv\Scripts\python.exe -m app.jobs --help
```

工作涵蓋行情、新聞、索引、分析、scheduler 與研究；大盤匯入範例見 [操作說明](docs/README.md#大盤資料匯入)。實際工作可能寫入 MySQL／Qdrant 或呼叫模型，執行前需確認目標環境與該命令的執行模式。

目前 `migrate-news-schema` 與 `migrate-news-impact-schema` 不解析後續參數，附加 `--help` 仍會執行遷移；查看行為時請閱讀 [dispatch](backend/app/jobs/__main__.py)。

## 協作與文件

修改 API 時同步檢查前端呼叫者、Pydantic schema 與受影響測試。回報問題請附重現步驟、執行命令、版本與移除敏感資料後的錯誤輸出。架構邊界與開發選擇見 [AGENTS.md](AGENTS.md)；文件採用的官方指引見 [文件依據](docs/README.md#文件依據)。
