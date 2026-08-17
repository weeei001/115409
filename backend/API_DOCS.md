# 台股系統 API 文件

給前端使用的端點索引。每個端點的完整 request/response schema、欄位型別與範例，以 runtime Swagger 為準：

```text
http://localhost:8000/docs        # Swagger UI
http://localhost:8000/redoc       # ReDoc
http://localhost:8000/openapi.json
```

這份文件只列「有哪些端點、做什麼、要帶什麼」，不複製 schema，避免與程式碼不同步。

## 共通規則

- **Base URL**：`http://localhost:8000`（開發環境預設）
- **格式**：JSON (`application/json`)
- **日期**：`YYYY-MM-DD`；日期時間為 ISO 8601（`YYYY-MM-DDTHH:MM:SS`）
- **認證**：需登入的端點帶 `Authorization: Bearer <access_token>`。目前只有 `/auth/me` 與 `/auth/change-password` 需要。
- **CORS**：後端為 `allow_origins=["*"]`，`file://` 開啟的頁面也能直接呼叫。

---

## 系統

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/` | 服務名稱、版本與文件路徑 |
| GET | `/health` | 健康檢查，回 `{"status": "healthy"}`。不檢查 RAG / LLM / SMTP |

---

## 股價查詢（`/stocks`）

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/stocks/symbols` | 資料庫中所有可用股票代號 |
| GET | `/stocks/{symbol}/latest` | 最新一個交易日的價量 |
| GET | `/stocks/{symbol}/history` | 歷史日線列表，支援 `start_date`／`end_date`／`skip`／`limit`（上限 1000） |
| GET | `/stocks/{symbol}/statistics` | 區間統計：最高／最低／均價／總量／交易日數。`start_date`、`end_date` 必填 |
| GET | `/stocks/{symbol}/date-range` | 該檔在資料庫中的資料涵蓋範圍 |
| GET | `/stocks/compare/multiple` | 多檔收盤價比較。`symbols` 逗號分隔，最多 10 檔；`start_date`、`end_date` 必填 |

## 圖表資料

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/stocks/{symbol}/chart/candlestick-ma` | K 線 + 移動平均。`ma_periods` 逗號分隔，預設 `5,10,20`，最多 5 條 |
| GET | `/stocks/{symbol}/chart/volume` | 成交量分析，含漲跌方向，可畫紅綠量柱 |
| GET | `/stocks/{symbol}/chart/price-change` | 價格變化與漲跌幅 `change_percent` |
| GET | `/stocks/{symbol}/integrated-chart` | 一次取得前端圖表初始化所需的整合資料（進階繪圖） |

## 技術指標

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/stocks/{symbol}/technical-indicators` | 均線、RSI、KD、MACD 等指標 |

## 三大法人與籌碼

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/stocks/{symbol}/institutional-trades` | 三大法人買賣超 |
| GET | `/stocks/{symbol}/chart/chips-volume` | 籌碼 + 成交量圖表資料 |
| GET | `/stocks/{symbol}/volume-with-chips` | 成交量與三大法人整合資料 |

## FinMind 財報與籌碼擴充

資料由 `crawler/finmind/` 抓取後匯入，路徑統一在 `/stocks/{symbol}` 底下，皆支援 `start_date`／`end_date`。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/stocks/{symbol}/fundamentals/financial-statements` | 三大財報 long-form 明細 |
| GET | `/stocks/{symbol}/fundamentals/monthly-revenues` | 月營收 |
| GET | `/stocks/{symbol}/fundamentals/valuations` | PER / PBR / 殖利率 |
| GET | `/stocks/{symbol}/fundamentals/dividends` | 股利政策 |
| GET | `/stocks/{symbol}/fundamentals/dividend-results` | 除權息結果 |
| GET | `/stocks/{symbol}/chips/margin-trades` | 融資融券 |
| GET | `/stocks/{symbol}/chips/foreign-shareholding` | 外資持股 |
| GET | `/stocks/{symbol}/chips/holding-share-levels` | 持股分級 |

---

