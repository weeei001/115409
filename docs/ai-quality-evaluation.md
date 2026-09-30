# AI 品質對照操作

本工具只評分已保存的輸入／輸出，不連資料庫、不呼叫 LLM 或 embedding。九類合成案例位於 [ai_quality_cases.json](../backend/tests/fixtures/ai_quality_cases.json)，包括跨公司、預測、盤後消息、重複事件、長文反證、缺資料與模擬來源。案例是開發用草稿，尚待獨立人工複核；已公開答案，不能稱為盲測集。

## 離線執行

從專案根目錄驗證工具本身：

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_ai_quality_eval.py backend/tests/test_quality_regressions.py -q
```

從 `backend/` 匯出展開後的固定原文，或評分保存的 captures（輸出放忽略目錄）：

```powershell
.venv/Scripts/python.exe -m app.jobs.research.ai_quality_eval --export-cases
.venv/Scripts/python.exe -m app.jobs.research.ai_quality_eval --captures ../artifacts/ai-quality-captures.json
```

captures 是 JSON 陣列，每組每案例各一筆；失敗也必須保留該筆、空 contexts 與失敗說明，不能移出分母。每筆包含 `arm`、`case_id`、`model`、`prompt_hash`、`token_budget`、`retrieved_ids`（完整候選 ID）、`contexts`（實際送入模型的 `{id,text}` 原文片段）、`answer`。另記 `input_tokens`、`latency_ms`、`cost_usd`；缺值保留 null，不當作零成本。正式實驗另保存完整 prompt、模型版本、embedding/index 版本及各階段召回分數於同次實驗目錄。

人工 `review` 使用 true／false／null 欄位：`citation_support`（每個事實有支持它的引用）、`numeric_accuracy`（值、正負、單位、公司、日期一致）、`target_event_accuracy`（事件狀態與公司影響正確）、`uncertainty_handling`（缺資料、傳聞及模擬資料不變成確定結論）。分歧記於 `disagreement` 並保留雙方標註，不自動算通過。工具僅自動計算文章召回、非相關召回、禁止來源、時間洩漏及必要字面反證保留；字面保留不等於理解正確，非相關召回也不等於錯公司率，後者需逐案人工確認。

## 真實三組實驗的預先規格

組別固定為日期／公司條件基準、現行向量、候選向量。第一輪九案例每組一次，共 27 次回答；另需依實際 chunk 數估算文件及查詢 embedding 呼叫。相同案例必須使用同模型、prompt、截止時間、原文及 token 上限；工具會拒絕不同模型／prompt／token 上限的混比。每次只改一項檢索策略。

在呼叫前記錄確切模型價格、輸入／輸出上限、embedding 次數、重試上限與總費用上限；本次未執行，沒有推估數字冒充實際價格。另由未參與 prompt 調整的人建立獨立保留集，先記錄雜湊與規則，再執行；本次九例不能替代它。

開發用必要門檻：時間洩漏及模擬來源送入數為零；已確認 bug 的回歸測試全部通過。比較各組逐案召回、反證保留、人工四項評分及延遲成本，列出全部退步案例。九例只支持探索判斷，不做「整體準確率提升」或投資報酬承諾。評估新聞語氣、公司影響、未來股價方向時分開標註。

## 舊趨勢與研究結果的限制

Active frontend 沒有查得 `/api/trend_predict` 消費者，但無法排除外部使用者，因此保留端點。回應新增 `neutral` 方向與插值／未還原價格／平日曆 metadata；失敗回 503 或 SSE error，不造零值預測。`ai_future` 是端點間線性插值，平日清單未排除交易所休市日。週節點百分比均相對最新收盤價累積計算。

研究 trainer 的 `heldout_*` 舊欄位保留相容，但 `evaluation_role` 明示它是參與錯誤修正與選版的驗證集。獨立回測仍保留測試起始日晚於訓練終日的檢查。A/L 共用檢索，只比較 prompt，不能證明向量效果，也不能替線上文字答案背書。

`compute_metrics` 的舊方向條件保存在 `exploratory_directional_signal`；`passed` 固定為 false，因現有資料契約不足以驗證報酬視窗獨立性及選擇偏差。樣本數及原始 p 值照實保留，p 值的獨立樣本前提亦明示。未另設一個任意樣本門檻來宣稱穩健。
