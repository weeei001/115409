# 股海明燈 · G115409

台股資料與 AI 分析平台，整合行情、財務、籌碼與新聞，提供多股比較、具來源引用的 AI 對話，以及模擬下單與回測。

## 功能

- **行情與基本面**：查詢歷史股價、技術指標、財報、月營收與籌碼資料。
- **多股比較**：比較走勢、報酬、相關性與基本面，並以大盤作為參考。
- **新聞與 AI 分析**：檢索相關新聞、分析事件影響，透過串流對話呈現答案與引用來源。
- **模擬交易與回測**：管理模擬訂單並評估策略表現。
- **資料處理**：以獨立 worker 執行行情匯入、新聞處理、向量索引與排程。

## 技術

| 範圍 | 技術 |
| --- | --- |
| 前端 | Next.js Pages Router、React、TypeScript、Tailwind CSS |
| 後端 | FastAPI、Pydantic、SQLAlchemy |
| 資料儲存 | MySQL、Qdrant |
| AI 服務 | 外部 LLM 與 embedding API、SSE 串流 |
| 驗證 | pytest、TypeScript 型別檢查、tsx |

## 快速開始

### 環境需求

- Python 3.12。
- Node.js 22.9 以上與 npm。
- MySQL，以及適用的專案資料庫 schema。專案目前沒有完整的空白資料庫初始化命令。
- 新聞向量檢索與 AI 功能另需 Qdrant、embedding 及 LLM 服務。

後端依賴見 [requirements.txt](backend/requirements.txt)，前端使用 [package-lock.json](frontend/Topic/package-lock.json) 安裝。

```bash
git clone https://github.com/weeei001/115409.git
cd 115409
```

### 後端

將 [backend/.env.development.example](backend/.env.development.example) 複製為 `backend/.env.development`，填入開發資料庫連線與獨立的 `JWT_SECRET`。資料庫名稱、帳號與 Qdrant collection 必須以 `_dev` 結尾。可選服務的設定見下方說明。

首次安裝依賴後，直接啟動後端；後續啟動不需重建虛擬環境。

<details>
<summary>Windows PowerShell</summary>

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

在 `backend/` 啟動：

```powershell
$env:APP_ENV = 'development'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

</details>

<details>
<summary>macOS / Linux</summary>

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

在 `backend/` 啟動：

```bash
APP_ENV=development .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

</details>

啟動後可開啟 [Swagger UI](http://127.0.0.1:8002/docs)、[OpenAPI](http://127.0.0.1:8002/openapi.json) 與 [健康檢查](http://127.0.0.1:8002/health)。API 不會自動建立資料表或啟動排程；`/health` 僅確認 HTTP 程序正常。

### 前端

將 [frontend/Topic/.env.development.example](frontend/Topic/.env.development.example) 複製為 `frontend/Topic/.env.development.local`。`NEXT_PUBLIC_API_URL` 預設對應後端的 `http://127.0.0.1:8002`。

另開終端機，從專案根目錄執行；Windows PowerShell 可使用 `npm.cmd` 取代 `npm`：

```bash
cd frontend/Topic
npm ci
```

安裝完成後，在 `frontend/Topic/` 啟動：

```bash
npm run dev
```

開啟 [http://127.0.0.1:3000](http://127.0.0.1:3000)。前端與後端各自在自己的終端機執行，使用 `Ctrl+C` 停止對應程序。

## 設定

| 功能 | 主要環境變數 |
| --- | --- |
| 資料庫 | `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_USER`、`DATABASE_PASSWORD`、`DATABASE_NAME` |
| 登入與跨來源請求 | `JWT_SECRET`、`CORS_ALLOW_ORIGINS` |
| 個股分析 | `ANALYSIS_LLM_API_KEY`、`ANALYSIS_LLM_BASE_URL`、`ANALYSIS_LLM_MODEL` |
| 串流模型覆寫 | `STREAM_LLM_API_KEY`、`STREAM_LLM_BASE_URL`、`STREAM_LLM_MODEL` |
| 新聞向量檢索 | `QDRANT_URL`、`QDRANT_COLLECTION`、`QDRANT_API_KEY`、`EMBED_*`、`NEWS_INDEX_VERSION` |
| Google 登入與重設密碼 | `GOOGLE_CLIENT_ID`、`FRONTEND_PASSWORD_RESET_URL`、`SMTP_*` |
| 行情匯入 | `FINMIND_API_TOKEN` |

完整欄位、別名與預設值以 [Settings](backend/app/core/config.py) 為準。開發模式使用 `APP_ENV=development`，只讀取 `.env.development`；缺檔時會停止。開發狀態檔位於 `backend/.state/development/`。

前端的 `NEXT_PUBLIC_*` 會送至瀏覽器，並在建置時寫入 bundle，不應放入私密金鑰。`.env`、憑證、資料庫檔案與產生的輸出不納入版本控制。

## 專案結構

| 路徑 | 用途 |
| --- | --- |
| [backend/app/main.py](backend/app/main.py) | API 入口、路由組裝與資源生命週期 |
| [backend/app/features/](backend/app/features/) | auth、market、news、orders、analysis、chat、retrieval、simulation |
| [backend/app/clients/](backend/app/clients/) | 外部服務介接 |
| [backend/app/db/](backend/app/db/) | 資料庫連線、session 與資料表定義 |
| [backend/app/jobs/](backend/app/jobs/) | 匯入、索引、分析與排程工作 |
| [backend/tests/](backend/tests/) | 後端測試 |
| [frontend/Topic/](frontend/Topic/) | 目前使用的前端應用程式 |
| [docs/](docs/) | 架構、資料操作與歷史設計文件 |

`frontend/topictest/` 為歷史目錄，開發請使用 `frontend/Topic/`。

## 測試

從專案根目錄使用已安裝依賴的 Python 執行：

```bash
python -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q
```

測試使用一次性的 SQLite 並停用本機 `.env` 載入。Windows 可將 `python` 換成 `backend/.venv/Scripts/python.exe`，macOS／Linux 換成 `backend/.venv/bin/python`。

前端檢查從 `frontend/Topic/` 執行：

```bash
npm run lint -- --incremental false
npm run test:chat
npm run test:compare
```

`lint` 執行 TypeScript 型別檢查。完整測試命令與目前限制見 [驗證說明](docs/README.md#已知驗證限制)。

## 文件與協作

- [開發與操作文件](docs/README.md)：後端邊界、背景工作與資料匯入。
- [AGENTS.md](AGENTS.md)：程式代理的專案協作指引。
- [Android 建置腳本](frontend/Topic/build-capacitor-release.ps1)：Capacitor APK 匯出。
- [Issues](https://github.com/weeei001/115409/issues)：回報問題或提出功能需求，請附重現步驟、使用版本與移除敏感資訊後的錯誤訊息。
- [Contributors](https://github.com/weeei001/115409/graphs/contributors)：專案貢獻紀錄。

提交 Pull Request 時，說明變更目的與驗證結果。修改 API 時同步檢查前端呼叫者、回應 schema 與受影響測試。
