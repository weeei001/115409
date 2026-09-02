# Backend README

台股查詢系統的 FastAPI 後端，提供股價、新聞、技術指標、三大法人、FinMind 財報籌碼、模擬下單、認證與 AI 分析 API，並包含新聞／FinMind 的排程爬蟲。

端點索引見 [API_DOCS.md](API_DOCS.md)；完整 request/response schema 以 Swagger 為準：

```text
http://<ip>:<port>/docs          # 本機通常是 http://localhost:8000/docs
```

## 技術棧

- Python 3.12+
- FastAPI 0.115 + Uvicorn
- SQLAlchemy 2.0 + PyMySQL / MySQL
- Pydantic v2 + pydantic-settings
- JWT（PyJWT）、bcrypt、google-auth
- LangChain + OpenAI SDK（呼叫 NVIDIA NIM 相容端點）
- schedule + BeautifulSoup（排程爬蟲）
- pytest

## 目錄說明

| 路徑 | 內容 |
| --- | --- |
| `main.py` | FastAPI 入口、CORS、OpenAPI 標籤與路由註冊 |
| `config.py` | `Settings`，從 `backend/.env` 讀取所有環境變數 |
| `database.py` | 資料庫連線與 Session |
| `routers/` | API 路由（股價、新聞、模擬下單、認證、AI 分析、FinMind） |
| `schemas/` | Pydantic request/response schema |
| `models/` | SQLAlchemy models |
| `crud/` | 資料查詢與商業邏輯 |
| `auth/` | JWT、密碼雜湊、Google id_token 驗證、重設信與寄信，以及 `deps.py` 的 `get_current_user` |
| `stock_behavior/` | AI 分析流程：orchestrator、prompt、few-shot、證據組裝、合規檢查、正規化、可觀測性 |
| `crawler/` | 鉅亨網／自由時報新聞爬蟲、FinMind 抓取匯入與排程 |
| `scripts/` | 冒煙測試與評測腳本 |
| `tests/` | pytest 測試 |
| `demo/` | 文字簡報 DEMO 頁（單檔 HTML，零外部依賴） |
| `eval_reports/` | few-shot／簡報品質評測產出的報告 |

## 快速啟動

```powershell
cd backend
python -m venv env
.\env\Scripts\Activate.ps1
pip install -r requirements.txt
```

複製 `.env.example` 為 `.env` 並填入設定，至少要有資料庫連線：

- `DATABASE_HOST` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_NAME` / `DATABASE_PORT`

啟動服務：

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

或用 `main.py` 內的設定啟動：

```powershell
python main.py
```

啟動時會執行 `Base.metadata.create_all()` 自動建表。

## 環境變數

完整清單見 [.env.example](.env.example) 與 [config.py](config.py)，重點分組：

- **資料庫**：`DATABASE_*`
- **應用**：`APP_NAME`、`APP_VERSION`、`APP_HOST`、`APP_PORT`、`APP_RELOAD`、`DEBUG`
- **LLM（NVIDIA NIM）**：`NIM_API_KEY`、`NIM_BASE_URL`、`ADVISOR_LLM_MODEL`、`ADVISOR_LLM_TEMPERATURE`、`ADVISOR_LLM_MAX_COMPLETION_TOKENS`、`ADVISOR_LLM_RESPONSE_FORMAT`、`ADVISOR_LLM_TIMEOUT_SECONDS`（預設 900）、`ADVISOR_LLM_MAX_RETRIES`、`ADVISOR_LLM_STREAMING`、`ADVISOR_LLM_STREAM_CHUNK_TIMEOUT_SECONDS`
- **RAG**：`RAG_API_URL`、`RAG_API_KEY`、`RAG_API_TIMEOUT`
- **JWT**：`JWT_SECRET`、`JWT_ALGORITHM`、`JWT_EXPIRE_MINUTES`
- **Google 登入**：`GOOGLE_CLIENT_ID`
- **密碼重設與 SMTP**：`PASSWORD_RESET_EXPIRE_MINUTES`、`FRONTEND_PASSWORD_RESET_URL`、`SMTP_*`

拉長 `ADVISOR_LLM_TIMEOUT_SECONDS` 時通常要把 `ADVISOR_LLM_MAX_RETRIES` 降到 0，否則總等待時間與費用都會變成三倍。

## AI 分析

`stock_behavior/` 是個股 AI 分析的主要流程，對外有兩條產線：

- **情境分析**：`POST /analyze/stock-behavior/rag` 取新聞 → `POST /analyze/stock-behavior/ai` 產生分析。
- **文字簡報**：`POST /analyze/stock-behavior/text-brief`（`text-first-v2` schema），新聞由後端自行向 RAG 取得。

每次 LLM 呼叫都會寫一列 `llm_responses`（[models/llm_response.py](models/llm_response.py)），同時擔任兩個角色：

- **快取**：同一檔 + 同一基準日 + 同一 `config_hash` + 同一 `kind` 直接重播 `response_json`。
- **稽核**：`prompt_json` / `raw_llm_text` / `normalized_json` 留下輸入與原始輸出，回覆異常（截斷、合規攔截、解析失敗）時可還原現場。

未命中快取時一次文字簡報約 90 秒。DEMO 頁與操作說明見 [demo/README.md](demo/README.md)。

## 排程爬蟲

排程設定寫死在 [crawler/scheduler_utils.py](crawler/scheduler_utils.py) 上方常數區，要改時間或標的直接改常數：

| 工作 | 週期 | 內容 |
| --- | --- | --- |
| 鉅亨網新聞 | 每 30 分鐘 | `cnyes_crawlwer.py`，回溯 30 天 |
| 自由時報新聞 | 每 30 分鐘 | `ltn_crawler.py --scheduled-once`，直接寫入 `news_articles`，不經 CSV |
| FinMind | 每日 17:00 | `finmind/fetch_finmind.py` 抓取後由 `finmind/import_finmind_csv.py` 匯入 |

啟動排程：

```powershell
.\crawler\run_scheduler.bat
```

該 bat 會用 `backend/env` 的 Python 執行 `scheduler_utils.py`。

## 測試

```powershell
cd backend
.\env\Scripts\Activate.ps1
pytest
```

`tests/` 涵蓋 AI 分析的 prompt 模板、few-shot、證據組裝、as-of 時點正確性、逾時處理、文字簡報、`llm_responses` model 與 FinMind 正規化。`scripts/` 放排程用的 `warm_text_brief.py`（預先產生各檔簡報進快取）與需要真實外部服務的 `smoke_advisor_llm.py`。

## 注意事項

- 正式環境務必更換 `JWT_SECRET`，並把 `main.py` 的 CORS `allow_origins` 從 `*` 改成實際網域。
- `.env` 內布林值請使用 `true` / `false`。
- AI、RAG、Google 登入、SMTP 都是外部服務，未設定時對應端點會失敗，但 `GET /health` 仍會回 healthy。
- API 細節不要手動維護在 README，請以 runtime OpenAPI / Swagger 為準。
