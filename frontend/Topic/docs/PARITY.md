# PARITY.md — 股海明燈前端決議紀錄

- 前端重寫（2026-09-22～24）時確認過的決議。程式註解裡的「決議 Dx／cxx」都指向這裡的「決議紀錄」與附錄 (c)；「決議 F1」指向最後的「收藏股」一節。
- 附錄 (a)、(c) 描述的是舊前端（`frontend/topictest`，已刪除）當時的狀況；目前的做法以「決議紀錄」為準。
- API 契約以根目錄的 `openapi.json` 為準。這個檔案被 `.gitignore` 排除、不在版控，用之前先跑 `npm run sync:openapi` 從後端下載最新版。
- 「2026-10-08 核對」的補充來自逐條核對，那次的決定見最後的「逐條核對（H1）」。

---

## 附錄 (a)　舊前端用到、但 openapi.json 沒有的欄位

「後端原始碼」一欄是我讀 `backend/app/features` 的結果，只供參考，不代表可以直接採用。

| # | 欄位 | openapi.json | 後端原始碼 |
|---|---|---|---|
| a1 | POST /api/ask body 的 `user_token`（塞進 JWT） | AskRequest 只有 query、stock_id、stream、answer_detail、history | chat/schemas.py 沒有這個欄位，Pydantic 會直接忽略 |
| a2 | `/api/ask` 在 `stream: true` 時的 SSE 事件：`type` = status／text／dashboard／done／error，以及 content、message、answer、actions、dashboard 欄位；前端另外容錯 `text`、`delta`，JSON fallback 還會讀 `text／content／response／message／raw_answer` | 只描述非串流的 AskResponse | chat/service.py 會送 status／text／dashboard／done／error（用 content、message），done 事件展開整個 AskResponse；`delta`、`raw_answer`、`response` 等從來不送 |
| a3 | GET /stocks/{symbol}/integrated-chart 的 `price_volume[]`、`institutional_trades[]`、`technical_indicators[]` 的內部欄位（foreign_buy…total_institutional_net、ma5…volume_ma5 等），以及 fallback 讀的舊名 `foreign_excl_dealer_net`、`dealer_net_total`、`total_net` | 三個陣列都只寫 `object[]`，沒有欄位 | market/service.py 有送這些欄位，另外還有 `trust_net`、`total_net`；technical_indicators **沒有** boll_* 與 ma120／ma240 |
| a4 | 技術指標的替代欄位名：`macd`、`macd_histogram`、`rsi14`、`rsi_14`（被當成 rsi10 用）、`k`、`d`、`j`、`boll_mid_20`、`boll_upper_20`、`boll_lower_20` | 沒有 | 沒有 |
| a5 | candlestick-ma 的 `moving_averages` 內部鍵 `MA5`、`MA10`、`MA20`、`MA60` | 只寫 `object` | market/service.py 用 `f"MA{period}"` |
| a6 | text-brief `evidence_catalog[]` 的額外欄位：period、kind、title、yoy_pct、mom_pct、qoq_pct、pct_rank_1y、last4q、yoy_last6、url、publisher、published_at、collected_at、publication_basis、calculation；value 為物件時的 close、chg_pct、vol_lots、vol_vs_ma5_pct、foreign_net_lots；以及 16 種 `field` 值（daily_timeline、foreign_net_10d_lots、high_1y、low_1y、close_pos_in_1y_pct、vs_ma60_pct、vs_ma240_pct、eps、gross_margin_pct、operating_margin_pct、revenue_monthly、revenue_yoy_positive_streak、per、pbr、dividend_yield、news） | StockBehaviorEvidenceItem 只列 id、field、date、value，另設 `additionalProperties: true`（允許但沒有命名） | analysis/evidence.py 有產生（source_type 除外） |
| a7 | evidence 的 `source_type` | 沒有 | 沒有 |
| a8 | News `sentiments[].label` 的值：positive／negative／neutral／mixed／insufficient | 只寫 `string` | news/sentiment.py 是這 5 個值的 Literal |
| a9 | GET /stocks/symbols 回應容錯 `{ symbol }` 物件 | 定義為 `string[]` | — |
| a10 | 型別不一致（欄位都存在，列出來確認策略）：openapi 把 DailyPriceResponse 的 open／high／low／close／change、PriceStatistics 的價格、TechnicalIndicatorResponse 全部欄位定義成 `string`（Decimal），舊前端型別寫成 number，再用 toNum 轉 | string | — |

## 附錄 (b)　openapi.json 有、但舊前端沒用到的端點（只列出，不實作）

「回傳內容」取自 openapi.json 的 schema；「注意事項」是我讀後端原始碼的補充。

| # | 端點 | 回傳內容 | 注意事項 |
|---|---|---|---|
| b1 | GET /stocks/{symbol}/chart/chips-volume | 每日收盤、成交量、三大法人買賣超（ChipsVolumeData） | 後端跟舊前端有用的 `/volume-with-chips` 呼叫同一個函式，是重複端點。〔2026-10-06 後端已刪除這支端點〕 |
| b2 | GET /stocks/{symbol}/fundamentals/financial-statements | 財報科目列（statement = income／balance／cashflow，item_type、origin_name、value） | 基本面，舊版完全沒有這類畫面 |
| b3 | GET /stocks/{symbol}/fundamentals/monthly-revenues | 月營收（revenue、revenue_year、revenue_month） | 同上；AI 分析的證據目錄內部有用到月營收，但前端沒有直接抓 |
| b4 | GET /stocks/{symbol}/fundamentals/valuations | 每日本益比 per、股價淨值比 pbr、殖利率 dividend_yield | 同上 |
| b5 | GET /stocks/{symbol}/fundamentals/dividends | 股利政策（現金／股票股利、除權息日、發放日等 20 個欄位） | 同上 |
| b6 | GET /stocks/{symbol}/fundamentals/dividend-results | 除權息結果（除權息前後價、參考價） | 同上 |
| b7 | GET /stocks/{symbol}/chips/margin-trades | 融資融券（買賣、餘額、限額、資券相抵） | 籌碼面，舊版只做三大法人 |
| b8 | GET /stocks/{symbol}/chips/foreign-shareholding | 外資持股（持股數、持股比率、投資上限；另有 `stock_name` 欄位） | `stock_name` 理論上能取代寫死的中文名（c47），但等於新增一支 API 呼叫 |
| b9 | GET /stocks/{symbol}/chips/holding-share-levels | 股權分散表（持股分級的人數與比例） | 籌碼面 |
| b10 | POST /analyze/stock-behavior/rag | 某檔股票近期的新聞來源清單 | text-brief 在後端內部已經會做這一步，前端不需要另外呼叫 |
| b11 | GET /api/trend_predict | 迴歸趨勢線、AI 預測未來價格、方向、`ai_confidence`（1–5）、`target_price` | 後端只支援 6 檔（2330、2317、2454、2881、2408、2615）；會給目標價與信心分數，跟 AI 分析「刻意不給目標價」的設計、以及不自創分數的原則衝突 |
| b12 | GET /api/analysis_digest | 週／月分析摘要 | `digest`、`technical` 在 openapi 只寫 `object`，裡面欄位沒有定義，要用就會碰到「API 欄位不可臆造」規則 |
| b13 | GET /api/trend_predict_stream | b11 的串流版（init／node／done／error 事件） | 同 b11；串流事件格式也不在 openapi |
| b14 | POST /api/analyze | 多檔股票的新聞來源（news_sources、no_recent_news） | 後端檢索服務的底層端點，和 b10 性質相近 |
| b15 | GET /api/simulate_trading_stream | LLM 逐日決策的回測串流（init／day／done 事件，done 附績效指標） | 舊 K 線圖「策略標記」（c11）看起來原本是為這種回測資料設計的；串流事件格式不在 openapi |
| b16 | GET / | 歡迎訊息、版本、docs 路徑 | 系統端點，前端用不到 |
| b17 | GET /health | `{"status": "healthy"}` | 健康檢查，給部署或監控用，前端用不到 |

