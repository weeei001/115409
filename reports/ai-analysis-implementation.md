# AI 分析改善實作紀錄

日期：2026-09-27。依據：[審查報告](ai-analysis-review.md)、[總計畫](PLAN.md)。

## 結果與範圍

**6 份計畫的主要本機程式修正、離線回歸與評估工具已落地。正式資料處理、部署及真實模型品質對照尚未執行，因此整份計畫仍有未完成項目。** 原審查報告保持不變；未提交 Git commit。

本次沒有連線修改正式 MySQL／Qdrant、執行資料遷移、重新 embedding 或呼叫付費 LLM。快照 dry-run 讀取上次審查已保存的匯出檔，沒有重新查正式資料。

## 各計畫交付

### PLAN-01：快照資格與聊天備援

- 快照 config 明定 `purpose=production`。讀取端與寫入端共用模擬來源辨識；用途不明、模擬、結構失敗及不相符快照不供正常查詢使用。正式產生流程先排除已知模擬來源並記錄限制；共用檢索也排除這些來源，涵蓋聊天及相關新聞。
- cache-only 也檢查 config hash 與目前來源 fingerprint；新快照不合格時找其他合格快照，全部不合格則明示無結果。排除不刪紀錄，不需資料表遷移。
- 刪除對話的強制多空備援。有限重試後仍無有效答案，就說明資料不足，不根據第一張價格面板及第一個股票名稱拼湊結論。

證據：[eligibility.py](../backend/app/features/news/eligibility.py)、[repository.py](../backend/app/features/analysis/repository.py)、[analysis service](../backend/app/features/analysis/service.py)、[chat service](../backend/app/features/chat/service.py)、[快照與分析回歸](../backend/tests/test_analysis_service.py)、[對話引用回歸](../backend/tests/test_chat_citation_recovery.py)。

### PLAN-02：營收日期與最新／歷史查詢

- 月營收以 `revenue_year/revenue_month` 判斷所屬期間，保守可用日為次月 10 日與出表日的較晚者。月份不明則不當成已公布。個股分析與聊天共用此規則。
- 月份、`available_at` 與 `publication_basis` 分開保留。這是可用時間估計，不是首次公布日或完整修訂歷史；晚於次月 10 日的出表資訊不提前使用。
- 個股頁最新分析不再傳最後行情日作新聞截止日。明確傳入日期的歷史查詢仍受截止日限制；回應另提供行情日、新聞截止日與產生時間。
- fingerprint 也涵蓋從正文辨識公司的相關新聞修訂，不只原始 stock_id／tags。

證據：[evidence.py](../backend/app/features/analysis/evidence.py)、[聊天基本面](../backend/app/features/chat/stock_context.py)、[StockDashboard](../frontend/Topic/features/stock/StockDashboard.tsx)、[日期回歸](../backend/tests/test_analysis_evidence.py)。快照測試包含週四／週日選取及歷史查詢不混入週末新聞。

### PLAN-03：主張與檢查範圍

- 檢查同項引用的明示 EPS、價格、百分比及法人張數；保留方向，區分量與價、單日與十日累計。聊天另核對局部日期／股票與股／張換算。
- 無引用的肯定主張會移除或重試；無引用的展望重試失敗後降為 uncertain。全部期間展望被拒時，整體方向也改為 uncertain。
- 缺資料納入 limited；模型自評 high 被保守下調，未產生校準機率。回應提供檢查項目計數與範圍，避免把被拒的原始內容回傳成公開證據。
- 新聞 publisher、URL、發布時間、時間依據與截斷資訊保留到模型輸入及證據。新增同日盤後新聞因果的確定性反例檢查。
- 新聞事件 prompt 升為 impact-v3，要求區分目前事實／未來預測、投資人獲利／公司影響及事件對象。API 明示只做結構與引句檢查。

證據：[analysis validation](../backend/app/features/analysis/validation.py)、[chat claims](../backend/app/features/chat/claims.py)、[news impact](../backend/app/features/news/impact.py)。

**限制：自由文字檢查僅涵蓋已辨識語法，不是完整語義判定。** 例如後置日期、公司別名、未辨識的單位／改寫，仍可能漏檢。新聞百分比在引文中存在，只能支持字面出現；此時標為未核實語義並降級，不把它說成明確矛盾。未以新模型實驗證明 prompt 能消除原審查的事件分類錯誤。

