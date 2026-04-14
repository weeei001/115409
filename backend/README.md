# Backend API README

本文件為 `backend` 服務的單一事實來源（single source of truth），內容依據目前程式碼與 runtime OpenAPI 生成結果整理。

- Base URL: `http://localhost:8000`
- OpenAPI/Swagger: `/docs`
- ReDoc: `/redoc`
- Health Check: `/health`
- API 規模: **39 條 path、40 個 operation（method + path）**

---

## 1. 專案簡介與技術棧

此服務提供台股資料查詢、技術指標、三大法人、新聞、模擬交易與 AI 分析 API。

核心技術：

- FastAPI
- SQLAlchemy
- MySQL（`mysql+pymysql`）
- Pydantic v2
- JWT（Bearer Token）
- NVIDIA NIM（AI 分析）

主要模組：

- `routers/`：HTTP 路由
- `crud/`：資料查詢/彙整邏輯
- `models/`：SQLAlchemy Model
- `schemas/`：Pydantic request/response schema
- `agent/`：AI pipeline（raw/quick/final/report/stream）

---

## 2. 快速啟動

### 2.1 前置需求

- Python 3.12+
- MySQL 8+
- 可連線的資料庫（預設 `topic_stock`）

### 2.2 建立虛擬環境與安裝套件（PowerShell）

```powershell
cd backend
python -m venv env
.\env\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2.3 建立設定檔

```powershell
Copy-Item .env.example .env
```

至少確認下列欄位：

- `DATABASE_HOST`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`
- `DATABASE_PORT`
- `JWT_SECRET`（正式環境務必更換）

### 2.4 啟動服務

方式 A（建議開發用）：

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

方式 B（讀取 `APP_HOST/APP_PORT/APP_RELOAD`）：

```powershell
python main.py
```

### 2.5 啟動後檢查

```text
GET http://localhost:8000/health
```

預期：

```json
{"status": "healthy"}
```

---

## 3. 環境變數表

> `config.py` 內所有設定皆有預設值，但正式環境建議明確配置敏感與外部服務參數。

### 3.1 資料庫 / 基礎服務

| 變數 | 預設值 | 說明 | 建議 |
|---|---|---|---|
| `DATABASE_HOST` | `localhost` | MySQL 主機 | 正式環境必填 |
| `DATABASE_USER` | `root` | MySQL 帳號 | 正式環境必填 |
| `DATABASE_PASSWORD` | `""` | MySQL 密碼 | 正式環境必填 |
| `DATABASE_NAME` | `topic_stock` | DB 名稱 | 依環境設定 |
| `DATABASE_PORT` | `3306` | DB Port | 依環境設定 |
| `APP_NAME` | `FastAPI MySQL Application` | OpenAPI 標題 | 可選 |
| `APP_VERSION` | `1.0.0` | API 版本文字 | 可選 |
| `DEBUG` | `True` | 除錯模式 | 正式環境建議 `False` |
| `APP_HOST` | `0.0.0.0` | 服務綁定 Host | 依部署設定 |
| `APP_PORT` | `8000` | 服務 Port | 依部署設定 |
| `APP_RELOAD` | `True` | 自動重載 | 正式環境建議 `False` |

### 3.2 JWT / 認證

| 變數 | 預設值 | 說明 | 建議 |
|---|---|---|---|
| `JWT_SECRET` | `change-me-in-production-use-long-random-string` | JWT 簽章密鑰 | **正式環境必改** |
| `JWT_ALGORITHM` | `HS256` | JWT 演算法 | 通常維持預設 |
| `JWT_EXPIRE_MINUTES` | `10080` | Token 有效期（分鐘） | 依安全政策調整 |
| `GOOGLE_CLIENT_ID` | `""` | Google Sign-In audience（可逗號多組） | 用 Google 登入時必填 |

### 3.3 AI / RAG

| 變數 | 預設值 | 說明 | 建議 |
|---|---|---|---|
| `NIM_API_KEY` | `""` | NVIDIA NIM API Key | 使用 AI 分析時必填 |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NIM Base URL | 依供應商設定 |
| `NIM_MODEL` | `""` | 單一模型覆寫 | 可選 |
| `NIM_MODEL_PRIMARY` | `meta/llama-3.1-8b-instruct` | 主要模型 | 可調整 |
| `NIM_MODEL_SECONDARY` | `meta/llama-3.1-8b-instruct` | 次要模型 | 可調整 |
| `NIM_DEFAULT_MODEL` | `primary` | 預設模型鍵 | `primary` 或 `secondary` |
| `RAG_API_URL` | `""` | RAG 服務位址 | 有整合時填寫 |
| `RAG_API_KEY` | `""` | RAG API Key | 有整合時填寫 |
| `RAG_API_TIMEOUT` | `10` | RAG timeout 秒數 | 視網路調整 |