有用到但沒用到某些參數的端點（參考）：`/news` 的 article_id、source；`/api/ask` 的 `stock_id` 永遠送 null、`answer_detail` 永遠送 plain（程式支援但畫面沒有入口）；text-brief 的 `force_refresh` 從未使用。

## 附錄 (c)　疑似 bug、死碼或設計奇怪的地方

### c-A　顏色語意（跟紅漲綠跌規則有關）

| # | 內容 |
|---|---|
| c1 | 新聞情緒徽章寫死 Tailwind 色：正面用 emerald（綠）、負面用 rose（紅），跟台股「紅＝正向」相反；mixed 用 amber、neutral 用 slate、insufficient 用 zinc |
| c2 | 其他寫死的 Tailwind 色：CompareHero 的 danger 用 red-500、warn 用 amber；CorrelationHeatmap 的「分散效果有限」用 amber；新聞內文引用句高亮用 amber-300（light mode 對比很差） |
| c3 | 錯誤狀態全部借用 `--color-up`（紅＝漲色）：表單錯誤框、API 錯誤、欄位紅框、登出按鈕、「清空全部」hover；成功狀態借用 `--color-down`（綠＝跌色）：忘記／重設密碼成功圖示、複製成功勾勾；`--color-success-*` 的數值也等於跌色；sonner 的 richColors toast 用自己的紅綠 |
| c4 | 用漲跌色表達好壞：相關性分散效果 good 用紅、weak 用綠；方法面板「n 項提醒」徽章用綠；AI 摘要面向 good 用紅、caution 用綠（評價「偏低」紅、「偏高」綠），「風險」區塊標題是綠色 |
| c5 | MA60 線色 `#6B9B7E` 幾乎等於跌色 `#649a7e`，MA120 `#C47B7B` 接近漲色；AI 對話的圖表 series 也拿這組顏色，容易被看成漲跌 |
| c6 | 顏色跟著欄位而不是數值：區間最高固定紅、最低固定綠（KPI 列、統計面板、歷史表高低欄）；最大單日漲固定紅、跌固定綠；法人買進量固定紅、賣出量固定綠 |
| c7 | 漲跌為 0 時顯示紅色「+0.00」（`change >= 0` 視為上漲）；模擬下單損益與收益率 `>= 0` 也是紅色 |
| c8 | RSI ≥ 70 標成紅色「偏多」／「超買偏多」，多股比較卻標「RSI 超買」，同一指標兩種說法 |
| c9 | 相關性熱力圖圖例漸層中間是綠色（hsl 95），跟格子實際用的色階函式不一致 |

### c-B　功能 bug

| # | 內容 |
|---|---|
| c10 | MA 週期選擇器有 import 但沒有 render，`ma_periods` 永遠是 5,10,20,60；TradingChartSection 的 maPeriods、onMaPeriodsChange、maSelectorDisabled、compactChart 都是固定值或沒用到 |
| c11 | K 線圖「策略標記」整段是死碼：資料轉換永遠回傳 `markers: []` |
| c12 | RSI 圖 70／30 參考線的 markLine 放在 option 最外層而不是 series 裡，ECharts 不會畫 |
| c13 | 「法人累積買賣超（張）」標題寫張，實際資料單位是股 |
| c14 | K 線圖初始可視範圍固定「今天往前 6 個月」，資料卻是 max_date 往前 3 個月；資料不是最新時畫面右側可能空白 |
| c15 | 股票搜尋：輸入文字後用方向鍵選某一項再按 Enter，送出的是輸入文字，不是選中的那一項 |
| c16 | 多股比較完成後再增刪股票，相關性、法人對比、技術快照用新的已選清單，其他區塊還是舊結果，資料會錯位 |
| c17 | 模擬下單：判斷可賣張數用的是沒轉大寫的代號，跟實際查詢不一致；可賣張數查詢失敗被當成 0，顯示「請先買進」而不是錯誤 |
| c18 | 在 `/me` 從主選單抽屜登出，不會離開頁面，畫面上的使用者資料也不會消失 |
| c19 | 註冊：姓名在前端是必填，但 API 的 display_name 是選填（`normalizedName \|\| null` 永遠不會是 null）；註冊與 Google 註冊都忽略 returnUrl，登入頁連到註冊也不帶 returnUrl |
| c20 | AI 分析的 as_of_date 等於圖表結束日：在價量抽屜改結束日期會觸發重抓 AI 分析 |
| c21 | 整合圖表的技術指標沒有布林通道，所以「缺布林就補抓」永遠成立，每次都多打一次 /technical-indicators |
| c22 | 首頁 sparkline 用 toISOString（UTC）算日期，其他地方用本地時間，台灣早上 8 點前會差一天 |
| c23 | 歷史股價表在 total < pageSize 時顯示「後端目前最多回傳 N 筆」，文案跟實際情況不符；這張表不受日期區間限制，卻放在籌碼抽屜而不是價量抽屜 |
| c24 | 技術快照拿 compare/multiple 的最後收盤去比 technical 最後一列的 MA，兩者日期可能不同；K > D 標成「KD 黃金交叉」（這是狀態，不是交叉事件） |
| c25 | 比較指標把區間第一天的 change_percent 也算進去（那是相對區間前一天的漲跌），回撤、波動、勝率多算一天；勝率分母包含非有限值 |
| c26 | 新聞頁用了沒有定義的 `--color-bg-base`，以及沒安裝 typography 外掛的 `prose prose-invert` |
| c27 | 證據詳情的原始網址直接當 href，沒有檢查 http／https（其他地方都有檢查），後端若回 `javascript:` 就是 XSS |

### c-C　死碼與未使用

| # | 內容 |
|---|---|
| c28 | AI 對話的假打字（simulateTyping）與 loadingMode='mock' 永遠不會啟用 |
| c29 | buildInsightCards、CompareInsightCard、viewModel.insights 沒有人用（已被類別冠軍取代）；compare 頁呼叫 mapTechnicalLatestFromList 後丟掉結果；snapshotGridClass 的 n===3 分支與預設相同 |
| c30 | StockHeader 的第二排指標（成交量、成交金額、成交筆數、RSI10、法人合計）因為 hideSecondary 永遠不顯示；非 compact 模式也沒被用到 |
| c31 | 沒用到的 CSS：.ui-input、.glow-card、.text-glow、.ui-alert-success、.text-success-emphasis、.bg-success-muted、.border-success、float-gentle／gradient-shift／border-glow keyframes、`--font-editorial`（Noto Serif TC 也沒載入） |
| c32 | 沒用到的 props、變數、import：CompareMetricsTable 的 calcVersion、DetailDrawer 的 headerActions、SubpageHeader 的 rightExtra 與 backBehavior='home'、NewsAdvancedFilters 的 layout='panel'、BentoCell 的 rowSpan 與 wrapperClassName、AnimatedSection 的 stagger、TopNewsCard 的 linkable、新聞頁的 CheckCircle2 與 ShieldAlert、首頁的 symbolsReloadRef。〔現況：`BentoCell`（`features/home/BentoGrid.tsx`）已隨首頁改版刪除〕 |
| c33 | 沒用到的依賴：dotenv、sass；a11y-axe-scan.mjs 需要 playwright 與 @axe-core/playwright，但 package.json 沒有；eslint-config-next 有裝，但 lint 實際跑的是 tsc |
| c34 | Pages Router 下沒作用的 `'use client'` |
| c35 | 重複實作：代號 hash 取色函式重複 7 份；fmtVolume 與 formatVolumeShares 相同；toYmdLocal 與 getLocalDateString 相同；safeUrl 類函式 3 份 |
| c36 | 過時註解：client.ts 提到 stockBehaviorAnalyze 的 90s／120s；stockBehaviorTextBrief.ts 提到「Next 代理的 maxDuration」（專案裡沒有 API proxy） |

