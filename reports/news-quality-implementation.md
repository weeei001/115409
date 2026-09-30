# 新聞品質改善實作與驗收

日期：2026-09-28。對應 [news-quality-PLAN.md](news-quality-PLAN.md)。本文件記錄本輪實作，不能取代原始 [品質審查](news-quality-review.md) 的版本與實驗背景。

> 後續決策：使用者改為清空正式與開發資料、以第一版重新部署。本文件的資料量與模型實驗保留原樣供追溯；實際重建狀態見 [第一版正式部署與資料重建](first-deployment.md)。

## 整體判斷

本輪已修正「能找到引用，卻不代表引用支持結論」的數個資料與驗證缺口。來源現在有不可變版本與可回復選版；公司歸屬不再依賴名稱子字串或整篇標籤；關鍵日的新聞與行情分列；選版、原文更改與實際引用來源都會影響快取資格。

這仍不是完整語義驗證或可靠股價預測。真實模型實驗已發現支撐價、估值門檻及技術指標敘述的剩餘錯誤，因此「通過程式測試」不能直接視為模型回答正確。正式部署與全量重算的完成狀態另列，未完成項目不以啟動工作代替驗收。

## 1. 本輪變更

| 範圍 | 改動與效果 | 主要證據 |
| --- | --- | --- |
| 分析與聊天的 SQL 核對 | AnalysisService 預設 RAG 必須取得獨立 session factory；API／warmup 全部注入。索引核對失敗回報 unavailable，不冒充成功但零篇新聞 | `backend/app/features/analysis/service.py`、`router.py`、`backend/tests/test_rag_integration.py` |
| 公司與片段歸屬 | 長公司名與所在位置優先；長榮航不等於長榮。片段必須直接提及目標，或有目前版本、原文支持的傳導依據 | `features/news/sentiment.py`、`features/retrieval/service.py`、`test_news_quality_retrieval.py` |
| 新聞支持契約 | 各項新聞主張新增 `news_support`，記錄證據 ID、原文引句、用途及必要事件日期。關鍵日以伺服器行情與具發布時間的原文分列，移除舊五動詞判斷 | `features/analysis/schemas.py`、`validation.py`、`prompts.py`、`test_analysis_news_support.py` |
| 來源版本 | 新增 `news_article_versions`、`news_source_selections`、`news_source_decisions`；更新保留舊正文，不用文章長度決定新版是否正確 | `features/news/versions.py`、`jobs/news_versions.py`、`jobs/crawlers.py` |
| 全流程有效來源 | 列表 count／pagination 使用同一 SQL 條件；impact、切段、向量化、metadata sync 與檢索皆排除 conflict／superseded。舊 ID 仍可讀 | `features/news/repository.py`、`jobs/impact/runner.py`、`sync.py`、`jobs/ingestion/` |
| 歷史引用 | `/news/{article_id}?revision_id=...` 查不可變版本；ID 不符、找不到版本不回退到現行正文。歷史版本不套用現行 impacts；前端保留原站與保存版本雙連結 | `features/news/service.py`、`frontend/Topic/features/brief/EvidenceDetail.tsx`、`pages/news/[id].tsx` |
| 快取 | 指紋納入選版、最新決策、版本及實際引用的間接來源。rollback 是新決策；無關來源更新不使所有簡報失效。聊天不再讀取無有效指紋的舊簡報 | `features/analysis/repository.py`、`features/chat/stock_context.py` |
| 檢索標籤 | `retrieval_branch` 與內容 `kind` 分開；guidance 須有目前事件的公司營運 forecast／plan 引句。不同 query 的分數不互相比高低 | `features/retrieval/service.py`、`impact_metadata.py` |
| 共同事實 | 僅處理明確公司、年月與單位的月營收，以及相同說話者、日期、引句的聲明；矛盾保留，不誤當獨立佐證；原始段落全留 | `features/retrieval/facts.py`、`test_news_quality_retrieval.py` |

以上 `features/`、`jobs/` 路徑皆位於 `backend/app/`，測試位於 `backend/tests/`。

## 2. 已實際處理的來源衝突

