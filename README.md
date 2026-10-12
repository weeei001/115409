# 股海明燈 Stock Lighthouse

台股資料查詢與 AI 分析平台，整合個股資訊、新聞與模擬投資，協助使用者查閱分析依據並回顧投資判斷。

![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<!-- TODO: 請補充其他已確認的徽章資訊。 -->

<!-- TODO: 請補充專案性質；若為內部工具，請移除貢獻指南。 -->

## 功能特色

- **個股資訊**：查看歷史行情、技術指標、財務資料與法人買賣超，搭配相關新聞及 AI 分析；AI 分析可開成完整報告，列印或存成 PDF。
- **多股比較**：依指定日期區間比較股票的價格表現、風險與相關性。
- **新聞分析**：整理新聞事件，區分對市場、產業與個別公司的影響，並保留原文引用。
- **AI 對話**：支援個股問答、多股比較與金融概念說明，提供引用來源；登入後可保存並延續對話。
- **收藏與通知**：管理收藏股票，設定摘要、漲跌幅及重大新聞通知。
- **模擬投資**：自訂練習資金、確認模擬委託、追蹤持股與損益，保留決策理由並安排回顧。

行情以系統已儲存的資料為準，並非即時報價。AI 回答的範圍取決於可取得的資料；模擬投資不連接真實券商帳戶。

## 安裝步驟

### 環境需求

- Python 3.12
- Node.js 22 與 npm
- MySQL
- Qdrant、Embedding API 與 LLM API，用於新聞檢索及 AI 分析

前端使用 Next.js、React 與 TypeScript；後端使用 FastAPI、SQLAlchemy，資料儲存使用 MySQL 與 Qdrant。

<!-- TODO: 請補充儲存庫下載網址，以及外部服務的建置方式與版本需求。 -->

以下指令使用 Windows PowerShell，從專案根目錄開始執行。

### 安裝後端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.development.example .env.development
```

編輯 `backend/.env.development`，填入開發環境的資料庫與外部服務設定。先建立 MySQL 資料庫及帳號，再初始化資料表與股票名單：

```powershell
$env:APP_ENV = 'development'
.\.venv\Scripts\python.exe -m app.jobs init-schema --sync-catalog
```

初始化不會自動補齊行情、新聞及向量資料。

<!-- TODO: 請補充適用於首次安裝的資料匯入指令與操作順序。 -->

### 安裝前端

另開終端機，從專案根目錄執行：

```powershell
cd frontend/Topic
npm.cmd ci
Copy-Item .env.development.example .env.development.local
```

在 `.env.development.local` 設定：

```dotenv
NEXT_PUBLIC_API_URL=http://127.0.0.1:8002
```

## 使用範例

### 啟動後端

在 `backend/` 執行：

```powershell
$env:APP_ENV = 'development'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

### 啟動前端

在另一個終端機切換至 `frontend/Topic/`：

```powershell
npm.cmd run dev
```

啟動後可開啟：

| 入口         | 網址                                                        |
| ------------ | ----------------------------------------------------------- |
| 前端         | [http://127.0.0.1:3000](http://127.0.0.1:3000)               |
| API 文件     | [http://127.0.0.1:8002/docs](http://127.0.0.1:8002/docs)     |
| API 健康檢查 | [http://127.0.0.1:8002/health](http://127.0.0.1:8002/health) |

使用 PowerShell 確認 API 程序已啟動：

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8002/health'
```

健康檢查僅確認 API 程序，資料庫與外部服務需另外驗證。資料就緒後，可從前端選擇股票，查看個股資訊或進入 AI 對話。

## 環境變數設定

| 設定檔                                    | 用途             |
| ----------------------------------------- | ---------------- |
| `backend/.env.development`              | 後端開發環境設定 |
| `frontend/Topic/.env.development.local` | 前端開發環境設定 |

請以各目錄中的 `.env.development.example` 為範本，填入實際使用的設定。

| 變數                    | 說明                                                   |
| ----------------------- | ------------------------------------------------------ |
| `APP_ENV`             | 後端開發時設為`development`，啟用開發環境設定。      |
| `DATABASE_NAME`       | 開發資料庫名稱，須以`_dev` 結尾。                    |
| `DATABASE_USER`       | 開發資料庫帳號，須以`_dev` 結尾。                    |
| `QDRANT_COLLECTION`   | 開發用向量 collection，須以`_dev` 結尾。             |
| `JWT_SECRET`          | 驗證使用的私密金鑰，請自行設定。                       |
| `CHAT_REQUEST_TIMEOUT_SECONDS` | AI 對話整輪等待上限，預設 60 秒，包含意圖、資料準備與回答。 |
| `TEXT_BRIEF_LESSONS_SYMBOLS` | 哪些股票的 AI 簡報讀取過往檢討：空白為關閉，`*` 為全部，或填 `2330,2454` 這類代號；見下方「個股 AI 簡報的過往檢討」。 |
| `NEXT_PUBLIC_API_URL` | 前端使用的 API 位址，本機為`http://127.0.0.1:8002`。 |

其餘資料庫連線、LLM 與 Embedding 設定，請參考範例檔及 [後端設定定義](backend/app/core/config.py)。

不要提交實際 `.env` 或將正式環境憑證複製到開發環境。`NEXT_PUBLIC_*` 變數會提供給瀏覽器，不可放入機密。

### AI 回答檢查

AI 對話直接發布模型回答，不做引用、數值或內容檢核，也不重新生成；回答品質只靠回答提示詞約束。回覆本身不附投資提醒，提醒由網站固定顯示在輸入框下方，複製回覆時也會附上。

個股 AI 簡報只做格式檢查與資料對齊，不檢查內容用語：
- 模型輸出無法解析或被截斷時，依同一批資料重新產生一次。
- 格式不合的項目會被拿掉，項目數超過上限的段落只保留前面幾項；引用了不存在的證據編號會被拿掉。
- 關鍵交易日的漲跌與量比改用資料庫的數值，日期晚於分析基準日或對不上行情的項目會被刪除。
- 有項目被拿掉、新聞來源核對失敗或資料不足時，簡報標示為 `limited`。

目標價、操作指令、保證用語等合規規則（`backend/app/features/analysis/compliance.py`）目前只用來擋下不合格的過往檢討短評（見下一節），沒有套用在簡報上；簡報裡的數字與推論也不另外核對。

### 個股 AI 簡報的過往檢討

`TEXT_BRIEF_LESSONS_SYMBOLS` 啟用的股票，產生簡報的排程（`cache-warmup`，即後台的「text-brief」工作）會先把已到期的方向判斷各寫成一則短評，再產生當天的簡報。新簡報只讀分析基準日以前已經到期的檢討（最多 3 則），用來檢查推理是否重犯同類錯誤，不能當成證據引用。期間重疊的判斷只檢討一次，例如連續 20 個交易日的波段判斷只寫一則。

- `JOBS_LESSONS_LIMIT`：每次排程最多寫幾則檢討，每則呼叫一次模型，預設 30。設為 0 時排程不寫新檢討，已寫好的檢討仍會被簡報讀取。
- 手動執行 `python -m app.jobs brief-lessons` 只列出待寫的判斷；加 `--execute` 才呼叫模型並寫入。
- `--compare` 比較讀過檢討與沒讀過檢討的簡報命中率。沒讀過的一組也包含未啟用的股票，以及功能上線前的簡報，兩組的股票與時期都不同，只能當參考。
- 檢討存在 `ai_brief_lessons` 資料表，升級時由下方的 `init-schema` 建立；排程發現有股票啟用時也會補建。寫檢討的模型呼叫不計入後台的「AI 摘要用量」。

### AI 對話的保存

只有登入使用者的對話會保存，訪客的對話離開頁面後就不保留。

| 資料表 | 內容 |
| --- | --- |
| `chat_conversations`、`chat_messages` | 對話與每則訊息；回覆保存最後發布的內容與 completed／failed／interrupted 狀態，作為後續對話歷史。 |
| `chat_message_feedback` | 使用者對已完成回覆的「有幫助／沒有幫助」回饋，後台「AI 成效」會統計。 |

使用者在 `/ai` 的歷史清單刪除對話時，該對話的訊息與回饋會一併刪除，無法復原。

### 升級時建立新資料表

升級時，請在**正式主機的 `backend/` 目錄**、使用正式環境既有的虛擬環境與資料庫設定，先執行既有建表指令，再啟動新版 API：

```powershell
.\.venv\Scripts\python.exe -m app.jobs init-schema
.\.venv\Scripts\python.exe -m app.jobs migrate-news-impact-schema
```

Linux／macOS 等價指令為 `python -m app.jobs init-schema`。這會使用既有初始化流程建立缺少的資料表（例如 `ai_brief_lessons`、`chat_message_feedback`），不需要同步公司名單。API 不會在啟動時自動建表。GitHub 的 Windows 部署流程呼叫主機外部的 `WINDOWS_DEPLOY_SCRIPT`，請將這一步納入該主機的升級作業；僅推送程式碼不能證明正式 DB 已更新。

### Incremental news indexing

Before starting the updated API or workers against an existing database, run both
upgrade commands above. `init-schema` creates missing tables;
`migrate-news-impact-schema` also adds `news_articles.ingestion_revision` and
creates the ingestion checkpoint tables. Include both commands in the host's
deployment script. A dry run requires this schema upgrade but never performs it.

Run these commands from `backend/` using the configured environment:

```powershell
# Default hourly job: new, changed, and unfinished articles only.
python -m app.jobs news-ingest

# Inspect pending work without writes or vector/embedding requests.
python -m app.jobs news-ingest --dry-run

# Separate full audit and repair, including missing vectors and stale revisions.
python -m app.jobs news-ingest --full-scan

# Read-only full verification of SQL chunks and vector payloads.
python -m app.jobs verify-news-index
```

The first run after upgrading establishes checkpoints for historical articles.
Existing vectors are confirmed and reused without re-embedding. Later runs skip
completed source revisions and publish only unfinished chunk revisions. Publication
checkpoints are isolated by vector endpoint, collection, and index version, and
are saved only after current vectors and stale-vector cleanup are confirmed.
`--skip-stale-cleanup` deliberately leaves publication pending for a later run.

ORM and SQLAlchemy Core updates invalidate source checkpoints, including metadata
changes and corrections to old articles. Direct SQL changes and external vector
deletions require `--full-scan`; normal hourly runs do not audit external changes.
An interrupted or failed audit leaves inspected, unfinished articles pending.

## 貢獻指南

修改前請閱讀 [AGENTS.md](AGENTS.md)，確認專案結構與開發約定。

提交 Pull Request 時，請說明問題、修改後的行為與驗證結果。有相關 issue 時附上連結；介面變更請附截圖。保持修改範圍集中，避免混入無關格式調整。

### 後端測試

從專案根目錄，使用已安裝依賴的 Python 執行：

```powershell
python -m pytest backend/tests -q
```

測試使用可拋棄的 SQLite 資料，並停用本機環境檔載入。遇到失敗時，請區分既有問題與本次修改造成的回歸。

### 前端檢查

在 `frontend/Topic/` 執行：

```powershell
npm.cmd run build
npm.cmd run lint -- --incremental false
npm.cmd run test:chat
npm.cmd run test:compare
npm.cmd run test:order
```

`lint` 執行 TypeScript 型別檢查。請依修改範圍補跑相關功能測試；完整腳本見 [package.json](frontend/Topic/package.json)，CI 檢查見 [工作流程](.github/workflows/ci-cd.yml)。

## 授權

本專案採用 [MIT 授權](LICENSE)。
