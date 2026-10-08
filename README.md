# 股海明燈 Stock Lighthouse

台股資料查詢與 AI 分析平台，整合個股資訊、新聞與模擬投資，協助使用者查閱分析依據並回顧投資判斷。

![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<!-- TODO: 請補充其他已確認的徽章資訊。 -->

<!-- TODO: 請補充專案性質；若為內部工具，請移除貢獻指南。 -->

## 功能特色

- **個股資訊**：查看歷史行情、技術指標、財務資料與法人買賣超，搭配相關新聞及 AI 分析。
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
| `CHAT_REQUEST_TIMEOUT_SECONDS` | AI 對話整輪等待上限，預設 60 秒，包含意圖、資料準備、初答與修復。 |
| `CHAT_REPAIR_MAX_TOKENS` | 唯一一次回答修復的輸出 token 上限，預設 2048；仍受剩餘時間限制。 |
| `NEXT_PUBLIC_API_URL` | 前端使用的 API 位址，本機為`http://127.0.0.1:8002`。 |

其餘資料庫連線、LLM 與 Embedding 設定，請參考範例檔及 [後端設定定義](backend/app/core/config.py)。

不要提交實際 `.env` 或將正式環境憑證複製到開發環境。`NEXT_PUBLIC_*` 變數會提供給瀏覽器，不可放入機密。

### AI 回答驗證

回答先完成核對才發布；未通過時，最多依同一批來源修復一次。兩次皆失敗且有可用的結構化資料時，改由程式提供最多四項附日期的行情或模擬帳戶摘要，不沿用失敗草稿的結論或建議。資料不足、來源矛盾或準備／模型服務逾時時，不捏造完整分析。

引用選擇及「假設」標籤不能解除本輪帳戶的資金與庫存限制。數值核對綁定已辨識的公司、指標、期間與單位；已辨識的行情因果及目標價須保留新聞原句與歸屬。這些檢查不保證涵蓋所有自由文字語意，也不保證上游資料本身正確。

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
