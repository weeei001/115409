# 股海明燈（Stock Lighthouse）

[![CI](https://github.com/weeei001/115409/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/weeei001/115409/actions/workflows/ci-cd.yml)

台股資料查詢與 AI 分析平台，提供個股儀表板、多股比較、新聞分析、AI 對話及模擬投資。預設涵蓋 20 個產業、40 檔股票，可透過管理後台逐步擴充。

## 目錄

- [功能](#功能)
- [技術架構](#技術架構)
- [快速開始](#快速開始)
- [環境設定](#環境設定)
- [專案結構](#專案結構)
- [測試與建置](#測試與建置)
- [文件](#文件)
- [貢獻](#貢獻)

## 功能

- **個股儀表板**：股價、K 線、技術指標、財報、月營收、法人籌碼及相關新聞。
- **多股比較**：價格走勢、報酬率、相關性與基本面比較。
- **AI 分析與對話**：結合行情與新聞檢索，提供附來源的回答及登入後的對話紀錄。
- **模擬投資**：從 AI 對話建立可確認的模擬單，追蹤虛擬資金、持股與原始決策，並在觀察期滿後回顧。
- **會員管理**：註冊、登入、Google 登入、密碼重設與個人資料設定。
- **管理後台**：服務狀態、工作排程、股票新增、個股歷史資料回補、指定股票摘要更新與執行紀錄。

管理員可在 `/admin` 的「股票管理」搜尋上市、上櫃公司並加入服務清單，再選擇「回補近兩年」。新增股票會寫入 `stock_info`，後續每日行情工作會自動納入；取得股價後才會出現在一般股票選單。公司目錄尚未建立時，先執行後台的行情更新。

回補沿用 FinMind 歷史資料流程與環境中的 API 設定，透過既有序列排程執行，可從工作紀錄查看結果與重試。資料範圍以來源實際提供內容為準，新上市股票可能不足兩年；加入服務清單本身不表示歷史資料已完成回補。

## 技術架構

| 層級 | 技術 |
| --- | --- |
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS |
| 圖表 | ECharts、Lightweight Charts |
| 後端 | FastAPI、Pydantic、SQLAlchemy |
| 資料庫 | MySQL、Qdrant |
| AI | LLM API、Embedding API、新聞向量檢索 |
| 測試與 CI/CD | pytest、tsx、TypeScript、GitHub Actions |

## 快速開始

### 環境需求

- Python 3.12
- Node.js 22.9 以上與 npm
- MySQL 開發資料庫與帳號
- Qdrant 與 Embedding API（新聞向量檢索）
- LLM API（AI 分析與對話）

### 1. 下載專案

```bash
git clone https://github.com/weeei001/115409.git
cd 115409
```

### 2. 安裝後端

<details open>
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

編輯 `backend/.env.development`，填入資料庫連線、`JWT_SECRET` 與所需的 API 設定。開發用資料庫、資料庫帳號及 Qdrant collection 名稱須以 `_dev` 結尾。

### 3. 初始化並啟動後端

先建立設定中的 MySQL 資料庫與帳號，再於 `backend/` 執行：

<details open>
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

`init-schema --sync-catalog` 用於首次建立資料表與同步股票名單。行情、新聞與向量資料需另行匯入。

### 4. 啟動前端

另開終端機，從專案根目錄執行：

```bash
cd frontend/Topic
npm ci
```

將 `.env.development.example` 複製為 `.env.development.local`，確認 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8002`，再執行：

```bash
npm run dev
```

Windows PowerShell 可使用 `npm.cmd` 取代 `npm`。

| 服務 | 網址 |
| --- | --- |
| 前端 | [localhost:3000](http://127.0.0.1:3000) |
| API 文件 | [localhost:8002/docs](http://127.0.0.1:8002/docs) |
| API 健康檢查 | [localhost:8002/health](http://127.0.0.1:8002/health) |

## 環境設定

| 設定檔 | 用途 |
| --- | --- |
| [backend/.env.development.example](backend/.env.development.example) | 資料庫、驗證、AI、向量檢索與背景排程 |
| [frontend/Topic/.env.development.example](frontend/Topic/.env.development.example) | API 位址與 Google 登入 |

後端使用 `APP_ENV=development` 載入 `.env.development`；前端使用 `.env.development.local`。`NEXT_PUBLIC_*` 會公開於瀏覽器，不可放入私密金鑰。實際環境設定檔不納入版本控制。

完整後端設定見 [config.py](backend/app/core/config.py)。

## 專案結構

```text
115409/
├── .github/workflows/      # CI/CD
├── backend/
│   ├── app/
│   │   ├── main.py         # API entry point
│   │   ├── core/           # Configuration and shared utilities
│   │   ├── features/       # API features and business logic
│   │   ├── clients/        # External service clients
│   │   ├── db/             # Models and database connections
│   │   └── jobs/           # Data import and scheduled jobs
│   ├── tests/
│   └── requirements.txt
├── frontend/Topic/         # Next.js application
└── docs/                   # Development and operations documentation
```

## 測試與建置

### 後端

在專案根目錄，使用已安裝後端依賴的 Python 執行：

```bash
python -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q
```

### 前端

在 `frontend/Topic/` 執行：

```bash
npm run test:chat
npm run test:compare
npm run test:admin
npm run build
npm run lint -- --incremental false
```

`lint` 執行 TypeScript 型別檢查。`npm test` 等同 `npm run test:all`。CI/CD 設定見 [GitHub Actions](.github/workflows/ci-cd.yml)，前端實際跑哪些 `test:*` 以 workflow 為準。

## 文件

- [支援股票](backend/app/jobs/market/stock_info.py)：初始化與同步使用的股票名單。
- [Android 建置](frontend/Topic/build-capacitor-release.ps1)：Capacitor APK 建置腳本。

## 貢獻

透過 [Issues](https://github.com/weeei001/115409/issues) 回報問題，請附重現步驟、預期結果及實際結果。提交 Pull Request 時，請說明變更內容與測試結果。
