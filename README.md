# 股海明燈（StockBeacon）

[![CI](https://github.com/weeei001/115409/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/weeei001/115409/actions/workflows/ci-cd.yml)

台股資料查詢與 AI 分析平台，整合股價、財報、籌碼與財經新聞，提供個股分析、多股比較、附來源的 AI 對話及模擬下單。

目前支援 **40 檔股票、20 個產業，每產業 2 檔**。完整名單與資料範圍見[公司目錄範圍](docs/README.md#公司目錄範圍)。

## 目錄

- [主要功能](#主要功能)
- [技術架構](#技術架構)
- [快速開始](#快速開始)
- [環境變數](#環境變數)
- [專案結構](#專案結構)
- [開發與測試](#開發與測試)
- [相關文件](#相關文件)
- [參與貢獻](#參與貢獻)

## 主要功能

| 功能 | 說明 |
| --- | --- |
| 個股儀表板 | 查看 K 線、技術指標、財報、月營收、法人籌碼與相關新聞 |
| 多股比較 | 比較股價走勢、報酬、相關性與基本面，並以大盤作為參考 |
| AI 分析與對話 | 結合市場資料與新聞檢索，以串流回覆呈現分析及引用來源；登入後可查看、搜尋與繼續歷史對話 |
| 模擬下單 | 記錄買賣、查詢歷史委託、持股與損益 |
| 會員功能 | 註冊、登入、Google 登入、重設密碼與個人資料管理 |
| 背景資料處理 | FastAPI 管理排程生命週期，worker 匯入行情、處理新聞與建立向量索引 |

## 技術架構

| 層級 | 技術 |
| --- | --- |
| 前端 | Next.js 16（Pages Router）、React 19、TypeScript、Tailwind CSS |
| 圖表 | ECharts、Lightweight Charts |
| 後端 | FastAPI、Pydantic、SQLAlchemy |
| 資料儲存 | MySQL、Qdrant |
| AI 與檢索 | 外部 LLM、embedding API、新聞向量檢索、SSE 串流 |
| 驗證與 CI | pytest、TypeScript 型別檢查、tsx、GitHub Actions |

前端透過 HTTP API 存取後端。FastAPI 提供查詢與應用功能，並管理 jobs 排程的啟動與關閉；工作以子程序串行執行，不阻塞 HTTP。API 啟動時不建立資料表。管理後台沿用現有登入，可查看服務與執行紀錄、控制 jobs 及管理單一管理員資格。

## 快速開始

### 環境需求

- Python **3.12**。
- Node.js **22.9 以上**與 npm。
- MySQL，以及已建立的開發資料庫與帳號。
- 新聞向量檢索需 Qdrant 與 embedding 服務；AI 分析與對話需 LLM 服務。

後端依賴見 [requirements.txt](backend/requirements.txt)；前端版本以 [package-lock.json](frontend/Topic/package-lock.json) 為準。

### 1. 取得專案

```bash
git clone https://github.com/weeei001/115409.git
cd 115409
```

### 2. 安裝後端

從專案根目錄執行對應平台的指令：

<details>
<summary>Windows PowerShell</summary>

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.development.example .env.development
```

</details>

<details>
<summary>macOS / Linux</summary>

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.development.example .env.development
```

</details>

編輯 `backend/.env.development`，填入 MySQL 連線資訊與獨立的 `JWT_SECRET`。開發資料庫名稱、帳號及 Qdrant collection 名稱必須以 `_dev` 結尾，範例使用 `topic_stock_dev` 與 `news_chunks_v1_dev`。

### 3. 初始化並啟動後端

先建立 `.env.development` 指定的 MySQL 資料庫與帳號，再於 `backend/` 執行。`init-schema --sync-catalog` 僅在首次安裝時需要：它會建立缺少的資料表、取得官方公司目錄並同步 40 檔服務股票。

<details>
<summary>Windows PowerShell</summary>

```powershell
$env:APP_ENV = 'development'
.\.venv\Scripts\python.exe -m app.jobs init-schema --sync-catalog
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

</details>

<details>
<summary>macOS / Linux</summary>

```bash
export APP_ENV=development
.venv/bin/python -m app.jobs init-schema --sync-catalog
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

</details>

初始化不會匯入歷史行情、新聞或向量資料；資料匯入與首次索引步驟見[首次初始化](docs/README.md#首次初始化)。既有資料表的升級需使用對應遷移。

### 4. 安裝並啟動前端

另開終端機，從專案根目錄執行：

```bash
cd frontend/Topic
npm ci
```

將 [frontend/Topic/.env.development.example](frontend/Topic/.env.development.example) 複製為 `frontend/Topic/.env.development.local`，確認 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8002`，再於同一目錄啟動：

```bash
npm run dev
```

Windows PowerShell 可使用 `npm.cmd` 取代 `npm`。前端與後端各自保留一個終端機，使用 `Ctrl+C` 停止對應程序。

### 5. 開啟服務

| 服務 | 本機網址 |
| --- | --- |
| 前端 | [http://127.0.0.1:3000](http://127.0.0.1:3000) |
| API 文件（Swagger UI） | [http://127.0.0.1:8002/docs](http://127.0.0.1:8002/docs) |
| OpenAPI schema | [http://127.0.0.1:8002/openapi.json](http://127.0.0.1:8002/openapi.json) |
| 健康檢查 | [http://127.0.0.1:8002/health](http://127.0.0.1:8002/health) |

**啟動後檢查**

1. 開啟 [後端健康檢查](http://127.0.0.1:8002/health)，確認回傳 `{"status":"healthy"}`。
2. 開啟 [前端首頁](http://127.0.0.1:3000)，確認首頁可載入。
3. 確認 `frontend/Topic/.env.development.local` 的 `NEXT_PUBLIC_API_URL` 指向實際後端位址（預設 `http://127.0.0.1:8002`）；修改後停止前端程序，再執行 `npm run dev`。

`/health` 僅確認 API 程序正常；上述檢查不代表資料庫可連線、資料齊全或 AI 等外部服務可用，這些需另外確認。

## 環境變數

後端開發設定使用 `backend/.env.development`；前端使用 `frontend/Topic/.env.development.local`。範例檔分別為[後端範例](backend/.env.development.example)與[前端範例](frontend/Topic/.env.development.example)。

| 用途 | 主要變數 |
| --- | --- |
| 後端開發模式 | `APP_ENV=development` |
| MySQL | `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_USER`、`DATABASE_PASSWORD`、`DATABASE_NAME` |
| 登入與跨來源請求 | `JWT_SECRET`、`CORS_ALLOW_ORIGINS` |
| 個股 AI 分析 | `ANALYSIS_LLM_API_KEY`、`ANALYSIS_LLM_BASE_URL`、`ANALYSIS_LLM_MODEL` |
| 串流模型覆寫 | `STREAM_LLM_API_KEY`、`STREAM_LLM_BASE_URL`、`STREAM_LLM_MODEL` |
| 新聞向量檢索 | `QDRANT_URL`、`QDRANT_COLLECTION`、`QDRANT_API_KEY`、`EMBED_API_URL`、`EMBED_API_KEY`、`EMBED_MODEL`、`NEWS_INDEX_VERSION` |
| 行情匯入 | `FINMIND_API_TOKEN` |
| Google 登入與重設密碼 | `GOOGLE_CLIENT_ID`、`FRONTEND_PASSWORD_RESET_URL`、`SMTP_*` |
| 前端 API 與 Google 登入 | `NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_GOOGLE_CLIENT_ID` |

`STREAM_LLM_*` 三個欄位皆有值時才套用覆寫，否則沿用個股分析的模型設定。完整欄位、別名與預設值見 [Settings](backend/app/core/config.py)。

在後端程序設定 `APP_ENV=development` 時，後端只讀取 `.env.development`，缺檔會停止；開發狀態檔存放於 `backend/.state/development/`。`NEXT_PUBLIC_*` 會公開至瀏覽器並在建置時寫入 bundle，僅放公開設定。私密金鑰、實際 `.env`、本機資料與產生的輸出均不納入版本控制。

## 專案結構

```text
115409/
├── .github/workflows/       # CI and deployment workflow
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry point
│   │   ├── core/           # Configuration and shared infrastructure
│   │   ├── features/       # Routers, services, and repositories
│   │   ├── clients/        # External service clients
│   │   ├── db/             # Database sessions and models
│   │   └── jobs/           # Independent data workers
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   └── Topic/              # Active Next.js application
├── docs/                   # Architecture and operations documentation
└── AGENTS.md               # Coding agent instructions
```

## 開發與測試

### 後端

從專案根目錄使用已安裝依賴的 Python 執行：

```bash
python -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q
```

Windows 可將 `python` 換成 `backend/.venv/Scripts/python.exe`；macOS / Linux 可換成 `backend/.venv/bin/python`。本機測試使用一次性 SQLite 並停用 `.env` 載入。

需要完整回歸時執行 `python -m pytest backend/tests -q`，並參考[已知驗證限制](docs/README.md#已知驗證限制)判讀結果。

### 前端

在 `frontend/Topic/` 執行：

```bash
npm run test:chat
npm run test:compare
npm run build
npm run lint -- --incremental false
```

`lint` 執行 TypeScript 型別檢查。先建置可在全新 checkout 產生 Next.js 所需型別。`npm test` 的現有限制見[驗證說明](docs/README.md#已知驗證限制)。

[GitHub Actions](.github/workflows/ci-cd.yml) 執行後端架構、啟動與串流測試，以及前端的功能測試、建置和型別檢查；前端實際跑哪些 `test:*` 以 workflow 為準。

## 相關文件

- [開發與操作文件](docs/README.md)：後端分層、資料庫初始化、背景工作與資料匯入。
- [Android 建置腳本](frontend/Topic/build-capacitor-release.ps1)：Capacitor APK 匯出。
- [歷史設計文件](docs/圖檔/)與[學期進度](docs/上學期進度/)：專題設計與開發紀錄。
- [AGENTS.md](AGENTS.md)：程式代理的專案協作指引。

## 參與貢獻

歡迎透過 [Issues](https://github.com/weeei001/115409/issues) 回報問題或提出功能需求。回報問題時，請附上重現步驟、預期與實際結果，以及移除敏感資訊後的錯誤訊息。

提交 Pull Request 時，說明變更目的與驗證結果。修改 API 時，請同步檢查前端呼叫者、回應 schema 與受影響測試。專案貢獻紀錄見 [Contributors](https://github.com/weeei001/115409/graphs/contributors)。
