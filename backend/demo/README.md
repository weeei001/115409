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

## 四個分頁

- **簡報**——模型輸出加上證據互相對照。
- **檢索到的新聞**——RAG 這次回傳、並且真的進到 payload 的每一則。
  逐則標示日期、`kind`、掛在哪個交易日、有沒有被簡報引用，以及**標題與摘要有沒有出現本檔的代號或名稱**。
  標題與摘要都沒提到的列會有底色。用來判斷檢索品質：命中的到底是個股新聞還是大盤快訊。
  摘要那一欄就是模型看到的全部內容，也就是 RAG 回傳的切塊全文（`NEWS_SUMMARY_CHARS = None`，不截斷），
  不是整篇文章。
- **原始 payload**——完整 40 列時間軸、長期座標、基本面、`missing_fields`，以及可展開的完整 JSON。
  模型看不到這裡沒有的任何資料。
- **執行紀錄**——`llm_responses` 由新到舊，每一列是一次 LLM 呼叫，含失敗與 fallback 的那幾次。
  有時間、模型、狀態、LLM 耗時、新聞數與 `config_hash`。按「載入」會用當時存下來的回應
  重畫前三個分頁，連同那一次真正送進模型的 payload，適合拿來比較不同模型或不同設定的結果。
  這一頁需要後端，離線範例看不到。

前三頁的 payload 要有資料，請求必須帶 `include_payload: true`（控制列的「附帶原始 payload」預設已勾）。
這個欄位只是把送進 LLM 的 task packet 附在回應上，不會寫進快取；命中快取時改從
`llm_responses.prompt_json` 還原，所以看快取結果也有 payload 可以查。

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
- 離線範例是寫死在 HTML 裡的兩個常數：`const SAMPLE = ...;` 是回應，
  `const SAMPLE_PACKET = ...;` 是那一次送進 LLM 的 task packet。
  要換成新的樣本就整行取代（`scripts/smoke_text_brief.py --dump out.json` 可以產生回應；
  payload 從 `llm_responses.prompt_json` 取）。
