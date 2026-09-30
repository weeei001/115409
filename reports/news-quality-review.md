# 新聞品質與 AI 個股分析調查

調查日期：2026-09-27（台灣時間）  
範圍：正式資料庫 `topic_stock`、目前使用的新聞向量索引、資料收集到回答生成流程，以及已保存的個股分析。此次未修改產品程式或資料庫。

## 一、結論

**使用者的觀察部分成立，但問題不是「資料庫大多是沒用的行情新聞」。本次六股近期檢索明顯集中於行情主體文章；流程未充分處理同一事件、公司歸屬與消息時間，回答有時又把價格描述寫成原因。**

主要證據如下：

1. **全庫抽樣中，約 10.0% 是以價格／成交量／資金流為主、缺乏具體非價格事件的報導；另有 15.6% 是行情與實質事件混合。** 這來自依來源及時期分層的 180 篇全文判讀，不是標題關鍵字統計。約七成主要報導公司、財務、產業或政策；這不代表七成都正確、新穎，或適合某檔股票。
2. **六檔股票實際取得的 120 個分析素材中，57.5% 來自行情主體文章，但其中多數含有營運資訊。** 實際檢索選出的片段有 20 個（16.7%）僅提供價格類資訊。必須分開「全文」與「取到的片段」：有營運內容的文章，仍可能只取到漲跌段落。
3. **重複問題主要在事件層次。** 全庫正文完全相同、只忽略空白的多餘列為 183／35,918（0.51%）；六股原始檢索的 120 個素材，分別在各股內按主要事件歸組，組數合計 91。後者不表示可直接刪掉 29 篇，而是同一事件占用多個名額，應合併相同事實並保留新增細節。
4. **已有實際回答把不相干月份的新聞引用到較早的關鍵日，把盤後營收與當日收盤連成「利多出盡」，或用「族群走強」解釋個股上漲。** 引用 ID 存在，不等於引用內容足以支持因果。
5. **找到「股價上漲 → positive 事件標籤」與「價格共振 → 原因敘述」兩種問題；尚未找到完整三段循環的確證。** 現行個股簡報不直接讀取事件的 positive／negative 標籤，因此不能把不同管線的問題拼成「該標籤導致簡報預測上漲」的結論。
6. **事件導向檢索有改善，也有代價。** 六股對照把純價格片段由 16.7% 降到 9.6%，但仍有錯公司與事件重複，也漏掉供應鏈風險、除息等重要內容。兩股、六次真實模型生成顯示：增加事件資訊會改變回答；完全不給新聞會失去產業風險，卻未消除臆測市場動機。

**優先改善順序：消息時間與主張支持 → 公司歸屬與來源版本 → 同事件合併、依問題配置新聞 → 再評估更複雜的排序或資料來源。** 不建議先全面刪除開盤、盤中、盤後或「焦點股」新聞。

## 二、調查方式與適用範圍

### 2.1 實際讀取哪一份資料

開發資料庫 `topic_stock_dev` 沒有新聞，不能用來回答本題。本次讀取正式設定所指向的 `topic_stock`，以 `REPEATABLE READ`、`READ ONLY`、`WITH CONSISTENT SNAPSHOT` 取得固定快照，結束後 rollback。快照時間為 **2026-09-27 15:52:30**。

| 資料 | 快照筆數 | 用途 |
|---|---:|---|
| `news_articles` | 35,918 | 全庫分布、抽樣全文、來源與重複 |
| 新聞 SQL chunks | 50,496 | 切塊與版本核對 |
| `news_event_analyses` | 2,499 | 事件抽取與設定版本 |
| `news_event_impacts` | 3,805 | 正負影響理由 |
| `stock_info` | 40 | 目前支援股票 |
| `llm_responses` | 2,339 | 已保存的個股分析 |

程式基準為 commit `570d444e07a98819c048b82b2f44d609278fd553`；已對照正式部署目錄的相關產品流程檔案，內容相同，檢索與生成實驗也直接載入該正式目錄。資料庫內的歷史回答橫跨不同設定，不能全部當成此版本的表現。

**版本界線：調查期間，共用工作目錄出現了其他尚未提交的產品修改。本報告沒有修改或覆寫它們，也未評估其修正效果。文中的「目前／現行」均指上述調查基準；程式連結已改為該 commit 的本機唯讀證據副本，避免隨工作目錄變動而指到不同內容。**

另外執行了 Qdrant 唯讀完整掃描、六股真實向量檢索，以及兩股各三種新聞條件的模型呼叫。模型實驗直接組裝證據並呼叫原供應商，不走會保存回答的產品流程；沒有執行爬蟲、資料遷移、索引寫入或分析儲存。

本報告中的「新聞寫了某數字」與「回答引用了某事實」，首先是**資料庫與引用忠實度的證據**，不等於已逐條向公司公告查證財務真實性。少數來源修訂案例另外核對了原網站，會明確標示。

### 2.2 全庫內容抽樣

母體是快照中的全部 35,918 篇。依來源 × 三個時期分層，按比例分配 180 篇，每層至少一篇；各層使用固定種子 `news-quality-review-20260927:` 加 `article_id` 的 SHA-256 排序取樣，避免依標題挑出符合假設的文章。

| 來源 | 發布時期 | 母體 | 樣本 |
|---|---|---:|---:|
| 鉅亨 | 2024–2025 | 14,265 | 71 |
| 鉅亨 | 2026 上半年 | 5,400 | 27 |
| 鉅亨 | 2026 第三季，截至 9/27 | 3,562 | 18 |
| 自由財經 | 2024–2025 | 93 | 1 |
| 自由財經 | 2026 上半年 | 7,065 | 35 |
| 自由財經 | 2026 第三季，截至 9/27 | 5,533 | 28 |
| **合計** | | **35,918** | **180** |

三個調查代理分工讀取完整儲存正文，採同一分類準則；另挑 17 個邊界案例交叉複核，修正一例。這是可追溯的定性標註，**不是獨立人類盲評，也未估計評分者一致性**。以下占比依各層母體權重計算，四捨五入至一位小數；小樣本與判讀邊界使其適合描述量級，不適合解讀成精確到小數點的全庫真值。

| 類別 | 判定依據：讀正文，不只讀標題 | 樣本數 | 加權占比 |
|---|---|---:|---:|
| P：價格描述為主 | 價格、成交量、法人流量、籠統題材；未交代具體非價格事件 | 18 | **10.0%** |
| M：行情與事件混合 | 以漲跌／盤勢切入，但有營收、訂單、政策、公司說法、可歸屬的展望等 | 28 | **15.6%** |
| E：公司／事件為主 | 主要內容是財務、公司、產業、政策等，可能附帶價格 | 127 | **70.5%** |
| O：其他 | 生活、個人理財等，缺乏直接可用公司事件 | 6 | **3.3%** |
| I：內容不足 | 儲存正文不足以判斷或支持標題承諾的資訊 | 1 | **0.6%** |

