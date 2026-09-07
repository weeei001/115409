# `/api/simulate_trading_stream` 使用說明

「LLM 每日模擬下單」回測 API。給定一檔股票、一段期間、一筆初始資金與一個風險偏好分數，
後端逐日重演「如果每天都問 AI 該買該賣，最後績效會如何」，並用 SSE 即時把每一天的結果推給前端。

程式碼：`rag_deploy/api_server.py`（端點）＋ `rag_deploy/simulate_trading.py`（模擬引擎）。

## 為什麼是 SSE，不是一般 GET 秒回

每個交易日都是一次獨立的 LLM 呼叫，2025~2026 這段區間有 400+ 個交易日，
單次全部跑完可能要好幾分鐘。SSE 讓前端可以邊收邊畫進度條與表格，不必整個空等。

## 請求

```
GET /api/simulate_trading_stream
```

| 參數 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `symbol` | string | `2330` | 股票代號。**目前僅支援 2330**，其他 5 檔尚未補齊 `analysis_digests` 週頻摘要 |
| `start` | string | `2025-01-01` | 回測起始日 `YYYY-MM-DD` |
| `end` | string | `2026-09-03` | 回測結束日 `YYYY-MM-DD` |
| `initial_cash` | number | `1000000` | 初始資金（新台幣元），範圍 `10,000 ~ 100,000,000` |
| `confidence` | integer | `5` | 風險偏好 `1`(保守) ~ `10`(激進)，寫進 prompt 現場影響 AI 下單幅度 |

`start`/`end` 必須落在資料有效範圍內（常數 `simulate_trading.DATA_START` ~ `DATA_END`，
目前為 `2023-05-14 ~ 2026-09-03`），超出範圍或格式錯誤回 `400`。

範例：

```
GET /api/simulate_trading_stream?symbol=2330&start=2025-06-01&end=2025-12-31&initial_cash=500000&confidence=7
```

前端用瀏覽器原生 `EventSource` 即可（純 GET，不需自訂 header）：

```js
const params = new URLSearchParams({
  symbol: '2330', start: '2025-06-01', end: '2025-12-31',
  initial_cash: 500000, confidence: 7,
});
const es = new EventSource(`/api/simulate_trading_stream?${params}`);

es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  switch (msg.type) {
    case 'init': /* 顯示進度條總數 msg.n_trading_days */ break;
    case 'day':  /* 表格加一列 */ break;
    case 'done': /* 顯示 msg.metrics 總結；關閉連線 */ es.close(); break;
    case 'error':/* 顯示錯誤訊息 */ es.close(); break;
  }
};
```

## 回應：SSE 事件序列

每則事件都是一行 `data: {...}\n\n`，依序推送：

### 1. `init`（開頭一次）

```json
{"type":"init","stock_id":"2330","n_trading_days":128,
 "initial_cash":500000,"confidence":7,"provider":"h200","model":"...",
 "cached":true}
```

- `n_trading_days`：本次區間內的交易日總數，前端拿來當進度條分母
- `cached`：只有命中結果快取時才會出現（見下方「快取行為」），代表這不是即時重演，而是重放先前算過的結果

### 2. `day`（每個交易日一則，共 `n_trading_days` 則）

```json
{
  "type": "day",
  "date": "2025-06-03",
  "action": "buy",
  "buy_pct": 0.3,
  "sell_pct": 0.0,
  "executed_shares": 260,
  "cost": 149863.5,
  "close_price": 570.36,
  "cash_after": 350136.5,
  "shares_after": 260,
  "portfolio_value": 498500.0,
  "reason": "價格趨勢向上，收盤價高於 MA20，且新聞面偏多，決定進場。"
}
```

前端要顯示的 7 個欄位對照：

| 前端顯示 | 欄位 |
|---|---|
| 日期 | `date` |
| 當天決策 | `action`（`buy` / `sell` / `hold`） |
| 花費 | `cost`（買進為正，含手續費；賣出為負，為實收金額；hold 為 0） |
| 實際股數 | `executed_shares`（AI 只決定比例，股數由後端依收盤價換算成整股） |
| 當日收盤價 | `close_price` |
| 當日餘額 | `cash_after` |
| 決策原因說明 | `reason` |

`buy_pct` / `sell_pct` 是 AI 原始決定的比例（動用現金的幾成 / 賣出持股的幾成），
可選用來顯示「AI 這次下多重的注」；`shares_after`/`portfolio_value` 可選用來畫資產曲線。

### 3. `done`（結尾一次）

```json
{
  "type": "done",
  "metrics": {
    "n_trading_days": 128,
    "initial_cash": 500000,
    "final_portfolio_value": 612340.5,
    "total_return_pct": 22.47,
    "annualized_return_pct": 58.3,
    "max_drawdown_pct": 8.2,
    "trade_count": 34,
    "win_count": 19,
    "win_rate_pct": 55.88,
    "realized_pnl": 61234.0,
    "baseline_buy_and_hold": {
      "shares": 876,
      "final_value": 590120.0,
      "total_return_pct": 18.02
    },
    "note": "決策受使用者設定的風險偏好 confidence 影響，寫進 prompt 現場調整風格，非數學縮放。……"
  }
}
```

`baseline_buy_and_hold` 是對照組：第一天用全部現金買進、抱到最後一天不動的報酬率，
方便判斷 AI 主動操作是否有比「買了不管」更好。

`note` 附帶幾項已知限制的揭露文字（新聞面為週頻快照、成交價用當天收盤價等），
若前端有「模型限制說明」的區塊可以直接顯示這段。

### 4. `error`（失敗時，取代其餘事件直接結束）

```json
{"type": "error", "message": "h200 未設定（.env 缺對應 API key）"}
```

或

```json
{"type": "error", "message": "2025-06-01~2025-06-01 區間內查無交易日（股價資料缺漏）"}
```

收到 `error` 就結束，不會再有後續事件。

## 錯誤情況（HTTP 層，連線建立前就擋掉）

| 情況 | HTTP |
|---|---|
| `symbol` 不是 2330 | 400 |
| `start`/`end` 格式錯誤 | 400 |
| 日期超出資料有效範圍 | 400 |
| `start >= end` | 400 |
| `initial_cash` 超出 1萬~1億 | 400 |
| `confidence` 不在 1~10 | 422（FastAPI 自動驗證） |

這些會直接回一般 HTTP 錯誤 JSON，不是 SSE；只有通過驗證、連線建立之後的失敗
（例如 LLM 沒設定）才會用 `type: error` 的 SSE 事件表示。

## 快取行為

完全相同的 `(symbol, start, end, initial_cash, confidence)` 五個參數，第二次呼叫會
直接重放第一次算好的結果（存在 `rag_deploy/backtest_results/_cache/`），不會重新呼叫
LLM，`init` 事件會多一個 `"cached": true`。**只要任一參數不同**（哪怕只是把
`initial_cash` 改一個數字），就會視為全新請求，重新逐日呼叫 LLM。

## 已知限制

- 只支援 2330；日期只能落在資料有效範圍內（見上方 `start`/`end` 說明）
- 新聞面是「最新一週 digest 快照」，同一週內每天看到的新聞相同，不是逐日即時檢索
  （舊 embedding 模型下架後的暫時繞過方案）
- 成交價與 AI 看到的收盤序列都用當天收盤價（有一點「看到今天收盤才決定今天用收盤價買」
  的簡化假設，未修正）
- `confidence` 是「軟性引導」寫進 prompt，AI 不一定嚴格照比例執行，僅供參考不是保證