## 新聞查詢

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/news` | 查詢 `news_articles`，分頁回傳 |

查詢參數：`page`（預設 1）、`page_size`（預設 20，上限 200）、`article_id`、`keyword`（標題與內容模糊查詢）、`stock`（比對 `stock_id` 與 `tags`）、`source`（`cnyes` / `ltn` / …）、`start_time`／`end_time`（比對 `pub_time`）、`sort_by`（`pub_time` / `created_at`）、`sort_order`（`asc` / `desc`）。

---

## AI 分析（`/analyze/stock-behavior`）

模型由後端環境變數決定，**請求不得指定模型**。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/analyze/stock-behavior/rag` | 取得該檔的 RAG 新聞來源。body：`symbols`（陣列，只取第一個有效代號）、`as_of_date`、`lookback_days`（1–120，預設 30） |
| POST | `/analyze/stock-behavior/ai` | 產生情境分析。body：`symbol`、`as_of_date` 與上一步的 `news_sources`／`fallback_mode` |
| POST | `/analyze/stock-behavior/text-brief` | 產生文字簡報（`text-first-v2` schema）。只需 `symbol`；新聞由後端自行向 RAG 取得 |
| GET | `/analyze/stock-behavior/text-brief/history` | 最近幾次執行紀錄摘要。`symbol`（選填）、`limit`（預設 30，上限 100） |
| GET | `/analyze/stock-behavior/text-brief/history/{response_id}` | 重播某一次的完整回應，並附上當時送進模型的 task packet |

流程建議：先呼叫 `/rag`，把結果帶進 `/ai`；只要文字簡報的話直接打 `/text-brief`。

`text-brief` 的行為：

- **快取**：相同 `symbol` + `as_of_date` + 設定已有成功結果時直接回傳，`cached=true`。要重跑帶 `force_refresh=true`。
- **`include_payload=true`** 會把送進 LLM 的 task packet 附在回應上（不寫入快取；命中快取時從 `llm_responses.prompt_json` 還原）。
- **耗時約 90 秒**（未命中快取時），前端要留足夠 timeout。

狀態碼：`422` 請求或政策檢查未通過、`503` 上游模型暫時無法回應、`504` 產生逾時。

DEMO 頁面：[demo/text_brief_demo.html](demo/text_brief_demo.html)，說明見 [demo/README.md](demo/README.md)。

---

## 模擬下單（`/simulated-orders`）

以前端匿名 `user_id` 識別，不走 JWT。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/simulated-orders/` | 建立買進／賣出模擬委託，依 `trade_date` 收盤價計價。賣出會檢查可賣張數避免超賣 |
| GET | `/simulated-orders/` | 委託列表，含估值與試算損益。`user_id` 必填、`limit` 預設 100（上限 200） |
| GET | `/simulated-orders/available-lots` | 依既有委託推算可賣張數。`user_id`、`symbol` 必填 |
| GET | `/simulated-orders/profit-by-category` | 依股票代號彙總成本、市值、損益與收益率（`category` 即股票代號，名稱為相容既有前端保留） |

建立委託的錯誤：`404` 該股在交易日沒有日線資料、`400` 委託時間順序錯誤或持股不足。

---

## 認證（`/auth`）

同一 email 可合併密碼帳號與 Google 帳號。

| 方法 | 路徑 | 認證 | 說明 |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | 註冊 email 密碼帳號，直接回 token |
| POST | `/auth/login` | — | email + 密碼登入 |
| POST | `/auth/google` | — | 帶 Google `id_token` 登入或註冊 |
| GET | `/auth/me` | Bearer | 取得目前登入使用者 |
| POST | `/auth/change-password` | Bearer | 驗證舊密碼後更新。純 Google 註冊者請先走忘記密碼流程建立密碼 |
| POST | `/auth/forgot-password` | — | 寄出重設連結（需設定 SMTP 與 `FRONTEND_PASSWORD_RESET_URL`） |
| POST | `/auth/reset-password` | — | 以重設 token 設定新密碼 |

---

## 錯誤處理

錯誤回應的 body 通常是 `{"detail": "..."}`；`422` 的 `detail` 是陣列，指出哪個欄位驗證失敗。

| 狀態碼 | 情境 |
| --- | --- |
| 400 | 請求邏輯錯誤（如比較超過 10 檔、持股不足、參數組合不合法） |
| 401 | 未帶 token、token 過期或無效 |
| 404 | 找不到資料（區間無資料、該日未開盤、找不到紀錄） |
| 422 | 欄位驗證失敗，或 AI 分析的政策檢查未通過 |
| 503 | 上游模型服務暫時無法回應 |
| 504 | AI 分析逾時 |