### PLAN-04：公司辨識、同步與檢索

- 正文兩字公司及 `(2317-TW)`／`(2317)` 可成為候選；常見歧義詞保守排除，候選仍不等於確認的影響對象。
- 清理後的引句對回原文位置及原文引文，避免空白差異使 metadata 遺失；保留內容版本防線。
- SQL 已完成分析、向量標籤尚未同步時，可核對的原文仍保留，標為 metadata_pending；過期標籤不沿用。同步失敗後停止預熱。
- related_news 實際套用關聯、日期、方向、重要性、scope／industry／topic、排序及分頁。總數是最多 200 筆向量候選內的合格文章數，回傳 `total_is_exact=false`，不是全庫筆數。
- guidance 不無條件覆寫一般片段；文章去重不足時有界補取。事件長文改保留頭尾並明示省略中段，完整性狀態傳到 UI。

證據：[retrieval service](../backend/app/features/retrieval/service.py)、[news sentiment](../backend/app/features/news/sentiment.py)、[impact metadata](../backend/app/features/retrieval/impact_metadata.py)、[20 組新聞回歸](../backend/tests/test_news_review_regressions.py)。

保留的取捨：頭尾截取仍可能漏中段；跨查詢相似度比較只是啟發式，未證明更高分一定更好。既有索引 stock_ids 未包含新辨識公司時，上游 symbol filter 仍可能漏召回，需另行增量同步。沒有增加重排模型或全面重建索引。

### PLAN-05：介面與引用

- 新聞控制項實際送出篩選；固定關聯頁隱藏重複且無效的 relation 控制。顯示「相關新聞」「檢索結果」，不冒充全庫最新新聞。
- 產業標籤對應查詢公司的產業，避免把其他產業的第一則正向影響當成該股理由。
- 個股證據目錄改為完整快照資料，固定評級不依模型是否引用；移除以可切換圖表資料補分析評級的路徑。估值證據可見樣本數與期間。
- 每輪聊天保留來源片段，新聞面板不再隱藏引用；同文章的 S1／S2 都可追溯。移除自由文字關鍵詞推斷的多空徽章，部分股票缺資料會顯示提示。
- 個股分析顯示行情日、新聞截止日、產生時間及檢查界線；新聞卡明示內容截斷。

證據：[ChatMessage](../frontend/Topic/features/ai/ChatMessage.tsx)、[useNewsList](../frontend/Topic/lib/hooks/useNewsList.ts)、[facets](../frontend/Topic/lib/brief/textBriefFacets.ts)、[前端聊天與 SSR 測試](../frontend/Topic/lib/api/ragAsk.test.ts)、[篩選測試](../frontend/Topic/lib/hooks/useNewsList.test.ts)、[評級測試](../frontend/Topic/lib/brief/textBriefFacets.test.ts)。已做型別、純函式與 SSR 驗證，未啟動正式 UI 或做瀏覽器逐步操作。

### PLAN-06：評估工具、指標與研究

- 平盤 RSI 改為 50；長期乖離只配同日價格／均線。單一估值樣本不產生「一年百分位」；至少 120 個有效樣本及 300 日跨度才提供該欄位，這是涵蓋要求，不是統計充分性的保證。
- 保留累計財報與單季 EPS 的差別，補缺值與未還原股價限制；沒有新增未經驗證的財報映射或還原價格來源。
- legacy trend 週變化明定相對起點的累積報酬；零值為 neutral，錯誤不生成假的零值預測。回應說明逐日線條是插值，日期只排週末、未排交易所休市日。
- trainer 將曾參與調整的 heldout 明示為驗證集，保留舊欄位相容。A/L 結果明示 prompt 對照；原方向門檻保留為探索訊號，不再宣稱統計穩健通過。
- 新增 9 類合成案例與純離線 captures 評分工具，保留分母、失敗案例、人工分歧及未知成本。案例已公開答案，不是獨立盲測。

證據：[評估操作文件](../docs/ai-quality-evaluation.md)、[評分工具](../backend/app/jobs/research/ai_quality_eval.py)、[案例](../backend/tests/fixtures/ai_quality_cases.json)、[指標／趨勢回歸](../backend/tests/test_quality_regressions.py)。

## 驗證紀錄

已執行的檢查：

