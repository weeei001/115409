# AI 模擬下單 Demo（`/ai-trade-demo`）

由 LLM 逐日決定買賣的 2330 回測 Demo。所有程式都在這個資料夾，`pages/ai-trade-demo.tsx` 只負責組裝頁面。
依賴方向是單向的：demo 可以 import 共用程式，共用程式不 import demo。刪除步驟見文末。

## 資料來源

- 後端：`NEXT_PUBLIC_AI_TRADE_DEMO_API_URL`（`.env.development`、`.env.production`），目前是 `https://ragggggggg.bobhsu.dpdns.org/X9k2mR_rag`，CORS 開放 `*`。
  沒設定時，頁面顯示「Demo 未設定 API 網址」並停用表單。`.env.*` 被 gitignore，其他人 clone 後要自己加上這個變數。
- 不使用主系統的 axios client、`NEXT_PUBLIC_API_URL`、`lib/api`、`lib/types`、`lib/mappers`。
- 契約：同資料夾的 `openapi2.json`（從專案根目錄移過來，已刪掉檔尾多出來的「解釋」，可以 `JSON.parse`）。
- 只用一支 API：`GET /api/simulate_trading_stream`，回傳 SSE。
  - 參數：`symbol`（只開放 2330）、`start`、`end`（YYYY-MM-DD）、`initial_cash`（10,000～100,000,000）、`confidence`（整數 1 保守～10 激進）。
  - 每個交易日都是一次 LLM 呼叫；五個參數完全相同時，後端會重放快取的結果。
- 讀取方式：`fetch` + `ReadableStream`（`api.ts`），**不用 `EventSource`**，因為它斷線會自動重連，重連可能再跑一次整段 LLM 回測。收到 `done` 或 `error` 後，立刻 `reader.cancel()`；元件卸載時 abort。

## 實測紀錄（2026-09-28）

參數：`symbol=2330&start=2026-08-27&end=2026-09-02&initial_cash=1000000&confidence=5`（前端驗證也用同一組，會命中快取）。
第一次呼叫（沒有快取）5 個交易日約 11 秒。原始回應存在 `fixtures/`：

| 檔案 | 內容 |
|---|---|
| `fixtures/sse-2330-20260827-20260902.txt` | 第一次呼叫（沒有快取） |
| `fixtures/sse-2330-20260827-20260902-cached.txt` | 同一組參數第二次呼叫（命中快取） |

SSE 格式：每個事件是一行 `data: {JSON}`，後面接一個空行（只有 LF）。事件種類寫在 JSON 的 `type`，沒有 `event:` 行。

### 已確認

- **init**：`stock_id`（字串）、`n_trading_days`、`initial_cash`、`confidence`；命中快取時多一個 `cached: true`。
  - spec 未列、實測回應有：`provider`（`"h200"`）、`model`（`"Gemma4-31B"`）、`execution`（`"next_open"`），型別上是 optional。
  - **命中快取時，init 沒有 `type` 欄位**（其他事件都有）。`events.ts` 用 `stock_id` + `n_trading_days` 辨認，建議後端修正。
- **day**：spec 列的 11 個欄位都有。
  - `date` 是**成交日**，比請求的 `start` 晚一個交易日（請求 8/27～9/2，收到 8/28～9/3）。
  - `buy_pct`、`sell_pct` 是 0～1 的比例（實測 0.4、0.3）。
  - 買進時 `cost` ≈ `exec_price × executed_shares`（含手續費）。
  - `portfolio_value = cash_after + shares_after × close_price`。
  - spec 未列、實測回應有：`decision_date`（做決策的交易日）、`decision_price`（決策日收盤）、`exec_price`（成交價）。畫面只在 tooltip 顯示 `decision_date`，成交價不顯示也不推算。
- **done.metrics** 的 key（spec 只寫 `{...}`，以下都是實測）：
  `n_trading_days`、`initial_cash`、`final_portfolio_value`、`total_return_pct`、`annualized_return_pct`、`annualized_is_extrapolated`、`max_drawdown_pct`（正數）、`trade_count`、`sell_count`、`win_count`、`win_rate_pct`（沒有賣出時是 `null`）、`realized_pnl`、`unrealized_pnl`、`total_pnl`、`hindsight_bounds{best_return_pct, best_n_trades, worst_return_pct, worst_n_trades, span_pct, percentile, buy_and_hold_percentile}`、`baseline_buy_and_hold{shares, final_value, total_return_pct}`、`note`（方法說明文字）。
  `*_pct` 已經是百分點（`-1.08` 代表 -1.08%）。
  - 畫面顯示標準、可解釋的指標和 `note` 原文。**`hindsight_bounds` 不顯示**：它是事後最優／最差，以及 0～100 的相對位置，不是標準績效指標。
- **日期超出範圍**：不是 SSE 的 error 事件，而是 **HTTP 400、`application/json`**：`{"detail":"日期需在資料有效範圍內：2023-05-14 ~ 2026-09-03"}`。畫面直接顯示 `detail`。
- 參數驗證失敗：依 openapi2.json 是 422 `HTTPValidationError`（`detail` 是陣列），這個格式沒有實測。