### 3.4 忘記密碼 / SMTP

| 變數 | 預設值 | 說明 | 建議 |
|---|---|---|---|
| `PASSWORD_RESET_EXPIRE_MINUTES` | `60` | 重設 token 有效期（分鐘） | 視安全需求調整 |
| `FRONTEND_PASSWORD_RESET_URL` | `""` | 前端重設頁完整 URL（不含 query） | 啟用重設信時必填 |
| `SMTP_HOST` | `""` | SMTP Host | 要寄信時必填 |
| `SMTP_PORT` | `587` | SMTP Port | 依服務商設定 |
| `SMTP_USER` | `""` | SMTP 帳號 | 要寄信時必填 |
| `SMTP_PASSWORD` | `""` | SMTP 密碼 | 要寄信時必填 |
| `SMTP_FROM` | `""` | 寄件者信箱（可用 `SMTP_USER`） | 建議填寫 |
| `SMTP_USE_TLS` | `True` | 是否啟用 TLS | 建議開啟 |

---

## 4. 認證說明

### 4.1 Token 取得

可由以下端點取得 `access_token`：

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/google`

回傳格式（節錄）：

```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 604800,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "display_name": "Demo"
  }
}
```

### 4.2 Bearer Header

```http
Authorization: Bearer <access_token>
```

### 4.3 需要登入的端點（僅 2 個）

- `GET /auth/me`
- `POST /auth/change-password`

其餘端點目前為公開存取。

---

## 5. API 全量清單

> 來源：`main.py` + `routers/*.py` + runtime OpenAPI。  
> 說明：`Auth` 欄位 `Yes` 表示需要 Bearer Token。

### 5.1 System（2）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| GET | `/` | No | - | 根路徑資訊 | `200` |
| GET | `/health` | No | - | 健康檢查 | `200` |

### 5.2 Auth（7）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| POST | `/auth/register` | No | body: `email`, `password`, `display_name?` | 註冊並回傳 token | `200`, `400`, `422` |
| POST | `/auth/login` | No | body: `email`, `password` | 帳密登入 | `200`, `401`, `403`, `422` |
| POST | `/auth/google` | No | body: `id_token` | Google 登入/綁定 | `200`, `400`, `401`, `403`, `409`, `503`, `422` |
| GET | `/auth/me` | Yes | Header: Bearer Token | 取得當前使用者 | `200`, `401`, `403` |
| POST | `/auth/change-password` | Yes | body: `current_password`, `new_password` | 變更密碼 | `200`, `400`, `401`, `403`, `422` |
| POST | `/auth/forgot-password` | No | body: `email` | 發送重設密碼流程（統一訊息） | `200`, `422` |
| POST | `/auth/reset-password` | No | body: `token`, `new_password` | 用 token 重設密碼 | `200`, `400`, `403`, `422` |

### 5.3 Analyze / AI（7）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| POST | `/analyze/raw/prices` | No | body: `symbols[]` | 僅回傳原始價格資料 | `200`, `400`, `422`, `500` |
| POST | `/analyze/raw/indicators` | No | body: `symbols[]` | 僅回傳原始技術指標 | `200`, `400`, `422`, `500` |
| POST | `/analyze/raw/institutional` | No | body: `symbols[]` | 僅回傳原始法人資料 | `200`, `400`, `422`, `500` |
| POST | `/analyze/quick-insights` | No | body: `symbols[]` | 快速重點摘要（短格式） | `200`, `400`, `422`, `500` |
| POST | `/analyze/final` | No | body: `symbols[]` | 最終分析結果 | `200`, `400`, `422`, `500` |
| POST | `/analyze/report` | No | body: `symbols[]` | 非串流整包報告（含 quick/institutional） | `200`, `400`, `422`, `500` |
| POST | `/analyze/stream` | No | body: `symbols[]` | SSE 串流分析 | `200`, `422` |

Analyze 請求 body：

```json
{
  "symbols": ["2330"]
}
```

注意事項：

- 目前後端只會取 `symbols` 的第一個有效值做分析。
- 回看區間固定使用近 30 天（程式常數 `_LOOKBACK_DAYS = 30`）。

### 5.4 News（4）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| GET | `/news` | No | `page`, `page_size`, `news_id`, `id`, `keyword`, `stock`, `start_time`, `end_time`, `sort_by`, `sort_order` | 查詢新聞列表 | `200`, `422` |
| GET | `/news/{id}` | No | path: `id` | 依主鍵查單筆 | `200`, `404`, `422` |
| GET | `/news/by-news-id/{news_id}` | No | path: `news_id` | 依 business id 查單筆 | `200`, `404`, `422` |
| GET | `/news/stats/count` | No | 與 `/news` 同條件（不含分頁排序） | 查符合條件總數 | `200`, `422` |

### 5.5 Simulated Orders（4）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| POST | `/simulated-orders/` | No | body: `user_id`, `symbol`, `side`, `quantity`, `trade_date?`, `sell_plan?`, `planned_sell_date?` | 建立模擬委託 | `200`, `400`, `404`, `422` |
| GET | `/simulated-orders/` | No | query: `user_id`, `limit?` | 查委託列表 | `200`, `422` |
| GET | `/simulated-orders/available-lots` | No | query: `user_id`, `symbol` | 查可賣張數 | `200`, `400`, `422` |
| GET | `/simulated-orders/profit-by-category` | No | query: `user_id` | 依股票彙總損益 | `200`, `422` |

重要：`SimulatedOrderCreate` 使用的是 **`user_id`**（舊欄位命名已不適用）。

### 5.6 Stocks（16）

#### A. 價格與圖表（12）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| GET | `/stocks/symbols` | No | - | 取得可用股票代號 | `200` |
| GET | `/stocks/{symbol}/latest` | No | path: `symbol` | 最新股價 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/price/{date}` | No | path: `symbol`, `date` | 指定日期股價 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/history` | No | path: `symbol`; query: `start_date?`, `end_date?`, `skip?`, `limit?` | 歷史價格（可分頁） | `200`, `422` |
| GET | `/stocks/{symbol}/date-range` | No | path: `symbol` | 可查資料日期範圍 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/candlestick` | No | path: `symbol`; query: `start_date`, `end_date` | K 線資料 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/statistics` | No | path: `symbol`; query: `start_date`, `end_date` | 區間統計 | `200`, `404`, `422` |
| GET | `/stocks/compare/multiple` | No | query: `symbols`, `start_date`, `end_date` | 多股比較（最多 10 檔） | `200`, `400`, `404`, `422` |
| GET | `/stocks/{symbol}/chart/candlestick-ma` | No | path: `symbol`; query: `start_date`, `end_date`, `ma_periods?` | K 線 + MA | `200`, `400`, `404`, `422` |
| GET | `/stocks/{symbol}/chart/volume` | No | path: `symbol`; query: `start_date`, `end_date` | 量價資料 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/chart/price-change` | No | path: `symbol`; query: `start_date`, `end_date` | 漲跌幅資料 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/chart/ohlc` | No | path: `symbol`; query: `start_date`, `end_date` | OHLC 陣列輸出 | `200`, `404`, `422` |

#### B. 技術指標（2）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| GET | `/stocks/{symbol}/indicators` | No | path: `symbol`; query: `start_date`, `end_date` | 指標區間資料 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/indicators/latest` | No | path: `symbol` | 最新指標 | `200`, `404`, `422` |

#### C. 三大法人（2）

| Method | Path | Auth | 主要參數 | 用途 | 主要狀態碼 |
|---|---|---|---|---|---|
| GET | `/stocks/{symbol}/institutional` | No | path: `symbol`; query: `start_date`, `end_date` | 法人區間資料 | `200`, `404`, `422` |
| GET | `/stocks/{symbol}/institutional/latest` | No | path: `symbol` | 最新法人資料 | `200`, `404`, `422` |

---

## 6. 關鍵 Request / Response 範例

以下範例以 `http://localhost:8000` 為 base URL。

### 6.1 Auth

註冊：

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "Passw0rd!",
    "display_name": "Demo"
  }'
```

登入：

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "Passw0rd!"
  }'
```

查自己（需要 token）：

```bash
curl http://localhost:8000/auth/me \
  -H "Authorization: Bearer <access_token>"
```

### 6.2 Analyze（`/analyze/report`）

```bash
curl -X POST http://localhost:8000/analyze/report \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["2330"]}'
```

回應節錄：

```json
{
  "symbol": "2330",
  "date_start": "2026-03-01",
  "date_end": "2026-04-01",
  "summary": "...",
  "sentiment_score": 0.28,
  "recommendation": "...",
  "recommendation_basis": ["...", "...", "...", "..."],
  "score_breakdown": {
    "technical_score": 0.4,
    "institutional_score": 0.3,
    "news_score": 0.2,
    "momentum_score": 0.1,
    "weighted_score": 0.28
  },
  "quick_points": ["..."],
  "institutional_data": [
    {
      "date": "2026-04-01",
      "foreign_net": 100,
      "trust_net": 50,
      "dealer_net": 20,
      "total_net": 170
    }
  ],
  "status": "done"
}
```

### 6.3 Stocks（`/stocks/{symbol}/history`）

```bash
curl "http://localhost:8000/stocks/2330/history?start_date=2026-03-01&end_date=2026-04-01&skip=0&limit=50"
```

### 6.4 News（`/news`）

```bash
curl "http://localhost:8000/news?page=1&page_size=20&keyword=台積電&sort_by=publish_time&sort_order=desc"
```

### 6.5 Simulated Orders（建立委託）

```bash
curl -X POST http://localhost:8000/simulated-orders/ \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "u123",
    "symbol": "2330",
    "side": "buy",
    "quantity": 2,
    "trade_date": "2026-04-10",
    "sell_plan": "long_term"
  }'
```

---

## 7. SSE 說明（`/analyze/stream`）

### 7.1 請求

- Method: `POST`
- URL: `/analyze/stream`
- Body:

```json
{"symbols": ["2330"]}
```

### 7.2 cURL 範例

```bash
curl -N -X POST http://localhost:8000/analyze/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"symbols": ["2330"]}'
```

### 7.3 事件類型

- `step_start`
- `partial_data`
- `step_done`
- `final_report`
- `error`
- `completed`

典型流程：

1. `step_start`（institutional）
2. `partial_data`（institutional）
3. `step_done`
4. `step_start`（cross_check）
5. `partial_data`（prices / indicators / quick_insights）
6. `step_done`
7. `step_start`（news）
8. `partial_data`（news）
9. `step_done`
10. `step_start`（final）
11. `final_report`
12. `step_done`
13. `completed`

### 7.4 前端處理重點

- 需逐事件解析 `event:` 與 `data:`。
- `final_report.report` 即最終報告主體。
- `completed.ok=false` 表示流程失敗；應顯示錯誤並結束串流。
- 伺服器已設定 `Cache-Control: no-cache`、`X-Accel-Buffering: no`，代理層也需關閉緩衝。

---

## 8. 錯誤碼對照與排錯建議

| HTTP | 常見情境 | 排查方向 |
|---|---|---|
| `400 Bad Request` | 業務規則不符（如超過股票數上限、無核心資料、賣出張數不足） | 檢查 query/body 規則與資料存在性 |
| `401 Unauthorized` | token 無效、過期、登入憑證錯誤 | 重新登入、確認 `Authorization` Header |
| `403 Forbidden` | 帳號停用 | 確認使用者 `is_active` 狀態 |
| `404 Not Found` | 查無指定資源（股價/新聞/指標/法人） | 確認 symbol、日期、id 是否存在 |
| `422 Unprocessable Entity` | 參數格式驗證失敗 | 對照 schema（日期格式、必填欄位、型別） |
| `500 Internal Server Error` | 後端整合失敗（資料抓取/AI 服務） | 檢查 server log、NIM/RAG 設定、外部連線 |

常見注意事項：

- `POST /analyze/*` 請求必須提供 `symbols` 陣列。
- `POST /simulated-orders/` 建立委託必填 `user_id`（請使用目前 schema 欄位）。
- `/auth/me` 與 `/auth/change-password` 以外端點目前不需 Bearer Token。
- 忘記密碼流程若未設定 SMTP，開發模式僅寫入 log，不會寄出郵件。

---

## 文件維護規則

- 本 README 以程式碼與 runtime OpenAPI 為準。
- 若調整 router path、schema、auth 策略，請同步更新本檔。
- 不再以舊版 `API_DOCS.md` 作為主文件來源。