P 不等於任何情境下都無用，M 不保證事件首次出現，E 也不保證可信或有新增資訊。**本次不能給出全庫「語意上沒有任何新資訊」的單一可靠百分比**：那需要按事件時間串連全庫，判斷何者首次披露、何者補充、何者改正。可確認的是純價格類的量級、完全重複的下限，以及實際檢索中的事件重疊。

## 三、`news_articles` 實際裝了什麼

### 3.1 分布與來源偏差

新聞發布時間從 **2024-09-11 到 2026-09-27**。鉅亨 23,227 篇（64.7%）、自由財經 12,691 篇（35.3%）；不是多種獨立研究來源的完整集合。

正文沒有空值案例；字數中位數 641，第 25／75 百分位約 455／885，最短 63、最長 6,969。資料包含營收速報、公司法說、財報、產業政策、國際總經、開盤盤中盤後行情、投顧盤勢文章、選股宣傳與其他財經生活內容。

幾個會影響判讀的資料特徵：

- **歷史覆蓋並不均勻。** 鉅亨在 2024-10 至 2026-08 每個月恰有 900 篇；自由財經從 2025-12 才出現。32,346 篇（90.1%）的 `created_at` 在 2026-09-11，符合集中匯入的表面特徵。這是資料分布事實，不能由此推定新聞造假或日期遭修改；也不能把本次占比當成整體市場新聞供給的占比。
- **`content_kind` 不能當成已完成品質分類。** `unknown` 33,338、`full_text` 2,320、`summary` 260；`unknown` 主要承接舊資料預設值，不等於沒正文。260 篇 summary 都是近期鉅亨資料。欄位標示了部分內容來源差異，但未完整傳入分析素材。
- **主股票欄位不能代表文章所有公司。** `stock_id` 為空 5,895 篇，另有 9,692 篇為 `tw_stock`；台積電作為主股票有 3,457 篇。文章標籤與 chunk 的股票集合還會參與檢索，不能只查 `stock_id='2330'` 就視為全部台積電新聞。
- **資料看得到，不代表模型看得到正確段落。** 22,979 個 chunk 的 `stock_ids` 為空；其他 chunk 可能繼承整篇標籤，卻沒有目標公司相關內容。實際錯公司例子見第五節。

### 3.2 行情標題：哪些是價格重述，哪些值得保留

下表為全文判讀的代表案例。S 編號可在完整抽樣檔與標註檔回查；文章 ID 用來對應資料庫，日期採資料庫發布時間。