### 還不知道（不臆造）

- `action` 只看過 `"buy"`。其他值（賣出、觀望）沒看過，所以畫面只把 `buy` 翻成「買進」，其他值照原字串顯示。
  買點、賣點改用**持股變化**判斷：持股增加是買、減少是賣（`derive.ts` 的 `tradeSides`），不依賴 action 字串。
- 賣出時 `executed_shares` 的正負號、`cost` 的意義都還沒看過。
- SSE `error` 事件的實際內容沒遇過，只照 spec 讀 `message`。
- 資料有效範圍只能從 400 錯誤訊息得知，前端沒有寫死日期上下限。

## 畫面上前端自己算的指標（`derive.ts`）

| 指標 | 算法 |
|---|---|
| 期末資產 | 最後一天的 `portfolio_value` |
| 累積報酬率 | 期末資產 ÷ 初始資金 − 1 |
| 最大回撤 | 資產淨值從前高回落的最大幅度，起點是初始資金 |
| 交易次數 | `executed_shares` 不為 0 的交易日數 |
| 買進持有報酬率 | 末日 `close_price` ÷ 首日 `close_price` − 1 |
| 相對買進持有 | 累積報酬率 − 買進持有報酬率（百分點） |

用實測資料算，結果跟後端的 `total_return_pct`、`max_drawdown_pct`、`trade_count` 一致（見 `derive.test.ts`）。
後端的 `baseline_buy_and_hold` 算法不同（實測 -1.38%，前端算出來是 -1.24%），兩個數字都有列，並標明來源。

## 檔案

| 檔案 | 內容 |
|---|---|
| `types.ts` | SSE 事件與 metrics 型別 |
| `sse.ts` | SSE 區塊切分（以空行分隔、處理跨 chunk 與 CRLF） |
| `events.ts` | JSON → 事件；欄位檢查、缺 `type` 的 init |
| `api.ts` | 組 URL、fetch 串流、HTTP 錯誤訊息 |
| `params.ts` | 表單預設值（2026-08-03～2026-09-03）與驗證 |
| `derive.ts` | 買賣點判斷、前端衍生指標 |
| `display.ts` | 顯示用的格式與標籤 |
| `chartOptions.ts` | 兩張 ECharts 的 option（顏色取自 `getChartPalette`） |
| `useSimulateTradingStream.ts` | 串流狀態 hook：day 事件每 300ms 批次更新（圖表 setOption 跟著節流）、卸載時 abort、防重複送出 |
| `AiTradeDemo.tsx`、`components/` | 畫面 |
| `*.test.ts` | `sse`（跨 chunk）、`api`（done／error 後停止、快取回應、HTTP 錯誤、取消）、`derive`（衍生指標）、`params`（表單驗證） |

單獨跑測試：`npx tsx features/ai-trade-demo/<名稱>.test.ts`；`npm run test:all` 也會跑。

## 刪除 demo 的完整清單

1. 刪掉整個資料夾 `features/ai-trade-demo/`（含 `openapi2.json`、`fixtures/`、測試）。
2. 刪掉 `pages/ai-trade-demo.tsx`。
3. `lib/nav.ts`：刪掉兩行標了 `// DEMO: ai-trade-demo` 的程式（`PRIMARY_NAV` 一行、`ROUTE_PAGE_LABELS` 一行）。
   頁尾（`FOOTER_NAV = PRIMARY_NAV`）和 AI 對話的 navigate 白名單都讀 `PRIMARY_NAV`，會一起移除。
4. `components/layout/AppNavDrawer.tsx`：刪掉兩行標了 `// DEMO: ai-trade-demo` 的程式（`FlaskConical` 的 import、`NAV_ICONS` 一行）。
5. `package.json`：
   - 刪掉頂層的 `"//": "DEMO: ai-trade-demo …"` 這一行（JSON 不能寫註解，所以用 npm 慣例的 `//` 鍵標記）。
   - `scripts.test:all` 結尾刪掉 `&& tsx features/ai-trade-demo/sse.test.ts && tsx features/ai-trade-demo/api.test.ts && tsx features/ai-trade-demo/derive.test.ts && tsx features/ai-trade-demo/params.test.ts`。
6. `.env.development`、`.env.production`：各刪掉 `# DEMO: ai-trade-demo …` 註解和 `NEXT_PUBLIC_AI_TRADE_DEMO_API_URL=…` 兩行。
7. 產生檔（不在版控，可以不處理）：`.next/`、`tsconfig.tsbuildinfo` 下次建置或跑 `tsc` 時會重新產生。
8. 驗證：
   - 在專案內搜尋 `ai-trade-demo`、`AI_TRADE_DEMO`，排除 `node_modules`、`.next`，應該找不到任何結果。
   - `npm run lint`、`npm run test:all` 都要通過。