### c-D　文案與資料

| # | 內容 |
|---|---|
| c37 | 多股比較的 meta description 寫「多維分數雷達」，頁面上沒有雷達圖，而且跟「不自創分數」原則衝突 |
| c38 | 頁尾免責寫「模擬下單相關資料僅存於您的瀏覽器，不蒐集可識別個人資料」，跟事實不符：委託會送到後端，登入時還用 email 當 user_id |
| c39 | 「委託下單」標題旁的「（連線後端）」字樣 |
| c40 | 價量走勢固定寫「資料截至前一交易日」，沒有依資料判斷 |
| c41 | 收盤 > MA20 > MA60 顯示「持平偏多」，措辭奇怪 |
| c42 | 結論方向 mixed 翻成「偏中性」（textBriefLabels 的立場 mixed 是「多空交雜」） |
| c43 | 忘記密碼頁的 title 是「重設密碼」，路由標籤是「忘記密碼」 |

### c-E　安全與隱私

| # | 內容 |
|---|---|
| c44 | 聊天請求把 JWT 放進 body 的 `user_token`，但後端不用它，等於白白多送一次 token（同 a1） |
| c45 | 模擬下單 API 沒有驗證，user_id 是任意字串；登入後用 email 當 user_id，所以 email 會出現在 GET 的 query string，知道別人 email 就能讀他的委託（根本問題在後端） |
| c46 | JWT 存在 localStorage（程式註解已經提到 XSS 風險） |

### c-F　需要你決定的設計

| # | 內容 |
|---|---|
| c47 | 19 檔股票中文名寫死在前端（API 沒有名稱欄位），其他股票只顯示代號 |
| c48 | AI 摘要的 5 個面向分級（強／普通／弱、偏高／偏低、買超／賣超）門檻是前端自訂的：EPS 年增 15%、本益比近一年百分位 70／30、相對季線 ±3%。這不是 0–100 分數，規則也有揭露，但跟「不自創綜合分數」規則相關，請確認要不要保留 |
| c49 | 結構化回覆的「市場情緒」徽章是用關鍵字（看漲、偏多、📈…）判斷的 |
| c50 | 前端內部把欄位改名：foreign_net → foreign_excl_dealer_net、dealer_net → dealer_net_total、total_institutional_net → total_net。新版要沿用，還是直接用 openapi 的名稱？ |
| c51 | `/stock/[id]` 會把 16～64 位 hex 當成新聞 id 轉到 `/news/{id}`（舊連結相容），要不要保留？ |
| c52 | 首頁頁首沒有獨立的主題切換鈕（只在抽屜裡），子頁頁首則同時有抽屜和切換鈕 |
| c53 | 量能表、漲跌表、歷史表、法人明細都預設收合，要點開才看得到 |
| c54 | 有些測試斷言綁在實作細節上：CSS class `[overflow-wrap:anywhere] text-pretty`、`role="img"`、body 裡的 `user_token: null`。新版如果改樣式或拿掉 user_token，這些斷言也要跟著改 |
| c55 | 整合圖表的內部欄位不在 openapi 裡（a3）。另一個選擇是個股頁直接改用有型別的 /institutional-trades、/technical-indicators、/volume-with-chips（舊版的 fallback 本來就是這樣做） |

### c-G　Phase 2 驗證時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c56 | 個股頁的 og:title／og:description／og:type 出現兩份：`_app` 的預設值在前、頁面的在後。Next 的 `<Head>` 只會用 `name` 去重，`property` 不會，所以爬蟲讀到第一個（站台預設）。舊版一樣。建議：兩邊的 og 標籤都加相同 `key` |
| c57 | HTTP 504 的錯誤訊息有錯字「請請後端管理者」，舊版一樣。建議改成「請後端管理者」 |
| c58 | D9-c20 把 AI 基準日固定為 max_date 後，同一檔只會打一次，AI 分析的「更新中」「更新失敗加重試」兩種提示已經不會出現。要保留程式（無害）還是視為死碼拿掉？ |
| c59 | 指標訊號小卡的 KD 文字已改成「K 在 D 之上／K 在 D 之下／K、D 黏合」（舊版「K 上穿 D／K 下穿 D／黏合」）。理由同 c24（這是狀態，不是交叉事件），但 c24 原本只講多股比較頁，這裡是我延伸套用、沒有另外問過。要維持新文案還是改回舊的？ |
| c60 | 歷史股價表不帶日期時，後端只回傳預設區間（2330 實測 total = 22），分頁永遠是 1／1。與舊版相同。要維持，還是改成帶圖表的日期區間（行為改變）？ |
| c61 | 籌碼「區間流向」圖有兩個圖例：上方靜態圖例加 ECharts 內建的可點圖例，內容重複。舊版一樣。建議只留 ECharts 的可點圖例 |
| c62 | KPI「法人合計（股）」的數值單位是「萬股」，標題的（股）和數值單位對不上。舊版一樣。建議標題改成「法人合計」 |
| c63 | 均線結構在 MA20 或 MA60 沒有值時，舊版會落到「盤整」，新版改成顯示「無資料」。這是我在移植時順手修的，沒有先問。要維持還是改回？ |

### c-H　Phase 4 首頁驗證時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c64 | 即時股價全部載入失敗時，「重試載入」重新抓的是股票清單；清單有 30 秒快取、回傳同一個陣列，所以 30 秒內按重試不會重抓股價，看起來沒反應。另外清單若回傳空陣列，股價區會一直顯示骨架。舊版一樣。建議：重試直接重抓股價；清單為空時顯示「目前沒有可顯示的股票」 |
| c65 | 首次載入整個網站都沒有進場動畫：`AppShell` 的 `AnimatePresence initial={false}` 會讓底下所有 motion 元件略過初始動畫，只有站內換頁後才看得到（首頁的 Bento 捲入進場、個股頁的 `AnimatedSection` 都是）。舊版一樣。要維持，還是讓首次載入也有進場動畫（只改動畫，不影響功能）？ |

### c-I　Phase 4 新聞頁與文案稽核時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c66 | 新聞頁讀取失敗時，頁首副標仍顯示「載入中...」。舊版一樣。建議改成「無法讀取新聞」 |
| c67 | 從個股頁或新聞卡（帶 `?stock=代號`）打開新聞時，後端只回傳那一檔的情緒分析；如果那一檔沒有分析、但其他檔有，側欄會顯示「尚無 AI 情緒分析記錄」，也沒有切換鈕可以看其他檔。舊版一樣。建議：抓新聞時不帶 stock，拿到全部情緒後，若有該檔就預先選它 |
| c68 | 原文依據引句的標點：Phase 2 移植時我把新聞卡的 `"…"` 改成「…」，沒有先問；已改回 `"…"`，新聞頁也用 `"…"`。建議兩處都改用「…」（中文排版慣例）。〔已由決議 c68 取代：兩處都改用「…」〕 |

### c-J　Phase 4 AI 對話驗證時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c69 | 手機版 `/ai` 往下捲超過 300px 後，全站的「回到頁面頂部」浮動鈕會蓋在對話輸入框的送出鈕上，點送出可能變成捲回頂部。舊版一樣。建議：`/ai` 不顯示這顆按鈕（對話頁本來就會自動捲到最新訊息） |

### c-K　Phase 4 模擬下單驗證時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c70 | 確認委託對話框送出中時，「取消」、「確認送出」都 disabled，Esc 和點背景也關不掉，但右上角的 X 仍然可以關閉。關掉後請求照樣完成（toast「模擬下單成功」、清空表單），只是看不到對話框裡的轉圈。舊版一樣，目前照舊版。建議：送出中把 X 也 disabled，跟其他關閉方式一致 |

