# AGENTS.md

## 工作原則

在授權範圍內完成使用者要求及必要驗證。自行決定一般實作細節，沿用已取得的授權；缺少的資訊會實質影響結果時才詢問。完成任務後停止，不擴大到無關改善。

預設以台灣繁體中文溝通；程式碼、識別名稱、註解、測試及技術設定使用英文，使用者另有要求時依其要求。保留無關變更與本機資料，清楚回報結果、驗證方式及尚未確認的部分。

## 專案位置

- 後端：`backend/app/`；測試：`backend/tests/`。從 `backend/` 使用 `app.main:app` 啟動 API。
- 前端：`frontend/Topic/`，採用 Next.js Pages Router、npm 與 `package-lock.json`。
- 需要安裝或啟動時，參考 [README.md](README.md)。依任務閱讀相關內容，不要求每次修改前遍讀整個專案。

## 架構與資料

修改共用行為前，追查受影響的呼叫端，優先沿用既有輔助函式及依賴注入方式。除非任務包含調整介面，否則維持 API 與資料契約。以下後端路徑以 `backend/app/` 為基準。

- Router 負責 HTTP 驗證與依賴注入；Service 協調使用案例與交易；Repository 執行 SQL，不自行提交或回滾交易。
- 領域服務不依賴 FastAPI；API 功能與 client 不匯入 `app.jobs`。
- `main.py` 管理資源生命週期及序列排程器，只有 lifespan 匯入 job runtime。API 啟動不建立資料表；模組匯入時不得連線外部服務或啟動工作。
- 股票服務名單以 SQL `stock_info` 為準，沿用 `features/market/repository.py` 的 `stock_names`。不得另設重複白名單或退回六檔股票。完整公司目錄供新聞辨識使用；`jobs/market/stock_info.py` 的 `SUPPORTED_SYMBOLS` 定義初始化與同步範圍。
- 新聞辨識位於 `features/news/sentiment.py`，切段位於 `features/retrieval/chunking.py`，共用切段資料表位於 `db/models/news_chunk.py`。保留離線腳本使用的舊 worker 切段相容匯出。
- SSE 沿用 `core/streaming.py`。修改串流時，維持既有事件格式、標頭、數值處理規則及迭代器清理行為。

## 驗證

本機後端測試使用可拋棄的 SQLite 測試資料，並停用 `.env` 載入。可直接執行相關檢查、修正本次變更造成的回歸，不必逐步詢問。遇到失敗或仍有疑慮時再擴大驗證；純文件修改通常只需核對路徑、指令與連結。

使用已設定的 Python 直譯器，依影響範圍選擇檢查，不必每次全部執行：

| 工作目錄 | 檢查 |
| --- | --- |
| 專案根目錄，涉及架構、啟動或串流時 | `python -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q` |
| 專案根目錄，需要廣泛回歸驗證時 | `python -m pytest backend/tests -q` |
| `frontend/Topic/` | `npm.cmd run lint -- --incremental false` |
| `frontend/Topic/` | 依功能執行 `npm.cmd run test:chat` 或 `npm.cmd run test:compare` |

非 Windows 環境使用 `npm`；前端 `lint` 實際執行 TypeScript 型別檢查。以證據區分新失敗與既有問題，不掩蓋回歸，也不為了通過測試而改寫無關案例。除非需求指定精確文字，否則測試應驗證行為，避免綁定提示詞的個別措辭。

## 環境與執行操作

- 開發使用 `APP_ENV=development`、`backend/.env.development`、名稱以 `_dev` 結尾的資料庫／帳號／collection，以及 `backend/.state/development/`。依 README 指令在不同終端機啟動前後端，不將正式環境憑證複製到開發環境。
- 機密、本機 `.env`、`deploy/`、`.state/`、`qdrant_db/`、產生的輸出，以及特定機器的部署手冊、腳本與設定不得提交。移除機密後的範例設定可以納入版本控制。
- Worker 可能寫入資料或呼叫付費服務。執行不熟悉的指令前先查看 `backend/app/jobs/__main__.py`，確認操作符合授權環境。`migrate-news-schema` 與 `migrate-news-impact-schema` 即使加上 `--help` 仍會執行。
- `/health` 只確認 API 程序；資料庫與外部服務是否可用，需另外驗證。

本文件保留長期適用的專案約定，並隨實作更新。參考：[OpenAI AGENTS.md 指引](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[OpenAI 精簡指令建議](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)。
