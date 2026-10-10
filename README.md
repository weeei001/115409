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

AI 對話直接發布模型回答，不做引用、數值或內容檢核，也不重新生成；回答品質只靠回答提示詞約束。

個股 AI 簡報會做格式檢查與合規字詞檢查（目標價、操作指令、保證用語、資金配置建議、投資觀點、無歷史價格依據的前瞻價位），未通過的項目會被移除或改成制式文字，必要時依同一批資料重新生成一次。引用了不存在的證據編號會被拿掉；關鍵交易日的漲跌與量比改用資料庫的數值，日期晚於分析基準日或對不上行情的項目會被刪除。其餘數字與推論不另外核對。

### 個股 AI 簡報的過往檢討

`TEXT_BRIEF_LESSONS_SYMBOLS` 啟用的股票，產生簡報的排程（`cache-warmup`，即後台的「text-brief」工作）會先把已到期的方向判斷各寫成一則短評，再產生當天的簡報。新簡報只讀分析基準日以前已經到期的檢討（最多 3 則），用來檢查推理是否重犯同類錯誤，不能當成證據引用。期間重疊的判斷只檢討一次，例如連續 20 個交易日的波段判斷只寫一則。

- `JOBS_LESSONS_LIMIT`：每次排程最多寫幾則檢討，每則呼叫一次模型，預設 30。設為 0 時排程不寫新檢討，已寫好的檢討仍會被簡報讀取。
- 手動執行 `python -m app.jobs brief-lessons` 只列出待寫的判斷；加 `--execute` 才呼叫模型並寫入。
- `--compare` 比較讀過檢討與沒讀過檢討的簡報命中率。沒讀過的一組也包含未啟用的股票，以及功能上線前的簡報，兩組的股票與時期都不同，只能當參考。
- 檢討存在 `ai_brief_lessons` 資料表，升級時由下方的 `init-schema` 建立；排程發現有股票啟用時也會補建。寫檢討的模型呼叫不計入後台的「AI 摘要用量」。

### 後台 AI 對話紀錄

管理員可從 `/admin?tab=ai-conversations` 查看每輪對話的紀錄。新的紀錄只有三種結果：直接回覆、生成失敗、中斷；預設列出需要處理的生成失敗與中斷。可依問題關鍵字、使用者、對話編號、原因與近 1–14 天篩選。點開單筆可對照模型初稿、本輪來源快照及最終回覆，並查看模型、結束標記、Token 用量、輸出上限與耗時。篩選選單裡的「安全回覆」「初次通過」「修復後通過」是回答檢核停用前的舊紀錄，只為了讀取還沒過期的資料而保留。

升級時，請在**正式主機的 `backend/` 目錄**、使用正式環境既有的虛擬環境與資料庫設定，先執行既有建表指令，再啟動新版 API：

```powershell
.\.venv\Scripts\python.exe -m app.jobs init-schema
```

Linux／macOS 等價指令為 `python -m app.jobs init-schema`。這會使用既有初始化流程建立缺少的資料表（例如 `chat_validation_runs`、`ai_brief_lessons`），不需要同步公司名單。API 不會在啟動時自動建表；若尚未初始化，紀錄頁顯示明確錯誤，使用者對話仍可正常運作。GitHub 的 Windows 部署流程呼叫主機外部的 `WINDOWS_DEPLOY_SCRIPT`，請將這一步納入該主機的升級作業；僅推送程式碼不能證明正式 DB 已更新。

| 紀錄 | 儲存與使用方式 |
| --- | --- |
| 使用者對話 | `chat_messages` 保存最後發布的回覆與 completed／failed／interrupted 狀態，作為後續對話歷史。 |
| 對話紀錄 | `chat_validation_runs` 獨立保存管理員可見的初稿、失敗原因與來源。一般對話 API 不回傳這些欄位，兩個紀錄 API 都即時檢查管理員資格，並回傳 `Cache-Control: no-store`。 |
| 保留與刪除 | 紀錄 API 只顯示最近 14 天；每次儲存新紀錄時清除過期資料。使用者刪除原對話時一併清除其對話紀錄，晚到的寫入不會重新建立已刪除對話的紀錄。閒置系統的實體過期資料會留到下次成功寫入才清除。 |
| 完整性 | 問題最多 6,000 字元，每份稿件與最終回覆最多 32,000 字元；來源最多 64 筆，每筆內文最多 24,000 字元，另有整體快照上限。裁切狀態會明確標示，不能將裁切快照當作完整證據。 |

對話紀錄於每輪結束時盡力寫入一次，不額外呼叫模型；前景最多等待 0.5 秒，最多允許 4 個未完成的寫入。DB 暫時無法寫入、寫入額滿、程序強制終止等情況仍可能沒有紀錄，**查不到紀錄不代表那一輪沒有失敗**。部署前沒有保存的失敗原稿無法回補。後台的流程完成標記只表示 AI 服務已形成完整回覆，無法保證瀏覽器完整收到，也不能單靠此標記證明對話訊息已成功寫入；應配合對話狀態與應用程式紀錄判讀。

只保存可見回覆及必要來源，模型私有推理內容、完整系統提示詞、認證標頭與任意上游除錯 metadata 不納入紀錄。這個畫面只供人工除錯，不會改變已發布的回覆。

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