### c-L　Phase 4 多股比較驗證時新發現（2026-09-23 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c71 | c25 的延伸：後端 price-change 第一天的 change_percent 實際回 0（實測 2330 在 2026-06-23 漲跌 −20 元，change_percent 卻是 0）。c25 已讓比較指標表不算這一天，但相關係數、資料品質的「有效樣本」與「共同交易日」仍把這個 0 算進去（兩檔同一天都是 0，會稍微拉高相關係數；共同交易日多算 1 天）。目前照 c25 的範圍只改指標表。建議：相關係數與樣本數也不算第一天（例如 3 個月區間的共同交易日會從 66 變 65） |
| c72 | 法人資料載入失敗的警告寫「法人對比與「法人最愛」會顯示 —」，但「法人最愛」是舊版已經不用的卡片名稱，現在叫「法人合計買超最高」。建議改成「法人對比與「法人合計買超最高」會顯示 —」 |
| c73 | 漲跌資料（price-change）載入失敗時，平均量、平均金額也一起變成 --，即使成交資料已經成功載入；這跟警告文字「漲跌資料載入失敗：將影響報酬、波動、回撤、勝率與相關性」、「成交資料載入失敗：將影響平均量與平均金額」不一致。建議：平均量與平均金額只看成交資料 |
| c74 | 比較主圖全部隱藏時的提示寫「請用下方圖例重新開啟或按「重設」」，但畫面上沒有「重設」鈕，按鈕叫「全顯示」。建議改成按「全顯示」 |
| c75 | 比較進行中按「清空全部」，股票與結果先清掉，但等資料回來後結果又出現（已選清單是空的）。目前照舊版。建議：清空全部時一併取消進行中的比較，結果不再回來 |
| c76 | 股票代表色依代號 hash 從 16 色取，不同代號可能拿到很接近的顏色：實測 2330 是 #1d4ed8、2454 是 #2563eb，兩個都是藍色，在主圖與散點圖幾乎分不出來。建議：依比較清單的順序分配顏色（第 1 檔用第 1 色…），同一次比較裡保證 6 檔都不同色、全頁一致；代價是同一檔在不同組合裡的顏色可能不同 |

### c-M　Phase 4 登入相關頁驗證時新發現（2026-09-24 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c77 | 重設密碼頁「確認新密碼」欄的顯示切換鈕，未顯示時的無障礙名稱是「顯示密碼」，跟上面「新密碼」欄的按鈕同名，螢幕閱讀器分不出是哪一欄（顯示後才變成「隱藏確認密碼」）。註冊頁同一顆按鈕叫「顯示確認密碼」。目前照舊版。建議改成「顯示確認密碼」 |
| c78 | 從登入頁（帶 returnUrl）點「立即註冊」會帶著 returnUrl（c19），但在註冊頁點「返回登入」就不帶了，回到登入頁後登入會回首頁而不是原本要去的頁面。建議：註冊頁的「返回登入」也帶上 returnUrl（同樣經過安全檢查） |

### c-N　Phase 4 個人中心驗證時新發現（2026-09-24 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c79 | 變更密碼的三個顯示切換鈕都是 tabIndex -1（鍵盤到不了），無障礙名稱也都叫「顯示密碼」，分不出是哪一欄；登入、註冊、重設密碼頁的切換鈕都能用鍵盤操作。目前照舊版。建議：可以用 Tab 操作，名稱分別叫「顯示目前密碼」「顯示新密碼」「顯示確認新密碼」（隱藏時同理） |
| c80 | 在個人中心按「重新整理資料」時如果登入已過期（401）：API client 會清掉登入，頁面顯示錯誤與 toast 後就變成「導向登入中…」，但實際上不會導向，停在那裡。舊版一樣，目前照舊版。建議：跟一進頁面就 401 的處理一致，清除登入後導到 /login?returnUrl=/me |

### c-O　最終檢查時新發現（2026-09-24 已決議，見決議紀錄）

| # | 內容 |
|---|---|
| c81 | 個股 AI 分析抽屜裡的「載入中骨架」「錯誤＋重試」「還沒有產生 AI 分析＋重新載入」三個狀態，畫面上走不到：摘要卡只有在已有資料時才提供「查看完整分析」入口，抽屜打開後也不會重新載入。舊版一樣。建議：保留（防呆，不影響畫面），不改 |
| c82 | 專案的 openapi.json 跟後端目前的版本不同：後端替 5 個 TextBrief schema（Claim、ForwardView、KeyDay、Risk、WatchPoint）的 evidence_ids 加了限制（每項 ≤ 16 字、格式為 d／ch／lt／fd／nw 加底線與數字、最多 6 個）；端點、欄位、型別都沒變，前端不受影響。驗證時跑過 `npm run sync:openapi` 比對後已還原，沒有更新。建議：更新 openapi.json，讓唯一依據跟後端一致。〔已由決議 c82 取代：openapi.json 已同步〕 |

---

## 決議紀錄（2026-09-22）

「使用者回覆」照原話記錄；「解讀」是我依回覆採取的做法，若理解有誤請直接更正。