| 檢查 | 結果 |
| --- | --- |
| 後端完整回歸，排除已知 legacy `test_contract.py` 收集問題 | 最終完整回歸 897 passed、3 個既有失敗；後續共用來源排除另跑定向回歸 |
| 最後共用模擬來源排除、analysis／retrieval／architecture 定向回歸 | 125 passed |
| analysis／日期／聊天基本面局部回歸 | 133 passed |
| 新聞／檢索／排程回歸 | 101 passed |
| 聊天相關回歸（含股／張、日期／股票交換） | 208 passed |
| `npm.cmd run lint -- --incremental false` | 通過 |
| `npm.cmd run test:chat`、`npm.cmd run test:compare` | 通過 |
| `node --import tsx lib/brief/textBriefEvidence.test.ts` | 通過 |
| `node --import tsx lib/brief/textBriefFacets.test.ts` | 通過 |
| `node --import tsx lib/hooks/useNewsList.test.ts` | 通過 |
| `git diff --check` | 通過；僅換行格式提示 |

後端命令從根目錄執行：

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests -q --ignore=backend/tests/test_contract.py --tb=short
```

前端命令工作目錄為 `frontend/Topic/`。前次測試的 3 個舊失敗來自 `test_sentiment_jobs.py`；2026-09-27 依使用者要求移除舊 worker 及其專用測試後，同一後端命令為 **875 passed**。正式資料重算因資料庫驗證與服務控制權限受阻，詳見 [重算狀態](ai-recompute-status.md)。

## 資料 dry-run 與部署前事項

新增純離線 [snapshot audit](../backend/app/features/analysis/audit.py)，從 `backend/` 執行：

```powershell
.venv/Scripts/python.exe -m app.features.analysis.audit ../artifacts/ai-analysis-review/stock_snapshots_readonly.json
.venv/Scripts/python.exe -m app.features.analysis.audit ../artifacts/ai-analysis-review/stock_served_snapshots_readonly.json
```

兩份既有匯出各 3 筆，分別辨識到 2408 的 1626 與 1618 有模擬來源。其他紀錄的 purpose 在匯出中不能確認；不能把這解讀成它們也含模擬新聞。這不是全庫盤點，未估計污染比例，未複製新聞全文至本報告。

後續操作順序：

1. 在目標環境先唯讀匯出完整候選快照的 id、config 與來源資訊，跑 audit，核對新 revision／用途與影響筆數；保留匯出及部署前備份於本機安全位置。audit 本身不核對即時來源 fingerprint。
2. 此版透過資格排除保留原快照，無須刪除 1618／1626 或修改歷史營收列。營收先分類為有期間且有出表日、有期間缺出表日、期間不明；只有最後一類需追查來源再考慮資料補正。
3. 新 analysis revision 與 impact-v3 會使舊快照／舊事件分析暫不可用或 pending。確認增量索引及事件重算、同步、快照預熱的範圍與模型費用後，再按順序執行；失敗時保留缺資料狀態。不能為恢復顯示而把舊紀錄批次標成合格。
4. 正式驗證至少核對 2330、2408、2615 的當前／歷史查詢、模擬來源排除、新聞篩選與來源引用。此步未做，不能以本機測試代替。
5. 若需回復部署，保留現有資料及新舊設定記錄；回復舊程式也會恢復舊缺陷，必須保留快照排除防線或先停用受影響展示。不要刪資料來回復。

## 尚待完成

- 真實模型三組對照與獨立人工保留集：已有 9 案例 × 3 組、27 次回答的起始設計，尚缺選定服務的實際費率、embedding 次數及核定費用上限。沒有執行付費實驗，也沒有品質提升百分比。
- 新聞預測／事實、事件／公司對應及完整自由文語義：已改 prompt 與確定性防線，真實模型改善幅度待上述實驗確認。
- 正式資料全量 dry-run、事件增量重算／同步、快照預熱、部署與正式驗證：尚未執行，現有匯出抽樣只支持列出的紀錄。
- 公司行為調整報酬、完整公告／修訂歷史及單季財報映射：本次以明示限制處理，沒有足夠資料來源契約可宣稱已補齊。

下一步最值得做的是核對正式環境資格排除與增量重算範圍，再做有限模型對照；目前沒有證據支持先更換 embedding 模型或增加付費重排器。