正式盤點：35,988 篇文章，35,981 組 canonical source；有 7 組同 URL 不同版本。先建立版本與衝突狀態，再逐篇下載原站文章、保存 HTML hash、比較標題與完整正文，最後記錄選版理由。只忽略空白與確定的網站標題尾綴，不忽略金額、措辭或單位差異。

| 原站文章 ID | 處置 |
| --- | --- |
| [6605885](https://news.cnyes.com/news/id/6605885) | 原站正文為人民幣 1.052 億元、約新台幣 4.98 億元；舊文的 49.8 億元版本被取代。原站 AI 摘要仍有舊金額，本次依據正文選版 |
| [6613621](https://news.cnyes.com/news/id/6613621) | 原站正文約新台幣 272 億元；212 億元版本被取代 |
| 6608313、6609339、6607942 | 正文相同，但標題不同；依原站目前文章標題選定 |
| 6605865 | 依目前標題與正文選定，保留舊措辭供稽核 |
| 6615248 | 兩篇標題與正文都與原站一致，差在擷取性質 metadata；採穩定 ID 留一篇，不宣稱能重建先後順序 |

原始文章全部保留。選版發生在本次核對時間，不倒推成歷史當日已知。歷史 as-of 仍可能因當時衝突或版本時間未知而排除來源；這是有意保留的不確定性。

可追溯操作檔位於本機忽略目錄：

- `artifacts/ai-recompute/nq-versions/plan.json`：遷移前 ID、chunk、analysis 與 snapshot 清單。
- `dry-run.json`、`migration.json`：讀取與寫入分開，包含資料筆數與計畫 hash。
- `source-review.json`、每組 `.html`、`selected.json`：原站核對、來源 hash 與選版結果。
- `backup-20260928-185221/verified.json`、`backup-20260928-185320/verified.json`：9 張資料表合計 225,887 筆，gzip／JSON／逐表筆數與 SHA-256 已核對；另外保存 Qdrant snapshot。

操作說明：[news-source-versions.md](../docs/news-source-versions.md)。資料與部署腳本維持本機，不加入產品提交。

## 3. 檢索的實際影響與取捨

使用六股（2330、2454、2317、2603、2881、2002）及 2026-09-24／09-27，共 12 組固定情境。保存舊版檢索輸入與非新聞 SQL 資料，再保存新版輸入；模型比較共用相同非新聞資料、prompt、schema、few-shot 與設定。

這是**檢索輸入整體比較**，不是舊產品與新產品的完整端到端勝負。兩組都經同一版新生成器與驗證器，因此不能把品質差異全部歸因於單一 guard，也不能據此量測全站錯誤率。

已確認的候選變化：

- 長榮案例移除「長榮航貨運需求旺」的錯公司片段。
- 台積電除息片段兩日期皆保留。
- 聯發科 09-24 的 TPU 產能／競爭資料保留；09-27 兩臂原本就沒有同一組文章，保留另一篇競爭風險，不能宣稱該日 TPU 供給風險完整覆蓋。
- 長榮折舊風險保留，但兩日期的淡季／運價支撐風險片段消失。該片段沒有直接公司名，事件仍 pending；新版不再信任原始 `stock_ids`，因此產生可確認的風險召回損失。
- 12 組新版候選都沒有已觸發的共同事實群組。原因包括事件設定版本更新、舊事件 metadata 失效，以及目前分組規則刻意保守。已取消無實際處理差異的付費 no-group 對照，沒有把空分組實驗當成功。

本輪沒有更換 embedding、全庫重建向量、增加 reranker 或無條件提高 top-k。現有向量提供語義候選；SQL／原文／版本核對決定候選能否採用。這些核對能排除錯誤，也可能減少有效產業背景，必須搭配有效事件分析與正反案例，不應把「檢索更嚴格」一概稱為品質更好。

## 4. 真實模型驗證

首次模型比較已完成。固定 run：`artifacts/ai-recompute/nq-evaluation/runs/nq-quality-20260928-v3/`。

設定：Gemma4-31B、temperature 0.2，12 組配對，加台積電與長榮 09-27 各第二次生成，共 28 份回答，最多 56 次模型呼叫。並行 2，停用 SDK 重試，保留產品最多一次內容修正。設定費率預留上限 10 USD；輸入以 UTF-8 byte 數加固定 overhead 控制，不假稱是供應商 tokenizer 的精確 token 數。保存 provider 回報用量，估算費用不等於供應商帳單。

每次保留首輪輸入、prompt/schema/examples hash、原始回答、驗證後回應與呼叫紀錄；評估不寫入正式簡報資料。代理審查不是獨立人類盲評。

| 組別 | limited | unavailable | 回答數 |
| --- | ---: | ---: | ---: |
| 舊新聞選取＋同一版新生成器 | 1 | 13 | 14 |
| 新新聞選取＋同一版新生成器 | 3 | 11 | 14 |

合計 55 次呼叫，供應商回報輸入 2,193,732 tokens、輸出 159,089 tokens，依設定費率估算 0.6296532 USD；無用量不明呼叫。可展示的 4 份皆為台積電，不能把另外 24 份不提供回答視為分析成功。14 組配對的非新聞資料 hash 一致。

`review-quality.json`／`.md` 保存 18 項代理查核案例與 28 份結果檔 hash，區分使用者可見錯誤與已被擋下的原始輸出。這批凍結結果發現問題後仍保留原樣，不把後續修正混進同一實驗。

首批已找到並回到程式處理的問題：

- 台積電回答把 2,400 元支撐掛在外資累計引用上；本益比 25 倍門檻引用的新聞也沒有該數字。
- 一則 MACD 主張可在模型 packet 找到數值，但前端 evidence catalog 缺欄位；另一次把 6.14 降至 5.81 說成「持續擴大」。
- 部分期間展望被拒後，整體偏多結論仍可能保留，需確認總結是否還有足夠有效支持。
- 有來源支持的營運風險也可能因模型拼接非連續引句而被移除。這是回答可用性與覆蓋問題；不能為了保留結論放寬原文忠實性。

零費用重播另找出兩個確定的實作問題：年區間位置 `close_pos_in_1y_pct` 遺漏於百分比指標映射；以及過濾後段落空陣列違反舊 schema 的至少一項限制。後者會使其他合格觀察一起失效。修正採保留合格內容、列出留空段落；所有有效觀察都沒有時仍不可用，不以杜撰正面因素補齊版型。

重播只能驗證同一原始輸出經新守門邏輯的效果，無法驗證新版 prompt 的生成行為。後續四組實際生成另存 run，與本次 28 份結果分開。

後續 run `nq-validation-20260928-v4` 使用 postpilot 新候選及修正後 prompt／schema，2330、2454、2603、2881 的 09-27 各生成一次：4 份皆 limited，8 次呼叫，輸入 349,765 tokens、輸出 22,951 tokens，設定費率估算 0.0974942 USD。這只是四個固定案例的驗證，不是新的 12 組策略實驗。

覆核確認空段落不再使其他事實整份失效、被拒展望不再保留整體偏多、技術指標回到可見證據。但長榮仍產生「估值與殖利率提供強大下行支撐」、以單月收入宣稱年增強勁的句子；這些已知缺口再補最小規則與原始輸出重播，不能因回答成功回傳就略過。

最後凍結版本為 `pipeline4`，analysis revision `f8a9a28badba`。重播已確認上述長榮波段與中期展望皆遭拒，改為 `uncertain`；有相應年增資料、新聞原文或明示限制的合理推論仍保留。四份回答仍是 limited，整體判斷皆為 uncertain。證據為同一 run 的 `replay-pipeline4-guard.json` 與 `review-quality.json`；沒有再付費生成，也沒有將原始實驗結果改寫成修正後成績。已知阻擋解除，可做有限範圍上線驗收。

最終後端回歸 956 項通過，排除 [既有驗證限制](../docs/README.md#已知驗證限制) 所述的 `test_contract.py`。前端 lint、`test:chat`、`test:compare`，以及新聞卡片、API、列表 hook、簡報 evidence／facets 測試通過；包含空段落呈現、歷史版本連結及產業背景說明。差異格式檢查通過。

仍未全面解決的語義問題包括：台積電短期方向被寫成「取決於美股半導體」但只引用本地行情；聯發科的模型限制欄位出現「傳統估值指標失效」的無支持判斷。它們說明自由文字因果、比較基準及財務口徑尚未完整驗證；少數規則通過不能換成「內容均有證據」的保證。

## 5. 重算與部署界線

舊重算程序已停止，已提交資料保留；中斷點以正式 DB 對帳，不以最後一行 log 推定完成。新維護程序固定 runtime，支援文章／簡報之間的停止 checkpoint，避免一個工作混用工作區變更。

公司辨識規則進入事件 config hash（`company_recognition=mentions-v2`）。現行 reader 採完全相同的 config hash；沒有未經驗證的相容改標。因此舊事件結果全部待新版重算，不能宣稱只重算 7 組修訂就完成。原始新聞與 embedding 未改者沿用向量；事件 metadata 更新與正文改動分開處理。

13 篇有明確 worklist 的小批測試已完成，包含 7 組選版、錯公司、淡季產業風險與一般個股案例：12 成功、1 失敗，14 次呼叫，設定費率估算 0.0225682 USD。失敗文章 `b7a820222b61038c1f4ecee5bd916c9a` 兩次引句都不是原文，保留 failed，不將重試當成功。

13 篇對應 17 個 chunk 已定向同步，missing／unavailable／stale 向量均為 0。SQL 再核對全部文章 input/config hash；長榮航事件沒有錯掛公司 2603，淡季文章得到有原文支持的產業 impact。定向 sync 在 SQL 分頁前篩選 ID，不會清空未選文章的 metadata，也不重做 embedding。

接著補上通用產業背景路徑：必須有目前事件、相符產業與精確引句，且片段／標題沒有其他公司名。新 `candidate-postpilot.json` 的 12 組檢索已驗證：長榮兩日期淡季風險恢復，標為 `industry_context`；折舊保留、長榮航專文仍被排除；台積電除息與既有聯發科 TPU 風險覆蓋未變。另修正 `collect()` 遺失原始時區的問題；現在保留有 offset、無 offset 與僅日期的差異。

最新支援股票與原本已有的歷史簡報日期各自對帳，不擴張為上市以來每日生成。新背景控制程序先更新 41 檔最新簡報，再跑剩餘事件、同步 metadata、刷新最新與既有歷史日期，最後對帳與恢復排程；中途失敗或有人要求停止就保留檢查點。

2026-09-28 19:26（台灣時間）操作狀態：442 個產品檔案已封存並逐檔核對，`nq-source-20260928-final.zip` SHA-256 為 `6f19a50d688da0f7055f61acc83f3119b1d0759d902565a2c477c2b12f98bcf6`。已送出 Windows UAC 提權部署，但尚未進入部署腳本，沒有部署成功紀錄。API／前端仍使用既有 release，兩個服務 Running；`stock-jobs-v2` 保持 Stopped。

正式切換後才執行新版 API／前端檢查及全量重算。新版目前只有上述 13 篇試算與 17 個 chunk 同步完成，尚未啟動新全量 controller；不能將舊批次成功筆數當成新版完成數。後續狀態以 `nq-deployment-status.json`、`nq-production-check.json`、`nq-controller.json` 與最終 `nq-reconciliation.json` 為準。

## 6. 已知限制與保留設計

- `verified` 僅代表程式規則通過，不是獨立事實查核或投資方向正確。
- 自由聊天保留數字與引用驗證、增加來源歸屬提示，但尚無完整因果語義驗證；不能宣稱與結構化關鍵日具有同等保證。
- 月營收／具名聲明的有限共同事實分組保留所有來源及額外資訊，因此不宣稱節省模型 token 或候選名額，也未達任意事件聚類。
- 歷史首次公開／修訂時間未知仍明確標示；移轉舊資料不會補出不存在的時間證據。
- 當日行情與盤後消息可以同時呈現，但不自動推導利多出盡、提前反應或股價原因。
- 模型輸出仍具有隨機性；一次正確回答不能抵銷第二次生成的錯誤。

保留向量候選、SQL 有效性核對、原文精確引句、可追溯歷史及明確降級。下一步優先順序是讓正式有效 metadata 完成重算、確認風險召回，再決定是否擴充分組與查詢策略；目前沒有證據支持導入另一套模型或 reranker。