| 決議 | 範圍 | 使用者回覆 | 解讀與做法 |
|---|---|---|---|
| D1 | a1、c44 `user_token` | 不管 | 維持舊版行為：照送 `user_token`，`ragAsk.test.ts` 的斷言不動。〔已由 H1 取代：2026-10-08 拿掉 `user_token`，測試斷言一併改〕 |
| D2 | a2 SSE 事件 | 照建議 | 只解析後端實際會送的 status／text／dashboard／done／error 與 content、message、answer、actions、dashboard；JSON fallback 只讀 `answer`；拿掉 `delta`、`raw_answer`、`response` 等。〔2026-10-08 核對：done 事件另外讀 `sources`；JSON fallback 實際讀 answer、actions、dashboard、sources（`lib/api/ragAsk.ts`）〕 |
| D3 | a3、c55 整合圖表 | 照建議 | 個股頁改用 `/institutional-trades`、`/technical-indicators`、`/volume-with-chips` 三支有型別端點，不再呼叫 `/integrated-chart`（連帶解決 c21） |
| D4 | a4、a7、a9 | 照建議 | 拿掉替代欄位名、`source_type`、`/stocks/symbols` 的物件容錯 |
| D5 | a5、a6、a8 | 照建議並且保留 | 沿用 `moving_averages` 的 MA 鍵、`evidence_catalog` 的額外欄位與 field 值、情緒 label 的 5 個值；型別註明「openapi 未列、依後端實作」。〔2026-09-30 後端移除新聞情緒分析（68fc1b9），情緒 label 一項已不適用〕〔2026-10-06 新增，使用者回覆「P1-01 同意用 /news/industries，補進 D5」：新聞篩選的產業下拉選單使用 `GET /news/industries`。openapi 的回應 schema 是空的，形狀依後端 `news/service.py` 的 `industries()` 寫成 `{ items: [{ id, name }] }`（`lib/types/api.ts` 的 `NewsIndustriesResponse`；`lib/api/news.ts` 的 `fetchNewsIndustries` 略過形狀不對的項目）。後端替這支端點加上 `response_model` 後重跑 `sync:openapi`，改成照 schema 抄，並拿掉這一項例外〕〔2026-10-08 新增，使用者要求處理驗證規則盤點的遺留項：AI 分析 `forward_views.*.validation_status`（只有 `"rejected"` 或 null）。後端 `analysis/schemas.py` 的 `TextBriefForwardView` 用 `SkipJsonSchema` 隱藏，因為 `StockBehaviorTextBrief` 同時是給模型的輸出 schema，放進 schema 會讓模型自己填；只有伺服器檢查該期間展望不通過時才設成 rejected。前端型別在 `lib/types/textBrief.ts` 的 `ForwardView`，標籤在 `lib/brief/textBriefLabels.ts` 的 `forwardViewLabel`（顯示「內容未通過檢查」）。後端把回應與模型輸出拆成兩個 schema 後，改成照 openapi 抄，並拿掉這一項例外〕 |
| D6 | a10 | 照建議 | API 層型別照 openapi 寫成 string，在 mapper 轉成 number |
| D7 | (b) 17 個端點 | 需要更多解釋 → 看完補充後回覆「D7 確認，繼續」 | 已補在附錄 (b) 的「回傳內容」與「注意事項」；確認不實作。〔2026-09-25 起多股比較使用 b2–b4（`lib/api/compareFundamentals.ts`）；b5 已從後端移除〕〔2026-10-08 核對：b1 與 `/simulated-orders` 也已在 2026-10-06 從後端刪除，openapi.json 已同步移除〕 |
| D8 | c1–c9 顏色 | 照建議 | 新聞情緒徽章改用 token（正面 up、負面 down，其餘中性）；錯誤／成功／警告另立 token，不再借用漲跌色；寫死的 Tailwind 色（red、amber、emerald、rose、slate、zinc）全部換成 token；顏色依數值正負而不是依欄位，0 顯示中性；MA60、MA120 換成非紅綠色；RSI ≥ 70 統一稱「超買」、≤ 30 稱「超賣」，不用漲跌色表示好壞；熱力圖圖例與色階一致。實際色值在 Phase 1 提案（原始提案未留存於 docs/，以 `styles/main.css` 與 `lib/charts/theme.ts` 為準）〔2026-10-08 核對：新聞情緒徽章已隨情緒分析移除；同一套正負上色規則現在用在新聞影響方向（`lib/utils/newsImpact.ts`）〕 |
| D9 | c10–c27 bug | 全部修正 | c10 補上 MA 週期選擇器；c11 策略標記不移植；c16 結果一律用上次比較的清單；c19 註冊姓名改選填、註冊後依 returnUrl 導向；c20 AI 分析基準日固定用 max_date；c23 歷史股價表移到價量抽屜；其餘 c12–c15、c17、c18、c21、c22、c24–c27 直接修正。〔最終稽核 2026-09-24〕c22 當時漏改，D13 補上〔2026-10-06 AI 分析請求不再帶 as_of_date，改跟著後端最新的資料（`lib/hooks/useStockTextBrief.ts`）；c20 固定基準日一項已不適用〕〔2026-10-08 核對：c13 的標題與數值是依 G1 一起換算成「張」；c17 隨舊模擬下單刪除，已不適用〕 |
| D10 | c28–c36 死碼 | 全部修正 | 不移植。〔最終稽核 2026-09-24〕c35 的 safeUrl 類函式還剩兩份（`safeHttpUrl`、`safeDashboardUrl`），D13 合併成 `safeHttpUrl`；c34 新加入的 shadcn 元件（checkbox、collapsible、popover、sheet、toggle-group）自帶 `'use client'`，屬於 shadcn 原始碼，保留不改 |
| D11 | c37–c43 文案 | 全部修正 | 新文案見下方「文案修正」 |
| D12 | c45、c46 | 不管 | 維持舊版現狀：登入後仍用 email 當模擬下單 user_id；JWT 仍存 localStorage。〔2026-10-08 H1 維持 localStorage，這是專題範圍內接受的取捨：被 XSS 偷到 token 就能操作模擬投資、收藏與通知〕〔2026-10-04 `/order` 改成登入制的模擬投資（`/paper-portfolio`，依 token 辨識帳戶），舊模擬下單程式（`useSimulatedIdentity` 等）已刪除，email 當 user_id 一項已不適用〕 |
| c47 | 寫死中文名 | 幫我判斷 | 保留。API 沒有名稱欄位；b8 雖有 `stock_name`，但要多打一支 API，而且屬於新用法。寫死表只影響顯示，查不到就顯示代號，不會顯示錯誤資料。〔已被取代：名稱改由 `/stocks/info` 提供（`lib/utils/symbolNames.ts`）〕 |
| c48 | AI 摘要面向分級 | 幫我判斷 | 保留。每一格只拿一個標準指標（EPS 年增率、本益比近一年百分位、相對季線、外資近 10 日淨買賣、AI 列出的風險數）套固定門檻，門檻與原始數字都顯示在畫面上，缺資料就寫「資料不足」；不是合成的 0–100 分數，符合「不自創綜合分數」規則。〔2026-10-08 H1 使用者確認維持現狀。現況：原始數字直接顯示，門檻收在「分級規則（點開看門檻）」裡；情境風險沒有項目時寫「未列出」；沒有 EPS 時改看單月營收年增，沒有本益比時改看股價淨值比；門檻在 `lib/brief/textBriefFacets.ts` 的 `FACET_RULES`〕 |
| c49 | 關鍵字判斷情緒徽章 | 幫我判斷 | 保留。判斷的是 AI 在「市場情緒」段落自己寫的字（看漲、看跌…），等於把 AI 原話做成徽章，不是前端推論行情；拿掉會少一個舊功能。〔已被取代：徽章已拿掉（0189325），「市場情緒」段落直接顯示原文，不做關鍵字判斷（`features/ai/RagStructuredReply.tsx`）〕 |
| c50 | 內部欄位改名 | 幫我判斷 | 改成直接用 openapi 原名（foreign_net、dealer_net、total_institutional_net）。只影響程式內部，畫面不變；少一層對照，也跟 D3 一致 |
| c51 | hex id 轉新聞頁 | 幫我判斷 | 保留。成本很低、維持舊連結相容；新聞 id 與 4～6 位數股票代號不會衝突 |
| c52 | 首頁頁首的主題切換 | 幫我判斷 | 首頁頁首也放 ThemeToggle，跟子頁一致。主題切換是既有功能，這只是版面調整，不算新功能 |
| c53 | 表格預設收合 | 都可以 | 維持舊版：預設收合。〔2026-10-08 核對：法人歷史明細已改成直接顯示（04-S6）；量能、漲跌、歷史股價三張表仍預設收合〕 |
| c54 | 綁實作細節的測試 | 先確定還用不用得到，用不到就先移除 | 檢查結果：舊的整合圖表轉換測試依 D3 已不存在，不移植；其餘 7 支舊測試仍適用，其中 `ragAsk.test.ts` 的 `user_token: null` 依 D1 保留、`markdown.test.tsx` 的 class 是 Tailwind v4 原生 utility、`ChatDashboard.test.tsx` 的 `role="img"` 是無障礙語意，新版照樣沿用，斷言都不必改。`npm run test` 改跑新的 mapper 測試，和三支有型別端點的 mapper 一起寫。〔現況：這支 mapper 測試不在版本庫；`npm test` 改成等同 `npm run test:all`，見根目錄 `README.md` 的「測試與建置」〕〔2026-10-08 核對：測試已有數十支；`ChatDashboard.test.tsx` 的 `role="img"` 只剩一處反向斷言；`user_token` 斷言已依 H1 拿掉〕 |
| c56 | og 標籤重複 | 全部都按照你的建議（2026-09-23） | `_app` 與各頁的 og:title、og:description、og:type 加相同 `key`，頁面自己的值蓋掉預設 |
| c57 | 504 錯字 | 同上 | 「請請後端管理者」改成「請後端管理者」。〔現況：錯誤訊息已依 D13 的 B1 改成通用文案，這句不再出現（`lib/api/userFacingError.ts`、`lib/api/errorDetail.ts`）〕 |
| c58 | 「更新中」「更新失敗」提示 | 同上 | 照 D10 視為死碼移除：hook 拿掉 `refreshing`，摘要卡與完整分析拿掉兩種提示，重試鈕不再需要自己的載入狀態〔2026-10-06 請求不再帶 as_of_date（見 D9），同一檔仍只打一次，結論不變〕 |
| c59 | KD 文字 | 同上 | 維持「K 在 D 之上／K 在 D 之下／K、D 黏合」；Phase 4 多股比較頁用同一組文字。〔最終稽核 2026-09-24〕多股比較的黏合當時仍是「KD 黏合」，D13 統一成「K、D 黏合」 |
| c60 | 歷史股價表只有 1 頁 | 同上 | 維持舊行為（不帶日期），不改成帶圖表區間。〔已被取代：2026-10-01（#78）起歷史股價改帶圖表的日期區間並分頁（`lib/hooks/useStockDashboard.ts`）〕 |
| c61 | 區間流向重複圖例 | 同上 | 拿掉上方靜態圖例，只留 ECharts 可點圖例。`components/charts/ChartLegend.tsx` 因此沒人使用，使用者同意後已刪除（2026-09-23）〔2026-10-08 核對：「區間流向」這個圖已改名為「三大法人每日買賣超（張）」〕 |
| c62 | 「法人合計（股）」單位不符 | 同上 | KPI 標題改成「法人合計」。〔2026-10-08 核對：標題現在是「三大法人合計」，單位依 G1 改成張，單位不符的問題已不存在〕 |
| c63 | 均線結構缺值 | 同上 | 維持新版：MA20 或 MA60 沒有值時顯示「無資料」，不再落到「盤整」。〔已被取代：回傳「無資料」的 `getMaStructureLabel` 沒有畫面使用，2026-10-08 依 H1 刪除；畫面上的均線結構與目前趨勢在 `components/charts/PriceChart.tsx`，缺值時顯示「資料不足」〕 |
| c64 | 股價重試與空清單 | c64、c65 都照建議，繼續（2026-09-23） | 「重試載入」改成直接重抓股價，不經過有 30 秒快取的股票清單；清單為空時顯示「目前沒有可顯示的股票」。〔現況：這個做法所在的 `features/home/useFeaturedQuotes.ts` 已隨首頁改版刪除；首頁觀測台的每個區塊各自重試（`features/home/terminal/useTerminalData.ts` 的 `useLoadable`），空清單的文字是「目前沒有股票資料，請稍後再來看。」〕 |
| c65 | 首次載入的進場動畫 | 同上 | 上次只列了兩個選項、沒寫明建議；採用「首次載入也有進場動畫」：拿掉 `AppShell` 的 `AnimatePresence initial={false}`，只影響動畫 |
| c66 | 新聞頁錯誤時的副標 | c66～c68 都照建議，繼續（2026-09-23） | 讀取失敗時副標顯示「無法讀取新聞」 |
| c67 | 新聞頁只看得到指定股票的情緒 | 同上 | 抓新聞時不帶 stock，拿到全部情緒後，若 query 的股票有分析就預先選它，否則選第一筆。〔已被取代：新聞情緒分析已移除；現在抓新聞時會帶 stock，依事件分析的 company impacts 選股（`pages/news/[id].tsx`）〕 |
| c68 | 原文依據引句的標點 | 同上 | 新聞卡與新聞頁的引句都改用「…」。〔2026-10-08 核對：新聞頁改用 blockquote，不加引號；只有新聞卡用「…」〕 |
| c69 | `/ai` 的回到頂部按鈕 | c69 照建議，繼續（2026-09-23） | `/ai` 不顯示回到頂部按鈕，其他頁照常（已驗證）。〔現況：首頁 `/` 也不顯示（`components/layout/AppShell.tsx`）〕 |
| c70 | 確認委託對話框送出中的 X | c70 照建議，繼續（2026-09-23） | 送出中右上角 X 也 disabled，跟取消、Esc、點背景一致；送出成功後對話框照常關閉（已驗證）。〔現況：確認委託對話框已隨舊模擬下單畫面刪除，見 F2〕 |
| c71 | 第一天漲跌幅的延伸 | c71～c76 都照建議，繼續（2026-09-23） | 相關係數、有效樣本、共同交易日也不算區間第一天（3 個月區間的共同交易日從 66 變 65） |
| c72 | 法人失敗警告的卡片名稱 | 同上 | 改成「法人對比與「法人合計買超最高」會顯示 --。」 |
| c73 | 平均量與平均金額 | 同上 | 只看成交資料；漲跌資料失敗時照樣顯示 |
| c74 | 全部隱藏時的提示 | 同上 | 改成「請用下方圖例重新開啟或按「全顯示」。」 |
| c75 | 比較中按清空全部 | 同上 | 清空全部時取消進行中的比較，結果不再回來，載入狀態一併重設 |
| c76 | 股票代表色撞色 | 同上 | 依比較清單順序取 6 色（橘、藍、紫、青、洋紅、褐黃），同一次比較不撞色、全頁一致。〔現況：色組改成藍、紫、青、洋紅、褐、灰藍，避開接近燈色的橘與琥珀（`lib/charts/theme.ts` 的 `COMPARE_SYMBOL_COLORS`）〕 |
| c77 | 重設密碼頁確認欄的切換鈕名稱 | c77、c78 都照建議，繼續（2026-09-24） | 改成「顯示確認密碼」／「隱藏確認密碼」 |
| c78 | 註冊頁「返回登入」的 returnUrl | 同上 | 有安全的 returnUrl 時帶上，沒有或不安全時連到 /login |
| c79 | 個人中心密碼欄的顯示切換鈕 | c79～c82 都照建議，PARITY.md 保留（2026-09-24） | 可以用 Tab 操作；名稱分別為「顯示／隱藏目前密碼」「顯示／隱藏新密碼」「顯示／隱藏確認新密碼」 |
| c80 | 個人中心重新整理時登入過期 | 同上 | 清除登入並 replace 到 /login?returnUrl=/me，跟一進頁面就 401 一致 |
| c81 | AI 分析抽屜走不到的三個狀態 | 同上 | 保留，不改 |
| c82 | openapi.json 與後端不同步 | 同上 | 已執行 `npm run sync:openapi` 更新；只有 5 個 TextBrief schema 的 evidence_ids 多了限制，前端型別不用改。〔2026-10-08 核對：openapi.json 不在版控，同步只存在本機；H1 又同步了一次〕 |
| — | PARITY.md 是否保留 | 同上 | 保留在 `docs/`，作為功能對照與決議紀錄 |
| D13 | 上線前稽核（2026-09-24）的修繕範圍 | 勾選表：必修 A1 open redirect、A2 手機 AI 免責（免責位置：輸入框下方固定一行）；上線後可補 B1 錯誤訊息改使用者文案（全部改成通用文案）、B4 Vercel Analytics（部署平台：自架 next start，移除 Analytics）、B6、B7、B8、B11、B12；修繕範圍：只修前端；功能缺漏 C1 PARITY 文件同步、C2（c35）、C3（c7）、C4（c59，黏合用語：K、D 黏合）；AI06 做法：只修正 PARITY 描述。追問：後端中文訊息「保留中文訊息」；套件「只刪程式碼」；中性卡片「改成一般文字色」；首頁精選股「2317，2330，2454，2881，2408，2615」 | 見下方「上線前稽核修繕（D13）」。沒勾的不動：B2 模擬下單驗證（c45，需後端）、B3 API 網址缺值時 build 失敗、B5 自訂 404（維持 Next.js 預設 404）、B9 開發環境改測試後端、B13 後端串流端點驗證、c34 的 shadcn `'use client'`。〔2026-10-08 核對：B2 已不適用（後端 `/simulated-orders` 已刪）；B5 已有自訂 404（`pages/404.tsx`）；首頁精選股已不存在（見 B10）；套件一項改成移除 `@vercel/analytics`；B3、B9 經 H1 確認維持不動〕 |