| 案例 | 正文觀察 | 判斷與適用性 |
|---|---|---|
| S063，2024-11-22，台股開盤、台積電漲約 3%；`69fdafbddcf4b095aed821bf594efa18` [原文](https://news.cnyes.com/news/id/5770492) | 主要列美股、指數與個股價位，沒有具體公司新公告 | P。適合交代開盤狀況；不能據此增加台積電基本面利多 |
| S093，2026-01-16，台積電法說後開盤上漲；`e8967b4b1e1c36b04597329d3e90fc22` [原文](https://news.cnyes.com/news/id/6312674) | 只以「法說報喜」帶過，未提供可核對的營收、毛利率或展望內容 | P。指向值得追查的事件，但本文本身不足以分析法說影響 |
| S057，2025-01-16，GB200 供應鏈上漲；`bea89d2cebfc235f4ef384fb39939b62` [原文](https://news.cnyes.com/news/id/5838827) | 包含過熱／訂單疑慮，及廣達具名回應與出貨說明 | M。應抽出爭議與回應，不能把上漲本身當成疑慮已解除的證明 |
| S051，2025-12-17，台新新光金創多年高；`25e7822d956cfb2de8b88a515112869f` [原文](https://news.cnyes.com/news/id/6278631) | 交代 00919 納入及八個交易日調整期 | M。是可核對的資金需求事件，對短期價格解讀較有價值，對長期獲利價值有限 |
| S135，2026-04-09，高力漲停；`6bfc0bcd26148eddae87bace216f706d` [原文](https://ec.ltn.com.tw/article/breakingnews/5397945) | 交代三月營收 12.7 億元、年增 205%，第一季 34.2 億元、年增 238% | M。行情包裝內有實質營運數字；仍需確認已公布多久、獲利與估值如何 |
| S165，2026-08-11，藥華藥股價走高；`47e445bd8fb6c5a5cc4e033565b3a26a` [原文](https://ec.ltn.com.tw/article/breakingnews/5535476) | 同時報導 AOP 部分仲裁的不利內容 | M。股價上漲不能抵銷法律事件；只取漲幅會丟失反向資訊 |
| S009，2025-12-10，承業醫營收速報；`eb4c0ddf04eaee7653198b5d74627a0b` [原文](https://news.cnyes.com/news/id/6269430) | 實際營收 3.94 億元、年增 32.63% | E。標題含「速報」仍可提供具體財務資料；不宜用單字黑名單刪除 |
| S042，2025-08-21，投顧「精準預告反彈」；`8ba7f3b3275c31de2079784b6232e2b5` | 回顧推薦績效與漲勢，基本面敘述籠統 | P，另具宣傳性。對公司評估的獨立資訊有限 |
| S176，2026-09-15，「每日最看好股」；`9b37ba5f22a2715599ce91c7a3b011d4` [原文](https://ec.ltn.com.tw/article/breakingnews/5574106) | 正文僅 88 字宣傳介紹，沒有實際選股內容 | I。應先處理擷取完整度，不能讓標題代替不存在的內容 |

實際已保存的 AI 簡報也有合理使用混合新聞的例子：

- 聯發科〈焦點股〉創天價文章 `8d94fe2b4e6a35c565de8dd458bcf61c`，除了漲幅，正文有 Google TPU、第四季量產與資料中心營收預估。snapshot 2341 的中期理由引用的是業務內容。原網站亦可見相應內容，但其中預測仍是公司／法人或媒體觀點，不能當成已實現成果。[原報導](https://ec.ltn.com.tw/article/breakingnews/5580751)
- 可成 `a320204ee9306976c4e6068ccc5a07b9` 的標題寫「臉綠失守月線」，正文同時提供營收年減 40.46%、累計年減 33.11%，以及 AI 產品與 2027 專案時程。snapshot 2342 同時呈現負面營收與正面產品管線，並未只因跌價判空。[原報導](https://news.cnyes.com/news/id/6600253)

因此，「有沒有價格描述」是用途標記，**不是品質的充分判準**。更好的問題是：除了價格，本文增加了什麼可核對事實？事實屬於誰、何時公開、是實績還是預測、是否已在其他文章說過？

### 3.3 完全重複、同事件重報與來源修訂

全庫機械式比對如下。多餘列指每組保留一列後的其餘列，各種規則互有重疊，不能相加。

| 比對規則 | 組數 | 涉及文章 | 多餘列／全庫 |
|---|---:|---:|---:|
| 相同 URL | 7 | 14 | 7／35,918，0.02% |
| 完全相同標題 | 22 | 202 | 180／35,918，0.50% |
| 正文去除空白後相同 | 29 | 212 | 183／35,918，0.51% |

正文重複的大組包含 94 篇「投資大師選股」、33 篇「長線潛力股」、30 篇「每日最看好股」的相同介紹文字。**確定的是資料庫缺乏該日具體內容**；爬蟲只取段落，可能漏掉圖片或表格，但本次沒有逐頁確認所有原始載體，不能把原因全部定為圖片擷取失敗。

更重要的是同事件不同文字，例如同一筆月營收在「營收速報」「焦點股」「盤後」「翌日報紙」反覆出現。這不會被全文相同規則抓到。實際檢索中的月營收重疊，以及中華電分析引用同一場台灣大活動的三篇文章，見第六、八節。

另有兩組**同網址的金額版本衝突**，比一般重複更危險：

| 原文網址／事件 | 資料庫保留的版本 | 2026-09-27 原站核對 |
|---|---|---|
| 鉅亨 `6605885`，9/14 18:35:16 的投資案 | `7a1afd834a67dbdc8a9e960f5675368e`：49.8 億元／人民幣 10.52 億；`8b870c04d9a572238529e6f64a2386dc`：4.98 億元／人民幣 1.052 億 | 原站目前標題與正文是約 **4.98 億元**，站內 AI 摘要仍保留 49.8 億元；來源自身也有不一致。[原文](https://news.cnyes.com/news/id/6605885) |
| 鉅亨 `6613621`，9/23 07:15:30 的 7.5 億歐元交易 | `0db8a6c9dd4c6249fe767547545c4179`：新台幣 212 億；`23678d5284562b773e7c93f09bc081df`：272 億 | 原站目前是 **272 億元**。[原文](https://news.cnyes.com/news/id/6613621) |

兩組舊、新版本皆有索引，可能被當成兩份來源或互相矛盾的事實。歷史 commit `efc3da2e` 在 **2026-09-25** 才加入 `(source,url)` 查重，四筆資料都更早建立；現象與舊版只依「來源＋標題＋時間」產生 ID 的方式相符，但缺部署日誌，不能指定當時一定執行哪個 commit。**現行正常 upsert 已按來源 URL 找舊列，不宜宣稱同樣修訂現在必然新增一列。**

現行仍未清理既有雙列、資料表也沒有 URL 唯一限制；自由財經會跳過已知 URL。另有一項可直接確認的更新限制：兩例新舊正文皆等長，專門的 `refresh-existing` 路徑會略過「長度小於或等於原文」的更新，因而無法套用這種更正；正常 crawl 的 upsert 仍可能更新等長修訂。這些機制尚未完整表達「更正取代舊版」。[爬蟲 ID](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:73)、[upsert](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:206)、[refresh-existing](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:377)、[自由財經既有網址處理](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:434)、[資料模型](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/db/models/news_article.py:14)

## 四、從新聞到 AI 分析：實際流程

### 4.1 收集、公司辨識、切塊與向量

| 階段 | 實際行為與程式位置 | 對品質的影響 |
|---|---|---|
| 資料來源 | 鉅亨 `tw_stock_news`、`wd_macro`；自由財經證券、投資、國際類別。[來源設定](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:26) | 母體自然含盤勢、國際市場與投顧內容，未按「公司新事件」收集 |
| 文字擷取 | 鉅亨可取 body／summary／excerpt；自由財經以 `.content p` 擷取。[鉅亨](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:156)、[自由財經](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:417) | 全文與摘要混用；表格或圖片可能未被保留，短文仍可能進入索引 |
| 公司關聯 | 來源代碼、既有別名與文字比對參與標註；短公司名稱有部分限制。[公司辨識](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/news/sentiment.py:75)、[爬蟲標註](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/crawlers.py:420) | 提到、主體、受影響公司容易混在同一集合；名稱重疊會誤標 |
| 切塊 | 800 字元、重疊最多 120 字元，盡量依句界切；股票集合繼承文章，不逐段重新確認。[切塊](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/chunking.py:9) | 前段行情與後段營運可能分離；整篇標籤讓不相關段落通過公司過濾 |
| 向量化 | 每個 chunk 的向量文字均含完整標題與該段內容；使用 `nvidia/nemotron-3-embed-1b`，2048 維 cosine。[標題組裝](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/chunking.py:31)、[embedding](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/clients/vector.py:43) | 「漲停」「股價」等標題在每塊重複出現，可與市場型問題相近；這是機制推論，未單獨做消融量化 |
| 事件分析 | LLM 抽事件、事實／計畫／預測／意見、引述與公司影響；驗證引文存在與公司提及。[結構與驗證](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/news/impact.py:34) | 有結構化基礎，但引文存在不代表「股價上漲」可以證成營運利多 |

事件 prompt 已明文限制用價格語氣預測未來，並要求區分事實與計畫，不能說系統完全沒有防線。[事件 prompt](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/news/impact.py:157)

**索引沒有出現整批遺失或明顯版本混用的證據。** 對實際使用的 `news_chunks_v3_recovered_20260926` 完整掃描得到 50,496 個唯一 point，與 SQL chunk 集合一致；比對的文章 ID、revision、content hash、時間、index version 與 embedding fingerprint 均吻合。這排除了本次檢查欄位上的不同步，沒有驗證向量每個數值或語意準確度。

事件分析覆蓋則有限：2,499 筆中成功 2,479，成功者只有 1,666 篇符合目前設定與輸入雜湊，其餘 813 是舊設定。向量中 2,666 塊具成功的目前事件分析，對應同樣的 1,666 篇；其餘 47,830 塊為 pending。**沒有發現 SQL 已有目前有效分析、向量卻仍 pending 的文章。** 問題較像覆蓋不足，不能直接稱為同步故障。現行排程批次與時間範圍限制，也使歷史全庫不會一次全部補完。[排程](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/scheduler.py:56)、[候選選取](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/jobs/impact/runner.py:66)

### 4.2 個股頁 AI 簡報：固定查詢，再以日期取前 20

個股頁透過 `/analyze/stock-behavior/text-brief` 讀取快照，前端送 `cache_only: true`。因此畫面常是在讀已保存結果，不是每次點開都重新檢索。[前端呼叫](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/frontend/Topic/lib/hooks/useStockTextBrief.ts:67)

新生成簡報時，實際流程是：

1. 取得價格、籌碼、財務等資料，呼叫新聞 `collect()`，回看 60 天、最多 20 則、限制在要求期間內。[分析入口](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/service.py:249)
2. 執行三個固定向量查詢；本設定每路先取最多 80 個 chunk。[查詢文字](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:197)

   ```text
   general：公司名 近期表現 營收 股價 財報
   guidance：公司名 法說會 財測 展望 財務預測 毛利率目標 資本支出 上修 下修
   market：台股大盤走勢 加權指數漲跌原因 外資買賣超 美股 費城半導體指數
           聯準會利率 關稅 政策 匯率 國際情勢 系統性風險
   ```

3. general／guidance 套公司與發布時間過濾；market 不限定公司。公司條件是 `impact_company_ids`、`stock_ids`、`stock_id` 的聯集。另有索引版本與模型 fingerprint 檢查。[向量過濾](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/clients/vector.py:79)
4. 各路先以文章去重：上限 general 20、guidance 10、market 6。同文章若被 guidance 取到，會覆蓋先前選到的 chunk 及類型。[選取與覆蓋](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:217)
5. **合併後按發布時間由新到舊排序，再裁成 20 則。** 這一步沒有保留相似度排序，也未保證公司事件、展望、市場背景各占多少。[最終組裝](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:260)

這個流程使近期盤勢文容易占位：查詢包含「近期表現」「股價」，市場分支固定存在，最新新聞又優先。已有行情字樣過濾，但公司分支若內文提到目標公司，仍可能保留；它不是正文資訊增量判斷，也沒有事件層級去重。[既有過濾](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:21)

`guidance` 還有語意落差：**它代表從哪個查詢分支取得，不代表已核實本文包含公司展望。** prompt 卻將它解釋為媒體轉述展望，服務也會依是否有 guidance 決定部分缺漏提示。純價格片段可以因查詢相近而拿到較有意義的名稱。[類型指派](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:241)、[缺漏處理](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/service.py:329)

### 4.3 模型看到什麼，以及失去什麼

證據組裝先保存新聞時間、來源與 URL，但送往簡報模型的精簡資料移除了 `published_at`、`publisher`、`url`、`publication_basis`，留下日期與正文等欄位。日資料對新聞的連結也主要按日期對齊。[欄位移除](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/evidence.py:97)、[日期對齊](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/evidence.py:225)

這造成具體矛盾：prompt 要求「盤後消息不能解釋同日收盤」，**模型卻缺乏一致可用的發布時分與來源資訊**。即使正文偶爾寫出「盤後」，也不是可靠的結構化時間保障。全文／摘要標記同樣沒有完整傳到最終新聞證據。

此外，簡報新聞資料不包含事件分析的 direction／reason；不能把事件標籤當成此管線的直接輸入。[簡報新聞組裝](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/evidence.py:556)

目前 prompt 已要求區分 observation／inference、禁止用同日共振直接判主因、不得把轉載當獨立佐證。[簡報規則](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/prompts.py:34) 但後續驗證主要能檢查 ID、日期上限、部分數字與價格敘述；沒有完整驗證每項主張是否被引文支持、消息是否先於所解釋的價格、三篇是否同源。[引用檢查](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/validation.py:226)、[關鍵日檢查](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/validation.py:403)

### 4.4 聊天與新聞卡片是另外兩條流程

| 入口 | 實際差異 | 本次能下的結論 |
|---|---|---|
| AI 個股簡報 | 固定三路查詢、60 天、日期排序最多 20 則；前端常讀快取 | 本次六股檢索與主要輸出調查針對此路 |
| 聊天 `news` | 用使用者問題 embedding；預設 30 天、單一股票通常最多 10 個 chunk，每篇最多 2 塊，按相似度；沒有跨期間補舊文 | 比簡報更隨問題改查詢，但仍未做事件獨立性或全文資訊價值排序 |
| 新聞卡片 `/api/retrieval/news` | 公司／產業／市場查詢，但向量查詢未硬限定 symbol，後續以影響關聯加分 | 不能將卡片排序直接當作 AI 簡報的排序 |

程式位置：[聊天查詢](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:277)、[聊天意圖](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/chat/prompts.py:9)、[新聞卡片檢索](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:72)。

聊天會保留時間、來源與 `impact_context`，因此「價格 → positive」標籤在這條路有進入 prompt 的實際通道；但事件的 `statement_type`、speaker 在轉成向量 impact context 時被省略，計畫、評論與實績的差別未完整保留。[impact context](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/impact_metadata.py:38)、[聊天組裝](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/chat/service.py:419)

聊天也可能取得已生成的簡報摘要，原始證據目錄並未一併完整附入。prompt 已提醒它不是獨立原始觀測；仍需避免把「先前 AI 寫過」當成第二份證據。[快照上下文](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/chat/stock_context.py:188)

## 五、檢索品質還受哪些問題影響

### 5.1 公司名稱與 chunk 歸屬錯誤

`85dae4eb0e56e111359bd7cac28cecf6`，2026-08-26 05:30〈長榮航貨運需求旺 接近疫情榮景〉，正文是 **2618 長榮航**，資料卻有主股票 **2603 長榮**及兩個股票標籤。它進入長榮海運的原始檢索，事件導向改法中甚至排第二。

這不是行情雜訊，也不是單純向量不懂語意；資料先給了錯誤或過寬的公司關聯。正文內容很具體，分類為 E，仍不適合拿來評估 2603。兩次對照回答未見把航空貨運直接寫成長榮海運營運，但它確實占用名額。

另有原文末段才提目標股票、被選中的 chunk 卻只談台積電／鴻海／聯發科的案例。文章層級關聯不等於片段層級相關。**改善公司或事件辨識，往往比全面降權「盤後」兩字更直接。**

### 5.2 宣傳性與來源觀點

六股原始 120 個素材有 24 個（20.0%）來自帶有推廣、績效展示或招攬語境的文章。這是另行標記，與 P／M／E 可重疊：投顧文章可能含正確數字，事件文章也可能混入自我宣傳。

例如 `0e4f027c01361814396532ead920b322` 的文章在被取到的首段，以費半轉強推論 AI／半導體基本面未全面轉差。這是**來源自身已從價格推導營運狀況**；模型若不標示觀點，便可能把來源推論當事實。這次確定它進入素材，未逐一證明所有最終答案接受了該推論。

### 5.3 防舊版本的保護不完全一致

向量查詢有索引版本與 fingerprint 過濾；部分入口還有 SQL revision／content hash 的新鮮度檢查。然而 AnalysisService 建立檢索服務時沒有傳入 SQL session factory，因此這條簡報路不執行相同的逐命中文章 SQL 檢查。[建構位置](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/service.py:111)、[新鮮度檢查](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/retrieval/service.py:136)

此次完整掃描未見 SQL／向量版本不一致，故這是**程式路徑上的風險差異**，不是已觀測到本批回答因索引過期而錯誤。另外，前端讀最新快照時，查詢未要求符合目前 config hash；修改檢索後若未重新生成，畫面仍可能顯示舊回答。[快照查詢](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/repository.py:163)

## 六、已保存的 AI 分析：實際出現哪些問題

### 6.1 檢查範圍與分母

全部 2,339 筆回答跨 9 個設定 hash、兩個模型、41 個股票代號。為避免混用歷史版本，本次主要取目前 40 檔股票各自最新一筆：全部分析截止日為 **2026-09-27**、模型 `Gemma4-31B`、相同 config hash `73941fe2ee4ea6ded5331fa6f372f1f3d071e2dc710d3048aa83bbbcb946dcd5`。

40 份中有 15 份 `verified`、25 份 `limited`。這是產品驗證狀態，不是本次人工判定完全正確。輸入 `news_count` 合計 680；輸出保留的新聞 evidence 256 個，對應 208 篇不同文章。**程式只儲存最終被引用的證據目錄，不能拿 256 當成總檢索量。**[證據目錄裁切](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/backend/app/features/analysis/service.py:331)

146 個關鍵日中，63 個有引用新聞，10 個引用了晚於該關鍵日才發布的文章。這是待複核名單，**不是 10 個已確認因果錯誤**；隔日新聞可以正確回顧前一天。以下列出已回讀全文的具體問題。

### 6.2 時間錯置與事後敘述

**台積電，snapshot 2373：引用另一個月份的新聞。** 7/31 關鍵日敘述單日大漲、法人買超，卻同時引用 9/19 的盤勢分析 `4d6fb7442a628fae28f56a03359abded`，以及 9/6 風向球 `933dd29a4290777fa3c856d543a70198`。全文分別談 9/18 與九月盤勢，沒有 7/31。日資料可能支持漲幅，但這兩份新聞不能支持該日原因。[9/19 報導](https://ec.ltn.com.tw/article/paper/1771236)、[9/6 報導](https://news.cnyes.com/news/id/6598585)

這不是使用「分析截止日 9/27 之後」的未來資訊，而是**用相對於 7/31 的事後新聞，支援較早的事件解釋**。只檢查 `news_date <= as_of_date` 擋不住。

**廣達，snapshot 2338：盤後營收被連成當日「利多出盡」。** 9/8 關鍵日把營收創高與收盤跌 5.61% 連結，稱為利多出盡或獲利了結；引用的是 9/9 05:30 報紙 `9ddf9fb6d08c25ef4b33e0028cf7f932`。本庫同事件較早報導分別在 9/8 **14:40:06、16:50:25**，皆晚於一般交易收盤。[引用報導](https://ec.ltn.com.tw/article/paper/1769990)、[14:40 報導](https://ec.ltn.com.tw/article/breakingnews/5566926)、[16:50 報導](https://news.cnyes.com/news/id/6600561)

目前證據不能證明當日下跌是在反應該次營收。**尚未核對公司首次公告時間，不能反過來斷言市場盤中一定不知道。** 正確做法是保留「當日下跌」與「盤後／隔日報導營收」兩個事實，未確認時間前不命名市場心理。

### 6.3 循環論證：成立到哪一段

**已確認一：價格被當成原因。** 華碩 snapshot 2376 的 9/4 關鍵日寫上漲 5.56%，並「受惠於電子代工族群走強」。所引 `8b1d22a31eadec25f26e90835d4428af` 是 14:05 盤後文，對華碩只有與研華同漲逾 5% 的行情敘述。它可以支持共漲，無法獨立建立公司受惠原因。[原報導](https://news.cnyes.com/news/id/6597350)

**已確認二：價格被直接標成 positive。** 當前 `impact-v2` 資料有以下原始理由：

| 文章 ID／發布時間 | 公司 | 影響方向 | 儲存的理由 |
|---|---|---|---|
| `0f98a9d973119cf05253fea1f370857a`，9/18 14:25 | 2454 | positive | 聯發科收盤上漲 210 元 |
| 同上 | 2330 | positive | 台積電收盤大漲 35 元，對大盤漲點貢獻顯著 |
| `1c2a70e5fc8e2b68c72565394de72d0b`，9/22 13:54 | 2454 | positive | 股價創下歷史新天價且終場上漲超過3%。 |

若 positive 的意義是「已發生的市場反應正向」，這些只是價格摘要；若下游把它讀成「未來營運利多」，就發生概念偷換。Chat 會收到這類 AI 影響推論，雖然上下文已要求核對原文，仍需明確區分反應與事件。

**尚未確認：完整的「價格上漲 → positive 標籤 → 用該標籤預測再上漲」。** 最新 40 份的 120 段前瞻理由中，疑似行情引用已回讀全文，未找到完整鏈的確證；許多中期判斷實際引用營收、訂單、量產或展望。個股簡報本身也沒有接收 direction／reason。另有直接從日資料推論動能延續的回答，但不能把它歸因於新聞標籤。

同一篇 9/18 盤後文章還有央行第二戶房貸成數政策、大立光 11.72 億元購置生產不動產等非價格資訊。處理價格標籤問題，不應順手刪掉這些事件。

### 6.4 同一事件不是多份獨立證據

中華電 snapshot 2339 的負面因子，談台灣大若完成精誠收購、次年營收可能超越中華電，一次引用三篇：

- `442f437f9e762c64a59ff54cd4e7d4df`：9/8 14:44 自由即時。[原報導](https://ec.ltn.com.tw/article/breakingnews/5566935)
- `7aa733ca742f9cd1bc64f96ba384c998`：9/8 20:00 鉅亨。[原報導](https://news.cnyes.com/news/id/6600829)
- `fa8daa8ac89075437e6f86ee1fde0a34`：9/9 05:30 自由紙本。[原報導](https://ec.ltn.com.tw/article/paper/1769984)

三者都回到 **9/8 同一場 D.E.E.P. Tech Day、同一位經營者的條件式預測**。有三個報導 ID，不等於有三個獨立觀測驗證未來營收。現有回答沒有明講「三份佐證所以高信心」，因此這證明同事件重複引用，尚未量化它使信心增加多少。

反例是華碩兩篇 9/9 報導：`e3a9a6f93af66a878d486f571804b3cf` 與 `82bfe16e5b5be3967d8afe29b2387ed3` 都有八月營收 949.56 億元、年增 51.17%，但後者增加伺服器全年成長目標上修至至少 150%、第三季產品展望。應合併共同營收事實，**保留後篇新增的展望**。

### 6.5 引用存在，仍可能不支持主張

國巨 snapshot 2372 短線理由包含「MLCC 漲價預期」，引用 `d_40` 與 `nw_01`。新聞 `9a1ace87edf4777de73a696baf83ab27` 是 9/22 大盤分析，全文沒有國巨、MLCC、被動元件或產品漲價；日資料也無法補足產品價格資訊。[原報導](https://ec.ltn.com.tw/article/paper/1771694)

這是可確認的**部分主張缺乏引用支持**，不等於證明市場上完全沒有 MLCC 漲價消息。再好的新聞排序也不能取代回答層的支持檢查。

## 七、對兩種問題，新聞的價值不同

| 新聞內容 | 「今天為什麼漲跌」 | 「這家公司值得怎麼評估」 |
|---|---|---|
| 今日漲幅、成交量、族群共漲 | 可描述現象、建立市場對照；本身不是原因 | 價格資料已能提供時，新聞重述的增量很低 |
| 除息、指數納入、停復牌、法人交易 | 常是必要背景；仍要對齊時間、避免猜測交易動機 | 影響估值或資金結構時才提高權重，不直接等於獲利改善 |
| 新營收、財報、訂單、法說 | 若消息先於價格反應，可提出有保留的解釋 | 有價值，但要區分實績、公司目標、法人估計，並檢查已反映程度 |
| 同一公告的多篇報導 | 補足反應時間與觀點，不能算多次消息衝擊 | 合併相同事實；保留新的細節與不同證據 |
| 宏觀政策、利率、匯率、產業供需 | 用來判別是否廣泛共振；沒有對照仍不能判主因 | 需要具體傳導到成本、需求、毛利或估值，避免堆一般背景 |
| 單純投顧看多、網友認為利空消失 | 可標示市場觀點，不是已確認原因 | 證據力低，尤其不能以漲價證明風險解除 |

**目前系統有做意圖與時間路由，但沒有完整依這兩種問題配置證據。** 聊天會區分 news／market／knowledge／help，解析日期並用問題查向量；綜合分析可以同時取得新聞與市場資料。可是兩種問題最終仍使用相近的新聞選取規則，未明確要求「價格解釋要事前可得與市場對照」「公司評估要營運事件、實績與反證」。個股簡報則直接使用固定查詢，同時負責解釋關鍵日與提供三種期間展望。

對金融股還需避免另一種誤刪：市場行情可能透過金融資產評價、資本適足或投資收益影響基本面。應看文章是否提供具體曝險與財務影響，而不是把所有金融市場內容歸為低價值。

## 八、實際檢索對照：改查詢能改善多少

### 8.1 設計

選台積電 2330、聯發科 2454、鴻海 2317、長榮 2603、富邦金 2881、中鋼 2002，涵蓋科技、航運、金融與傳產。這是有目的的跨產業案例，**不是對全部股票品質的隨機估計**。

固定分析截止日 **2026-09-24**，使用目前正式 embedding 模型與 Qdrant，保留相同的公司／時間過濾與約 60 天期間：

- **A：現行個股簡報**，直接執行實際 `collect()`：三路查詢、逐文章選片段、合併按時間最多 20 則。
- **B：事件導向替代策略**，查詢「公司名 營收成長率 毛利率 獲利 訂單 產能 法說會 財測 資本支出 競爭風險 新公告」，一次取最多 80 個候選，文章去重後依相似度最多 20 則，不另加通用市場分支。

B 同時改變查詢、分支與排序，不能將差異單獨歸因於某個詞或取消日期排序。這是 9/27 索引在 9/24 截止條件下的重分析，**沒有還原 9/24 當時索引與資料修訂狀態，不是無前視偏差的歷史回測**。

共回讀 A／B 聯集的 136 篇完整文章、144 個不同片段。分類分成「整篇文章」與「實際選入的片段」，另標主要事件與宣傳性；同一文章在多股出現時，各計入該股的輸入負擔。

### 8.2 結果

P 為純價格類；M 為行情與事件混合。「主要事件組」是依本次逐篇判讀的主要事件歸組，並非已驗證的全自動去重器，也不表示組內文章完全可互換。合計列為各股組數相加，同一事件跨股會重複計數；A 的 120 次素材曝光涉及 96 篇不同文章。

| 股票 | A 筆數 | A 全文 P／M | A 純價格片段 | A 主要事件組 | B 筆數 | B 全文 P／M | B 純價格片段 | B 主要事件組 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2330 台積電 | 20 | 0／11 | 1 | 13 | 20 | 0／1 | 0 | 15 |
| 2454 聯發科 | 20 | 1／15 | 2 | 15 | 20 | 0／4 | 0 | 13 |
| 2317 鴻海 | 20 | 0／9 | 1 | 13 | 20 | 0／5 | 0 | 11 |
| 2603 長榮 | 20 | 6／10 | 8 | 19 | 16 | 6／6 | 6 | 15 |
| 2881 富邦金 | 20 | 4／5 | 5 | 13 | 20 | 2／2 | 2 | 9 |
| 2002 中鋼 | 20 | 2／6 | 3 | 18 | 18 | 3／2 | 3 | 16 |
| **合計** | **120** | **13／56** | **20** | **91** | **114** | **11／20** | **11** | **79** |

可以確認的改善：

- 行情主體全文 P＋M，由 **69／120（57.5%）降至 31／114（27.2%）**。
- 純價格片段由 **20／120（16.7%）降至 11／114（9.6%）**；宣傳性素材由 **24／120（20.0%）降至 7／114（6.1%）**。
- B 帶入 A 沒選到的法說、獲利、產能與風險細節，例如聯發科七月底法說，以及富邦金七月財務損失資訊，讓只看八月獲利的材料更完整。

沒有解決的問題：

- **不保證增加事件多樣性。** 富邦金主要事件組反而從 13 降至 9；公司財務文仍可能反覆報同一筆數字。六股合計組數也受 B 總筆數較少影響，不能單純比較 91 與 79 判勝負。
- **沒有解決錯公司。** 長榮航文章仍在長榮 B 排第二；另一片段只談電子股，仍進入長榮素材。
- **各產業差異很大。** 長榮 B 仍有 6／16 個純價格片段；中鋼純價格片段數未變。不能將科技股效果直接推廣到所有股票。
- **相似度不等於新資訊或可信度。** 本次未獨立測試 BM25 混合檢索或 reranker，也沒有證據證明單純換模型即可解決。

### 8.3 B 確實漏掉的資訊

逐字核對 B 的實際片段，確認下列內容沒有被其他入選報導補回：

| 股票／A 保留的文章 | B 漏掉什麼 | 如何解讀 |
|---|---|---|
| 2454，`40d4abede290f9ece5eebc6d33fa126c`，8/17 10:29 | 媒體轉述 SemiAnalysis 因 CoWoS-S 爬坡挑戰下修 Google TPU 專案出貨預估 | B 有 AMD／Marvell 競爭內容，不等於補回供給瓶頸；仍須保留研究機構歸屬。[原報導](https://ec.ltn.com.tw/article/breakingnews/5542311) |
| 2454，`f7e5a002a9db48b0b2c8a1cc97e74968`，9/15 10:19 | 報導所稱 AI 業者呼籲前沿模型開發減速 | 這是本庫可追查的風險說法，尚未外部驗真，更不是已宣布削減資本支出；不宜直接升格為訂單損失。[原報導](https://ec.ltn.com.tw/article/breakingnews/5574174) |
| 2330，`cbe0e83e4ec1678799d3838ab1631e32`，9/16 09:19 | 9/16 除息、每股現金股利約 7 元 | 對當日價格解讀重要，營收／訂單導向查詢可能漏掉。[原報導](https://ec.ltn.com.tw/article/breakingnews/5575384) |

這些案例支持「保留事件種類與風險覆蓋」，不支持恢復所有行情文章；有些風險報導本身也需要查證。

### 8.4 降權／去重／全刪的離線檢查

在 A 的同一批素材上，用已完成的內容標註檢查兩種剔除方式，沒有補新文章：

- **只移除純價格片段**：120 → 100 個。可降低重述成本，但部分文章全文有營運內容，較合理的後續選項是改取該文的事件段落，而不是丟掉整篇。
- **移除所有行情主體文章 P＋M**：120 → 51 個，同時丟掉 **56 個含具體非價格資訊的 M 類素材**。這個規則過於粗糙。

在各股內按主要事件歸組，120 個素材的組數合計 91，顯示有合併空間；但沒有把它直接變成「每組只留一篇」的新生成實驗。台積電、聯發科、鴻海都有同一次月營收跨文章重複；富邦金的多日上市公司營收彙整反覆出現同一個八月數字，其他公司雖更新，對富邦金未必增加資訊。應以**目標公司的新增事實**判斷，而不是只比全文相似度。

本節的剔除與歸組使用人工式內容判讀作為理想參照，不代表線上分類器已能同樣準確；也沒有實作或驗證某組數值降權公式。

## 九、真實模型回答對照：改善素材不等於修好推論

### 9.1 方法與限制

再選 2330、2603，各做三次條件不同的生成，共 **六次原始模型呼叫**：A 現行新聞、B 事件導向新聞、C 完全無新聞。使用原供應商設定的 `Gemma4-31B`、temperature 0.2、原 system prompt、schema、欄位解釋及同股相同 few-shot。價格、籌碼、財務、營收、估值在同一唯讀一致性快照取得；程式逐組確認非新聞內容相同。

B 除改變新聞選取，還將 kind 統一為 general，避免冒稱已核實展望；C 相應加入缺新聞標記。這些都是本次策略差異的一部分，**不是只替換一個變數的受控因果實驗**。每股每組僅一次，沒有盲評或統計顯著性，也不測預測報酬。

六次皆在約 17–27 秒回傳完整 JSON；總輸入 165,020 tokens、輸出 11,373 tokens。為限制實驗，停用 transport retries，本次僅生成一輪，未執行第一輪失敗後的第二輪生成，更沒有保存為正式分析。

### 9.2 必須先交代的驗證結果

| 股票／條件 | 新聞數 | 現行第一輪驗證 | 原始整體立場／信心 |
|---|---:|---|---|
| 2330 A | 20 | unavailable | mildly_bullish／high |
| 2330 B | 20 | limited | mildly_bullish／high |
| 2330 C | 0 | unavailable | mixed／medium |
| 2603 A | 20 | unavailable | mildly_bullish／high |
| 2603 B | 16 | unavailable | mildly_bullish／high |
| 2603 C | 0 | unavailable | mildly_bullish／high |

五份因前瞻價位引用不足而未通過第一輪；2330 B 的 limited 是既有數字檢查對 `53.3%` 的判定，新聞中有相近的 53.32%／53.3% 來源，不能直接視為該數字已被人工證偽。對同一原始輸出另套允許移除不合規前瞻段落的離線處理，六份均為 limited。

**以下是原始生成內容的可追溯比較，不是已上線顯示的六份成功回答，也不能用 1／6 宣稱正式服務成功率。** 原服務還會重試，本次未做；通過形式檢查與事實／因果正確也不是同一件事。

### 9.3 台積電：B 增加營運細節，但失去除息

B 比 A 更明確寫出先進製程營收組合、2 奈米、資本支出、海外廠與新製程毛利稀釋、客戶集中度。相關文字在 B 選入的 `d3ff4b871f877f13f7f836bc0f81206a`、`721e0f3ded741694a4ba6ca70c6e229d`、`c9cd56fdc97c28cdd5109714ddd85226` 中有依據。這證明本次答案增加具體營運項目，**沒有證明所有媒體數字都已對公司原始公告驗真**；部分推估仍被寫得過於像已確認事實。

A 的關鍵日提到 9/16 除息 7 元；B 沒有該資訊，也沒寫入回答。兩者仍把外資賣超延伸成「獲利了結」，但買賣超無法直接證明持有者損益與動機。A 還以 9/10 營收與當日跌價推測市場轉向估值，所引營收報導在當日 15:28、17:24、17:31，沒有核實首次公告時點；B 也未處理這個時序問題。

C 保留財務與籌碼，卻不再提供 AI、2 奈米、海外擴廠成本等事件，整體立場轉為 mixed。這只表示資訊與敘述改變，不能認定 C 比 A／B 正確。C 仍有未受支持的市場動機與指標用語問題，移除新聞沒有自動修好推論。

### 9.4 長榮：B 改善有限，C 漏掉淡季風險

B 增加節能新船與長期競爭力的法人觀點，來源 `674adc7650af5b54d573abdbc9025a32` 有對應文字；但同篇提及短期折舊壓力，該正面因子沒有同步交代。A／B 都保留第四季淡季、塞港緩解可能壓低運價的風險；C 則完全失去這項產業風險，轉成估值與籌碼敘述。

**A／B 共同的引用缺口更重要。** 兩者都用 `882835f22908fc140bdf97910285e2c2`，發布於 **9/8 19:50:27** 的營收報導，解釋 9/8 收盤下跌 1.72%。A 說市場反應平淡；B 說可能利多已提前反應或市場對後市有疑慮。現有引用只能確認盤後報導，未提供首次公開時間，不能支持當日收盤已反應消息，更不能據此推定「提前反應」。兩者也把 8/18 10:23 的運價新聞連到 8/17 關鍵日。

長榮航的錯公司文章同時存在 A／B，但這兩份原始回答未將其航空業務寫成海運營運；它仍浪費名額。另一方面，兩組都取到冷鏈文章 `1a57ee457a3829c3b4963332e3b30cf1`，其中約 58,000 只智慧冷凍貨櫃的內容，兩份都未引用，顯示**檢索取回不保證被使用**。

C 沒有憑空補具名公司事件，也承認缺少新聞；仍推測投信接手外資獲利了結。其 overall_stance 與 confidence 仍為 mildly_bullish／high，與 A／B 相同。**刪光新聞不必然使模型更保守，也不保證降低無證據推論。**

綜合兩股，B 有部分資訊涵蓋改善，未修復時間與因果；C 有明確的資訊損失。最有證據支持的方向是保留事件及必要市場背景，同時改善時間、來源與回答驗證，而不是把「少新聞」本身當品質目標。

## 十、改善優先順序與驗收方式

以下是調查建議，**此次均未修改產品或資料**。

| 優先 | 最小有用的改善 | 為何優先 | 建議驗收 |
|---|---|---|---|
| **P0** | 將精確發布時間、來源、全文／摘要狀態留在模型新聞資料；對關鍵日核對事件日與首次公開時間。無時間證據時禁止命名當日市場反應 | 已有盤後營收、跨月新聞錯引；prompt 有規則但欠必要資料 | 本報告台積電 7/31、廣達 9/8、長榮 9/8 案例不再產生原因斷言；隔日回顧仍可作回顧來源 |
| **P0** | 對主張核對實際支持的片段；區分「價格反應」「營運事件」「公司／法人預測」，價格方向不得直接代替營運影響 | 已確認價格→positive、族群漲→原因、國巨 MLCC 無對應引文 | 不只檢查 ID 存在；本報告因果與 MLCC 案例須被改寫或刪除不受支持部分 |
| **P0** | 修正明確公司誤配；公司新聞必須在選入片段有相關事實，或具可追溯的受影響關係 | 長榮航誤入長榮 A／B，換 query 未解 | 2618 航空營運不再占用 2603 公司事件名額；仍保留可證明的競爭／供應鏈影響 |
| **P1** | 處理 canonical URL、來源修訂及舊版取代；更新不能只看長度是否增加 | 同一 URL 金額差十倍，舊新均被索引；等長更正會被 refresh 跳過 | 同 URL 更正後只將目前有效事實作分析，保留可追溯歷史；6605885／6613621 成為回歸案例 |
| **P1** | 在有限的檢索候選內，按公司＋事件＋期間合併共同事實，保留新增細節、來源與時間 | 同次營收、多日彙整、同場活動占用多名額 | 中華電三篇可表達成一個聲明；華碩營收合併後仍保留新增的 150% 目標 |
| **P1** | 依問題配置上下文：價格解讀保留公司行動、市場對照；公司評估提高營運事件與反證的比重。將 query 分支名稱與已驗證內容類型分開 | B 能增加營運資訊，卻漏除息與 TPU 風險；guidance 現在只是檢索分支 | 同時通過台積電除息、聯發科供給風險、長榮淡季案例，不能只看純行情占比下降 |
| **P2** | 在上述基線上比較相似度／時效／資訊增量排序，再決定是否需要混合檢索或 reranker | 現有最終日期排序可推高重報；但更複雜模型尚無本次實證 | 固定候選與其他條件逐項測，衡量新事實涵蓋、重複、錯公司、失實因果、重要遺漏，而不是單一相似度 |
| **P2** | 改善擷取完整度，對重要財報、法說、重大訊息連回公司原始公告；標示投顧、媒體轉述與未證傳聞 | 樣板短文、來源自身更正未同步、預測被當事實 | 抽查原文／儲存文差異；公司公告與媒體推估能清楚區分，不用增加來源數量掩蓋重複 |

驗收不應以「行情新聞越少越好」或「答案更看多／更保守」判勝負。較有用的判準是：**重要事實與風險是否保留、每個主張是否受支持、同事件是否只算一次、時間是否能支持所聲稱的反應、公司是否正確。**

先在每次實際入選的有限候選內整理重複事實，並用本報告案例驗證，再決定是否擴大到全庫。

## 十一、已確認與仍待驗證

| 議題 | 本次已確認 | 尚不能下的結論 |
|---|---|---|
| 行情占比 | 分層全文樣本 P 約 10.0%、M 約 15.6%；六股實際素材的行情主體比率更高 | 全庫大多是垃圾；所有 E 都有新增價值；兩個樣本差異全由檢索造成而非日期／股票差異 |
| 同事件重複 | 完全重複下限、120 素材在各股內的主要事件分組、同次聲明三篇同引 | 全庫語意重複的精確比例；重複一定提高多少信心或改變多少結論 |
| 循環論證 | 價格→positive 標籤，及價格共振被寫成解釋 | 完整三段鏈已在目前個股簡報中被證明；所有看多都來自這種循環 |
| 時間錯置／可取得時間未核實 | 跨月份錯引、盤後引文不足以支持當日反應；payload 刪除發布時分 | 公司消息當日盤中一定未公開；所有隔日文章皆不可用 |
| 替代策略 | B 改變內容、減少部分純價格素材，也有明確遺漏；C 丟失風險 | B 普遍最優、能提高預測準確率或投資報酬；已完成線上驗證 |
| 索引與來源 | 本次 SQL／Qdrant 對應欄位一致；有來源修訂雙列與來源 AI 摘要未更正 | 所有向量語意正確；所有來源數字已查公告；雙列必由目前爬蟲產生 |

最值得補的下一輪證據是少量公司公告的精確時間核對、同一候選集合的逐項排序消融，以及涵蓋更多股票與日期的盲評。這些會補足本次界線，不妨礙先處理已確認的時間、公司與引用問題。

## 附錄：重現資料、程式與驗證

### A. 本次產物

完整工作資料保存在本機忽略目錄 `artifacts/news-quality-review/`，未加入產品程式。以下連結可直接追查全文、選樣、標註與原始模型輸入輸出：

| 證據 | 檔案 |
|---|---|
| 快照時間、筆數與 SHA-256 | [manifest.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/manifest.json) |
| 凍結程式基準與檔案雜湊 | [code-baseline/manifest.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/code-baseline/manifest.json) |
| 唯讀快照腳本 | [snapshot.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/snapshot.py) |
| 固定種子抽樣與全庫重複統計 | [sample.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/sample.py)、[census_summary.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/census_summary.json) |
| 180 篇全文與逐篇分類理由 | [sample_all.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/sample_all.json)、[labels_all.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/labels_all.json) |
| 原始文章與切塊快照 | [articles.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/articles.json)、[chunks.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/chunks.json) |
| 向量核對 | [index_audit.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/index_audit.py)、[index_summary.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/index_summary.json) |
| 六股檢索與候選 | [retrieve.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/retrieve.py)、[retrieval.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/retrieval.json)、[retrieval_hits.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/retrieval_hits.json) |
| 檢索逐篇／片段標註與統計 | [retrieval_labels_all.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/retrieval_labels_all.json)、[review_summary.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/review_summary.json)、[summarize.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/summarize.py) |
| 40 股快照複核與時間案例 | [snapshot_review.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/snapshot_review.json)、[snapshot_review.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/snapshot_review.py) |
| 六次真實生成的輸入、輸出與驗證 | [answer_comparison_inputs.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/answer_comparison_inputs.json)、[answer_comparison.json](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/answer_comparison.json)、[answer_comparison.py](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/answer_comparison.py) |
| 完整案例 URL 與歷史修訂核對 | [case_refs.md](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/case_refs.md)、[final_refs.md](C:/Users/imd/Desktop/Fork/115409/artifacts/news-quality-review/final_refs.md) |

本機報告的全文與統計可由已保存快照重新計算；重新執行 `retrieve.py` 或 `answer_comparison.py` 會再次呼叫外部服務，並非純離線重算。向量與新聞持續變動，未必得到相同結果。

關鍵快照雜湊：

```text
articles.json  adcac806e54db95a85b0dae05ce00ae63e8ddfee69c4ea099afc44e68e1dadae
chunks.json    d7e2a35d6bf461740e5317f366e7b6c50d536989501adce3f604d470ad502e12
responses.json 1a6aa09c0be37c8c6645287ba83755d450183dd270f7f2b4a51657727b00c0e0
```

### B. 已做驗證

- 獨立重算分層樣本、180 篇 ID 與標註一對一、加權占比、重複計數、六股 A／B 分母與事件分組。
- 完整核對 SQL 與 Qdrant 的 50,496 個 chunk 對應欄位；核對最新 40 股分析的新聞引用與疑似時間案例。
- 檢查六次生成的非新聞資料一致性、完整回傳與產品第一輪驗證結果。
- 執行相關既有離線測試：

  ```powershell
  backend/.venv/Scripts/python.exe -m pytest backend/tests/test_retrieval.py backend/tests/test_news_retrieval_revision.py backend/tests/test_analysis_evidence.py -q
  ```

  調查基準的結果 **43 passed**，另有既有 Starlette deprecation warning。測試通過表示目前行為符合這些測試，**不代表上述語意品質問題不存在**；例如證據測試本來就確認模型 payload 不含 `published_at`。此次為調查與文件，不跑無關全套測試；已查閱專案記載的[已知驗證限制](C:/Users/imd/Desktop/Fork/115409/docs/README.md)。

**最後判斷：行情新聞不是單一種類的雜訊。純價格重述對公司評估的增量低，但混合文章常保留重要事件；真正需要優先修正的是系統如何挑段落、辨識公司與事件、保留時間，以及限制回答能從證據推到哪一步。**
