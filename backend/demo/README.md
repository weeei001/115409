# 個股文字簡報 DEMO 畫面

`text_brief_demo.html` — `POST /analyze/stock-behavior/text-brief`（schema `text-first-v2`）的展示頁。
單一檔案、零外部依賴（沒有 CDN、沒有框架），直接用瀏覽器開就能用。

## 怎麼跑

**只看畫面**（不需要後端）：
直接雙擊 `text_brief_demo.html`，按「載入離線範例」。內嵌的是一次真實執行的回應
（2330、基準日 2026-07-13、`deepseek-ai/deepseek-v4-flash`、91 秒、`status=verified`），
不是手捏的假資料。

**接真實 API**：

```bash
cd backend
uvicorn main:app --reload --port 8000
```

然後開 `text_brief_demo.html`，確認上方 API base 是 `http://127.0.0.1:8000`，按「產生分析」。
後端的 CORS 是 `allow_origins=["*"]`，所以 `file://` 開啟也能直接打。

## 展示時的三個重點

1. **可回溯**——這是 v2 與舊版最大的差別。
   點任一句結論，右側「被引用的證據」會亮出它引用的原始資料；
   反過來點右側任一筆證據，左側會亮出所有引用它的結論。按 `Esc` 取消highlight。

2. **關鍵交易日的數字不是模型寫的**。
   `key_days` 的漲跌幅與量能倍數由後端依 `ref` 從資料庫回填，模型只負責挑日期與寫敘述。
   所以那些數字不可能出錯。

3. **後端稽核紀錄**（右下）。
   十個欄位記錄後端對模型輸出做過什麼：刪掉不存在的證據 id、移除違反法遵的項目、
   數量超標截斷、數字對帳失敗……全部為空才是 `verified`。
   這一區是在說「這份簡報乾不乾淨，我們自己有帳」。

## 注意

- **要等 ~90 秒**。畫面有計時器與階段提示，但階段是依實測耗時推估的 UI 提示，
  不是後端即時回報。想看真實進度請看 uvicorn console 的 `text_brief.*` log。
- **第二次呼叫會瞬間回應**，因為命中快取（畫面會顯示「來自快取」標籤）。
  要重新產生請勾「略過快取重新產生」。
- 基準日留空＝今天。資料庫目前的行情資料到 2026-07-13，往後的日期會拿到一樣的結果。
- 離線範例是寫死在 HTML 裡的常數。要換成新的樣本，把一次執行的回應 JSON
  取代 `<script>` 開頭 `const SAMPLE = ...;` 那一行即可
  （`scripts/smoke_text_brief.py --dump out.json` 可以產生）。