### 文案修正（D11）

| # | 位置 | 舊文案 | 新文案 |
|---|---|---|---|
| c37 | 多股比較 meta description | 同時比較多支台股的走勢、法人、技術指標與多維分數雷達，協助快速比對相對強弱與分散程度。 | 同時比較多支台股的走勢、報酬與風險、法人籌碼、技術指標與相關性，協助快速比對相對強弱與分散程度。〔現況（`pages/compare.tsx`）：結合產業背景，以共同期間比較多檔台股的價格漲跌、波動、回撤、法人買賣超與相關性。〕 |
| c38 | 頁尾免責 | 本網站為展示與學習用途，不構成投資建議；模擬下單相關資料僅存於您的瀏覽器，不蒐集可識別個人資料。 | 本網站為展示與學習用途，不構成投資建議。模擬下單紀錄會儲存在本站伺服器：未登入時以瀏覽器產生的匿名 ID 識別，登入後以帳號 Email 識別。〔現況：模擬下單已由模擬投資取代（F2），頁尾改為「模擬投資使用虛擬資金，交易與決策紀錄存在你的帳號裡。」〕 |
| c39 | 模擬下單「委託下單」標題 | （連線後端） | 拿掉。〔現況：「委託下單」標題已隨舊模擬下單畫面刪除，見 F2〕 |
| c40 | 價量走勢說明 | 資料截至前一交易日；展示用途，非投資建議。 | 資料截至 {最後一根 K 線的日期}；展示用途，非投資建議。〔現況：這句已不存在；個股頁頁首寫「收盤 {日期} · 非即時 · 非投資建議」，K 線區塊標出實際畫出的期間〕 |
| c41 | K 線圖「目前趨勢」 | 收盤 > MA20 > MA60：持平偏多；收盤 < MA20 < MA60：持平偏空 | 收盤 > MA20 > MA60：偏多（多頭排列）；收盤 < MA20 < MA60：偏空（空頭排列）；其他維持「區間整理」 |
| c42 | AI 分析結論方向 mixed | 偏中性 | 多空交雜（與立場標籤一致） |
| c43 | 忘記密碼頁 title | 股海明燈｜重設密碼 | 股海明燈｜忘記密碼 |

