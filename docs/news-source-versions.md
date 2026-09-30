# 新聞來源修訂與有效版本

## 契約

`news_articles.article_id` 保持可查；目前文章更新前後的標題、正文、URL、發布日期、內容種類保存於 `news_article_versions.snapshot_json`。`revision_id` 由 article ID 與內容 hash 決定，相同內容重抓不新增版本。`news_source_selections` 以來源與保守 canonical URL 的 SHA256 作唯一主鍵，每組只有一個有效 article ID；`news_source_decisions` 記錄可回復的選擇。

只移除 fragment、`utm_*` 與已知追蹤參數；其他 query 保留順序和值，不將不同內容頁合併。已知 CNYES article URL 可統一 http／https；不同媒體不因相似文字共用來源鍵。

來源同 URL 的歷史內容相異時，migration 標示 conflict，不按建立時間或字數選數字。完全相同的版本才使用穩定 ID 去重，這不代表該 ID 較真實。明確選定後，其他 ID 標示 superseded，仍保留原文與歷史引用。新聞列表的 count 與 page 使用同一 SQL 有效來源條件；detail 回傳 `source_state`，失效來源不掛現行 impacts。

歷史原文可用 `/news/{article_id}?revision_id={revision_id}` 查詢。API 核對該 revision 所屬 article ID 與保存的內容 hash；不存在或不同文章的 revision 回 404，資料損壞回 503，不回退成目前正文。回應標示 historical 並移除現行 AI 事件分析，前端保留 query、顯示版本狀態與觀察時間，也提供目前文章連結。

完整正文的等長與縮短更正均可更新。共同更新函式原子更新標題／正文，不將拒收的新標題配舊正文。摘要不能覆蓋完整正文；空白、已知驗證／拒絕頁、長文突然只剩不足 30 字均拒收。這是可核對的擷取失敗防護，不能辨認所有偽裝錯誤頁；極短的合法更正須人工核對後處理。CNYES refresh 必須取得同一 JSON-LD 的 headline／articleBody，缺 headline 不用舊標題拼接新正文。

## 必要操作順序

API 啟動不建表。新程式部署前，先在固定程式版本下備份，執行 dry-run、檢視衝突與受影響 ID，再明確 migration。沒有新 schema 的 runtime 查詢會失敗，不默默略過來源核對。以下命令從 `backend/` 執行，使用當次目標環境設定；僅 `--help` 不連資料庫：

```powershell
.venv/Scripts/python.exe -m app.jobs news-source-versions --help
.venv/Scripts/python.exe -m app.jobs news-source-versions
.venv/Scripts/python.exe -m app.jobs news-source-versions --apply
.venv/Scripts/python.exe -m app.jobs news-source-versions --choose SOURCE_KEY ARTICLE_ID --reason "Publisher correction notice and verification reference"
.venv/Scripts/python.exe -m app.jobs news-source-versions --rollback DECISION_ID --reason "Why the latest decision is being reversed"
```

預設 dry-run 不改 schema／資料，輸出 canonical 群組、版本 hash／長度、已知觀察時間、選擇依據及 chunk／analysis／snapshot IDs，不輸出正文。讀取使用批次查詢；migration 以 500 筆批次寫入，不逐文章查映射。DDL 建表可能無法由 MySQL transaction 回復，因此需先備份；migration 資料部分有交易且可重跑。選擇與回復也有交易；只能回復同來源最新決定，防止覆蓋後續判斷。

選版不會自動呼叫付費模型、刪向量或刪快照。後續依受影響清單更新 chunk、impact、向量及簡報；SQL source eligibility 在同步期間阻擋失效 ID。新向量未驗證前保留舊向量以便恢復。Snapshot IDs 是已保存 evidence_catalog 內可追溯的引用，不保證涵蓋未記錄引用的舊產物。

## 時間與限制

歷史匯入的 `observed_at` 為 null，`recorded_at` 才是 migration 记录時間；不以 migration 當天假造首次可得時間。這些來源可供回顧，但一律有歷史修訂未知、非已驗證 point-in-time 的限制。

歷史分析依新聞 `pub_time` 與截止時間篩選，使用目前有效的來源選版與正文。`observed_at` 保留真實取得／更正時間，僅供追溯，不阻擋晚匯入的歷史新聞，也不倒推修改時間。發布時間無法解析或晚於截止時間時排除。衝突與被取代來源仍排除，版本 hash 與向量內容驗證不變。這是依發布時間回顧，不保證還原當時原文；現在更正過的內容可能影響歷史簡報。

目前只有本機離線驗證，尚未執行正式 migration、選版、重算或部署。離線命令：

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_news_versions.py backend/tests/test_crawlers.py backend/tests/test_news_impact.py -q
```