### 上線前稽核修繕（D13）

| # | 問題（稽核證據） | 改法 | 位置 |
|---|---|---|---|
| A1 | `safeReturnUrl` 只擋 `//` 與 `://`；headless Chrome 實測 `router.push('/\t/evil.example/phish')` 導到 `http://evil.example/phish`（換行同樣成功，反斜線被 Next 正規化擋下） | 拒絕控制字元與 `\`，用 URL 解析確認同源，只回傳 pathname+search+hash；新增 `returnUrl.test.ts` | lib/utils/returnUrl.ts |
| A2 | 375 寬時 `/ai` 副標被截成「個股、多股比較、技術指標與…」，頁尾在手機隱藏，看不到免責 | 輸入框下方固定一行「AI 回覆僅供研究參考，不是投資建議。」（taiwan-stock-ux 的 AI 免責文案）〔commit bdd8d3a 曾移除這一行；2026-10-10 依評審意見恢復，見 J1〕 | features/ai/ChatInput.tsx |
| B1 | 後端斷線時各頁顯示「網路錯誤（常見為 CORS…）請確認 API 網址為根路徑（不含 /docs）…」；AI 分析錯誤附後端網址與 HTTP 代碼 | 前端自己寫的訊息全部改成通用文案；後端的中文 detail 保留，英文依狀態碼換成通用文案；13 處畫面直接顯示 `err.message` 的地方改用 `userFacingMessage`〔2026-10-08 核對：畫面已沒有直接顯示 `err.message` 的地方〕 | lib/api/client.ts, errorDetail.ts, userFacingError.ts, ragAsk.ts, features/ai/useChat.ts 與各頁 |
| B4 | 自架時 `/_vercel/insights/script.js` 會 404（建置產物有引用） | 拿掉 `<Analytics />` 與 import（`@vercel/analytics` 仍留在 package.json）〔2026-10-08 依 H1 從依賴移除〕 | pages/_app.tsx |
| B6 | c22 沒修 | 改用 `toYmdLocal`。〔現況：首頁股價卡已刪除，這個檔案沒有呼叫端，已一併刪除〕 | lib/utils/sparklineHistory.ts（已刪除） |
| B7 | 類別冠軍數值一律品牌橘，負報酬也是橘色 | `CategoryLeader` 加 `tone`；有方向的三格依正負 up／down，其餘一般文字色 | lib/types/compare.ts, lib/utils/compare.ts, features/compare/CategoryLeaders.tsx |
| B8 | AI 輸入沒有長度上限，超過 6000 字後端回 422 | maxLength 6000，剩 500 字內顯示字數 | features/ai/ChatInput.tsx |
| B10 | 首頁精選是清單最前面 6 檔（1101～1109） | 固定 2317、2330、2454、2881、2408、2615；「更多股票」改取不在精選裡的前 12 檔。〔2026-09-24〕使用者要求移除「更多股票」區塊；精選 6 檔改排在搜尋下拉最前面。〔現況：`features/home/useFeaturedQuotes.ts` 已刪除，首頁改成旅程加觀測台（`features/home/journey/`、`features/home/terminal/`），程式裡已沒有固定的精選清單〕 | features/home/useFeaturedQuotes.ts（已刪除）, pages/index.tsx |
| B11 | `/stock/9999` 標題「股海明燈｜9999 9999」（19 檔以外的股票都會重複） | `formatStockLabel`／`getStockName`：查不到中文名只顯示代號。〔現況：程式裡已沒有 `getStockName`，只剩 `formatStockLabel`；中文名由 `useStockDisplayName`（`/stocks/info`）提供〕 | lib/utils/symbolNames.ts 與 7 個使用處 |
| B12 | 11 支測試只有 2 支有 npm script | 新增 `test:all`，CLAUDE.md 指令表同步。〔2026-10-08 依 H1：`test:all` 改成依序跑所有 `test:*`，CI 補上 `test:favorites`；CLAUDE.md 已沒有指令表，只留一段說明〕 | package.json, CLAUDE.md, .github/workflows/ci-cd.yml |
| C2 | c35 還剩兩份 safeUrl 函式 | 刪掉 `safeDashboardUrl`，改用 `safeHttpUrl` | lib/types/chatDashboard.ts, lib/utils/markdown.tsx, features/ai/ChatDashboard.tsx |
| C3 | c7：模擬下單損益為 0 仍顯示「+」 | 0 不加「+」；收益率先取到兩位小數再判斷。〔2026-10-04 舊模擬下單畫面已刪除，見 F2〕 | features/order/OrderTables.tsx（已刪除） |
| C4 | c59：多股比較仍是「KD 黏合」 | 統一成「K、D 黏合」 | lib/utils/indicatorSignals.ts（`compareSignals.ts` 只是 re-export）, lib/utils/compare.test.ts |
| C1 | PARITY 前後矛盾與過時描述 | 本次各列加註〔決議 D13〕或〔最終稽核〕 | docs/PARITY.md |

### 收藏股：openapi.json 手寫段落（F1，2026-10-02）

| # | 內容 | 後續 |
|---|---|---|
| F1 | 收藏股端點還沒部署，無法跑 `npm run sync:openapi`。`openapi.json` 裡的 `/favorites/`（GET）、`/favorites/{symbol}`（PUT、DELETE）與 `FavoriteStockResponse`、`FavoriteStockListResponse` 是依 `backend/app/features/favorites/router.py`、`schemas.py` 手寫的，格式照 FastAPI 0.115 的輸出（含 `HTTPBearer` security、未帶 token 的 403） | 後端部署後跑 `npm run sync:openapi`，再用 `git diff openapi.json` 比對這一段；有差異以下載結果為準，並同步 `lib/types/api.ts` 與 `lib/api/favorites.ts`，確認後把這一列標成已同步。〔openapi.json 不在版控，`git diff` 比對不到；要比對得先備份舊檔〕〔2026-10-02 已同步：從 production 下載，favorites 的路徑與 schema 與手寫版本完全相同〕 |

### 模擬投資與通知：openapi 同步與舊下單程式（F2，2026-10-04）

| # | 內容 | 後續 |
|---|---|---|
| F2 | 從 production 跑 `npm run sync:openapi`，`openapi.json` 補上 `/paper-portfolio`（5 支）、`/notifications`（3 支）、`/api/conversations`（3 支）共 11 個路徑（15 個 operation）；`AskResponse.actions` 多了 `PaperOrderDraft`，`JobActionRequest` 多了 `symbol`。前端的通知、對話型別與 schema 一致。`/paper-portfolio` 的路由沒有 `response_model`，openapi 的回應 schema 是空的，`lib/api/paperPortfolio.ts` 的回應型別依 `backend/app/features/paper_portfolio/service.py` 的 `snapshot`／`_order`（同 D5 的例外，型別上註明）。舊模擬下單程式（`OrderTables`、`ConfirmOrderDialog`、`OrderEstimate`、`estimate.ts`、`useSimulatedIdentity`、`lib/api/simulatedOrder.ts`、`SimulatedOrder*` 型別）已沒有頁面使用，一併刪除；後端 `/simulated-orders` 端點原本不動〔2026-10-06 刪除：該端點不需登入、可用任意 user_id 讀寫，且前端已不使用；`simulated_orders` 資料表與 `SimulatedOrder` 模型保留，舊資料不動。`openapi.json` 下次 `sync:openapi` 時會移除這 4 支〕 | 後端替 `/paper-portfolio` 加上 `response_model` 後重跑 `sync:openapi`，把回應型別改成照 schema 抄，並拿掉這一項例外。〔2026-10-08 依 H1 重跑 sync，`/simulated-orders` 已從 openapi.json 移除〕 |

### 股數單位：改用「張」（G1，2026-10-06）

| # | 內容 | 後續 |
|---|---|---|
| G1 | 審查 00 的 P1-21 決定股數改用「張」（04-U2、05 用語表）：成交量、法人買賣超在個股頁、首頁觀測台、多股比較、圖表與 AI 資料面板的法人表都顯示整數張，同一欄不再切換股／萬股／億股。使用者決定不滿 1 張的非零值寫「不到 1 張」、不帶號、不上漲跌色。API 單位仍是股，換算在 `lib/utils/format.ts`、`lib/charts/adapters.ts` 與後端 `chat/dashboard.py` 的 `_lots`。模擬投資的持股、委託數量維持股 | 已存進資料庫的舊 AI 對話面板仍是股，不回填。〔圖表 tooltip 寫「不到 1」不帶「張」，因為表頭已有單位（`lib/charts/adapters.ts`）〕 |

### 逐條核對（H1，2026-10-08）

使用者要求逐條核對本文件與程式，看看有沒有過時或有問題的決議。文件和程式不一致的地方，都已在上面各列補上「2026-10-08 核對」。需要重新決策的項目，使用者的選擇如下（「照建議」是使用者回覆「全部都照建議」）。

| # | 範圍 | 使用者選擇 | 做法 |
|---|---|---|---|
| H1-1 | D1 `user_token` | 拿掉 | `lib/api/ragAsk.ts` 不再送 `user_token`，`ragAsk.test.ts` 的斷言一併改 |
| H1-2 | D12、c46 JWT 存 localStorage | 維持並寫明取捨 | 不改程式；取捨寫在 D12 |
| H1-3 | c48 面向分級門檻 | 維持現狀 | 門檻照舊收在「分級規則」裡；現況寫在 c48 |
| H1-4 | openapi.json 是否進版控 | 維持排除 | 照舊靠 `npm run sync:openapi`；本次已重跑：移除 `/stocks/{symbol}/chart/chips-volume`、`/simulated-orders` 的 4 個 operation 與 6 個 SimulatedOrder schema，補上 `GET`／`POST /admin/stocks` 與 `AddStockRequest`，其他端點與 schema 沒有變動 |
| H1-5 | D13 B3 API 網址缺值 | 維持現狀 | 正式 build 沒設 `NEXT_PUBLIC_API_URL` 時仍改用 `127.0.0.1:8003`（`lib/apiBase.ts`），不讓 build 失敗 |
| H1-6 | D13 B9 開發環境的後端 | 維持打正式後端 | `.env.development` 照舊指向正式後端；本機測試的模擬投資、收藏、通知會寫進正式資料庫 |
| H1-7 | 測試涵蓋 | 照建議（兩項都做） | CI 補上 `test:favorites`；`test:all`（即 `npm test`）改成依序跑所有 `test:*` |
| H1-8 | D13 B4 `@vercel/analytics` | 照建議 | 從依賴移除 |
| H1-9 | c63 `getMaStructureLabel` | 照建議 | 結果沒有被使用，刪掉 `lib/utils/technicalSignals.ts` 與 `buildFacets` 的 `maStructureLabel` 參數，畫面不變 |
| H1-10 | `/admin` 回應型別 | 照建議（S1） | `/admin` 的 GET 都沒有 `response_model`，openapi 的回應 schema 是空的；`lib/api/admin.ts` 的型別依 `backend/app/features/admin/service.py`，同 D5 的例外，檔案開頭有註明。後端加上 `response_model` 後重跑 `sync:openapi`，改成照 schema 抄，並拿掉這一項例外 |

### 評審意見：免責聲明與 AI 成效（J1，2026-10-10）

評審要求「平台顯著位置加註投資免責聲明、風險提示」，以及「建立評估機制，評估 AI 給的建議有沒有成效」。使用者選擇：免責聲明加上首次造訪提示；AI 成效做命中率加上使用者回饋。

| # | 內容 | 位置 |
|---|---|---|
| J1-1 | 新增「投資免責聲明」頁（服務性質、資料來源、AI 限制、模擬投資、系統性風險、責任歸屬），頁尾導覽加連結；頁尾的風險提示改用一般文字色 | pages/disclaimer.tsx, lib/nav.ts（`FOOTER_NAV`）, components/layout/SiteFooter.tsx |
| J1-2 | 首次造訪提示：固定在畫面底部，按「我已了解」後記在 localStorage（`tei:risk-notice-ack:v1`），聲明有實質修改時改版本號；儲存空間不可用時照樣顯示。不是對話框，不鎖焦點 | components/layout/RiskNoticeBanner.tsx, lib/riskNotice.ts |
| J1-3 | 恢復 D13 A2：AI 對話輸入框下方固定一行免責並連到免責頁；模擬投資頁頂端加虛擬資金與「過去不代表未來」的提示。所有文案集中在 `lib/disclaimers.ts` | features/ai/ChatInput.tsx, pages/order.tsx |
| J1-4 | AI 判斷回顧：後端 `GET /analyze/stock-behavior/track-record` 拿已存的 AI 摘要（`llm_responses`）三個區間的立場，對照基準日後第 5、20、40 個交易日收盤算命中率，附「每次都猜漲」基準。只計入基準日後 4 天內產生的摘要（排除事後重跑），中性、分歧、不確定不列入命中率；少於 10 次方向判斷時讀數改淡色、不和基準比較。個股頁在 AI 摘要下方顯示；後台顯示全站 | backend app/features/analysis/track_record.py, features/brief/AITrackRecordCard.tsx, lib/brief/trackRecord.ts |
| J1-5 | AI 對話回饋：新資料表 `chat_message_feedback`（每則完成的回覆一筆），`PUT`／`DELETE /api/conversations/{id}/messages/{message_id}/feedback`，`SavedMessage` 多 `feedback`。串流的 done 事件不帶訊息 id，前端在回合結束後重讀對話補上 `serverId`，有 id 才顯示回饋鈕；訪客不顯示。後台 `GET /admin/ai-feedback` 顯示有幫助比例、回饋率與最近的「沒有幫助」回覆 | backend app/db/models/chat_feedback.py, app/features/conversations/, app/features/admin/ai_feedback.py, features/ai/ChatMessage.tsx, features/ai/useChat.ts, features/admin/AIEffectivenessPanel.tsx |
| J1-6 | `openapi.json` 這次不是從正式後端 `sync:openapi`（新端點還沒部署），是用本機後端 `create_app().openapi()` 產生後合併，`ValidationError` 維持原檔版本（本機 FastAPI 版本不同） | 後端部署並執行 `init-schema` 建立 `chat_message_feedback` 後，重跑 `npm run sync:openapi` 比對 |
