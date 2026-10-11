# 股海明燈商業模式

> 用途：專題報告與系統展示，不會真的上線收費。系統裡的方案頁只依這份文件製作。
> 盤點日：2026-10-11（分支 `victor`，commit `0b4ad8f`；F27 依 main `a4e3cc2` 移除 AI 對話檢核後更新；2026-10-12 依程式審查修正更新 F15、F27、第 1 節成本事實與 7.1、7.3）。網路資料的查核日也是 2026-10-11。

## 既定方向（沿用，不重新討論）

- 採 B2C 免費增值制（Freemium）訂閱，不以校園 B2B 為主軸。
- 付費版和免費版只差在「量」（額度、檔數、保存期間）和「工具」（通知通道、匯出、桌面小燈）。
- AI 多空立場、趨勢判讀（AI 投資分析、判斷回顧、新聞事件影響）全部免費開放，不放在付費牆後面。理由有兩個：
  - 收費提供個股分析意見需要投顧執照（第 7 節）。
  - 產品定位是「可解釋、不賣明牌」。
- 後端目前沒有方案或額度機制。金流之後用綠界測試環境展示，這個階段不做。
- 投顧法規、新聞與行情授權只寫進報告的「風險控管」，程式不處理。

## 和上學期報告的用語對照

依據《系統簡介》與《系統手冊》第 2 章（`docs/上學期進度/`）：

| 上學期用語 | 本文件用法 |
|---|---|
| 「免費增值制」（手冊 2-1 經濟可行性） | 沿用，括號注 Freemium |
| 使用對象：時間受限的一般散戶、初階投資人、財經自媒體（簡介第三節） | 沿用為第 2 節的三個 persona |
| 商業模式九宮格收益流：「平台廣告收入」「訂閱制收費」（手冊表 2-2-1） | **只保留訂閱制**。簡介系統特色第 3 點強調「擯棄傳統看盤軟體繁雜的廣告」，放廣告會和定位衝突 |
| 「AI 投資顧問」（簡介第二節）、「智能化投資顧問服務」（手冊 1-4） | 改用系統現在的名稱「AI 對話」（`FE/lib/nav.ts:11`），避免讓人以為是投顧服務（第 7 節） |
| 「低門檻的歷史回測」（簡介系統特色第 2 點） | 程式目前只有管理員能用的 AI 回測，一般使用者還沒有，盤點表列為「規劃中」（F33） |

---

## 1. 功能盤點表

**路徑縮寫：**
- `FE/` 代表 `frontend/Topic/`
- `BE/` 代表 `backend/app/`
- 其他路徑都從 repo 根目錄算起

**狀態定義：**
- **完成**：前後端都有實作，在 repo 現有設定下就能使用。
- **部分完成**：有實作，但少一段，例如前端沒接、後端沒接，或範例設定預設關閉。
- **規劃中**：程式裡找不到實作。

| ID | 功能 | 使用者看到的頁面或路由 | 後端模組 | 狀態 | 證據路徑 |
|---|---|---|---|---|---|
| F01 | 首頁燈塔旅程（3D 場景，減少動態時改用海報版） | `/` | （前端場景；行情資料來自 `BE/features/market`） | 完成 | `FE/pages/index.tsx`、`FE/features/home/journey/BeaconJourney.tsx` |
| F02 | 觀測台：觀測清單、報價與 K 線、加權指數、三大法人、技術指標 | `/#terminal` | `BE/features/market` | 完成 | `FE/features/home/terminal/ObservationTerminal.tsx`、`FE/features/home/terminal/useTerminalData.ts`、`BE/features/market/router.py` |
| F03 | 個股儀表板：收盤價與 K 線、均線、成交量、區間統計 | `/stock/[id]` | `BE/features/market` | 完成 | `FE/pages/stock/[id].tsx`、`FE/features/stock/StockDashboard.tsx`、`FE/features/stock/price/PricePanel.tsx` |
| F04 | 三大法人籌碼：買賣超、價量籌碼 | `/stock/[id]`、觀測台 | `BE/features/market`、`BE/jobs/market/institutional.py` | 完成 | `FE/features/stock/chips/ChipsPanel.tsx`、`BE/features/market/router.py` |
| F05 | 技術指標：RSI、KD、MACD、布林通道、均線 | `/stock/[id]` | `BE/features/market`、`BE/jobs/indicators.py` | 完成 | `FE/features/stock/indicators/IndicatorsPanel.tsx` |
| F06 | 融資融券、外資持股、股權分散、股利 | 沒有畫面 | `BE/features/market`（`chips/*`、`fundamentals/dividend-results`） | 部分完成：後端端點已有，前端沒有呼叫 | `BE/features/market/router.py`、`FE/openapi.json`（`/stocks/{symbol}/chips/*`）、`FE/lib/api/stock.ts`（沒有這些呼叫） |
| F07 | 多股比較：航跡圖、比較指標表、類別冠軍、相關性、風險報酬、基本面 | `/compare` | `BE/features/market` | 完成：網址最多帶 30 檔 | `FE/pages/compare.tsx`、`FE/features/compare/useCompare.ts`、`FE/lib/api/compareFundamentals.ts`、`FE/lib/utils/compareQuery.ts:13` |
| F08 | 財經新聞列表、搜尋、產業篩選 | `/`（最新財經新聞） | `BE/features/news`、`BE/jobs/crawlers.py` | 完成 | `FE/features/home/HomeNews.tsx`、`FE/features/news/NewsFilters.tsx`、`BE/features/news/router.py` |
| F09 | 新聞內容與事件影響分析 | `/news/[id]` | `BE/features/news`、`BE/jobs/impact/` | 完成 | `FE/pages/news/[id].tsx`、`FE/features/news/NewsEventAnalysisPanel.tsx`、`BE/jobs/impact/runner.py` |
| F10 | 個股相關新聞（向量檢索） | `/stock/[id]` | `BE/features/retrieval`、`BE/jobs/ingestion/` | 完成 | `FE/features/stock/StockNewsPanel.tsx`、`FE/lib/api/news.ts`、`BE/features/retrieval/router.py` |
| F11 | AI 投資分析：多空立場、三個區間展望、正反因素、風險、證據 | `/stock/[id]`（摘要卡與抽屜） | `BE/features/analysis`、`BE/jobs/warmup.py`（每日預先產生，所有人共用） | 完成 | `FE/features/brief/AIBriefSummaryCard.tsx`、`FE/features/brief/StockTextBriefPanel.tsx`、`FE/lib/hooks/useStockTextBrief.ts`、`BE/features/analysis/schemas.py`、`BE/jobs/warmup.py` |
| F12 | AI 判斷回顧：第 5、20、40 個交易日的命中率，含基準對照 | `/stock/[id]` | `BE/features/analysis/track_record.py` | 完成 | `FE/features/brief/AITrackRecordCard.tsx`、`BE/features/analysis/track_record.py` |
| F13 | AI 分析報告：列印、存成 PDF | `/stock/[id]/report` | `BE/features/analysis` | 完成 | `FE/pages/stock/[id]/report.tsx`、`FE/features/brief/BriefReport.tsx:196-200` |
| F14 | AI 對話：引用來源、資料面板、追問、範例問題 | `/ai` | `BE/features/chat`、`BE/features/conversations` | 完成 | `FE/pages/ai.tsx`、`FE/features/ai/useChat.ts`、`FE/lib/api/ragAsk.ts`、`BE/features/chat/service.py` |
| F15 | 歷史對話：保存、搜尋、刪除、回答回饋 | `/ai` | `BE/features/conversations` | 完成 | `FE/features/ai/ConversationHistory.tsx`、`FE/lib/api/conversations.ts`、`BE/features/conversations/router.py` |
| F16 | 小燈站內助手：對話面板、「這頁怎麼看」導覽、選取文字後「問小燈」 | 全站（`/ai` 除外） | `BE/features/chat` | 完成 | `FE/features/assistant/AssistantDock.tsx`、`FE/features/assistant/AssistantPanel.tsx`、`FE/features/assistant/tours.ts` |
| F17 | 在對話中建立模擬單草稿（使用者確認後才送出） | `/ai`、小燈 | `BE/features/chat/personal_context.py`、`BE/features/paper_portfolio` | 完成 | `FE/features/order/PaperOrderDraft.tsx`、`FE/features/ai/ChatMessage.tsx`、`BE/features/chat/personal_context.py` |
| F18 | 收藏股（目前沒有數量上限） | `/favorites`、各頁星號 | `BE/features/favorites` | 完成 | `FE/pages/favorites.tsx`、`FE/features/favorites/FavoriteList.tsx`、`BE/features/favorites/service.py` |
| F19 | 通知中心：站內通知與通知偏好（收藏股每日摘要、單日漲跌幅提醒、重大新聞／公告、安靜時段） | `/notifications` | `BE/features/notifications`、`BE/jobs/notifications.py` | 部分完成：程式完整，但範例設定 `NOTIFICATIONS_ENABLED=false` | `FE/features/notifications/NotificationSettings.tsx`、`BE/features/notifications/engine.py`、`backend/.env.example:49` |
| F20 | 推播（Web、Android，透過 Firebase Cloud Messaging） | `/notifications`（此裝置推播） | `BE/features/notifications/delivery.py`、`BE/clients/fcm.py` | 部分完成：前端沒設 `NEXT_PUBLIC_FIREBASE_*` 時按鈕停用；後端範例設定 `FCM_ENABLED=false` | `FE/lib/notifications/push.ts`、`FE/features/notifications/NotificationSettings.tsx`、`BE/clients/fcm.py`、`backend/.env.example:50` |
| F21 | 模擬投資：設定資金、下單、持股、交易紀錄、取消委託 | `/order` | `BE/features/paper_portfolio`、`BE/jobs/paper_portfolio.py` | 完成 | `FE/pages/order.tsx`、`FE/features/order/PaperFunds.tsx`、`FE/features/order/PaperOrderDraft.tsx`、`BE/features/paper_portfolio/service.py` |
| F22 | 投資回顧：買進後第 20 個交易日和大盤比較 | `/order` | `BE/features/paper_portfolio` | 完成 | `FE/pages/order.tsx`、`BE/features/paper_portfolio/service.py` |
| F23 | 帳號：註冊、登入（Email、Google）、忘記與重設密碼 | `/register`、`/login`、`/forgot-password`、`/reset-password` | `BE/features/auth` | 完成：重設密碼信需要設定 SMTP 才會寄出 | `FE/pages/login.tsx`、`FE/pages/register.tsx`、`FE/features/auth/GoogleSignInButton.tsx`、`BE/features/auth/router.py`、`BE/clients/mail.py` |
| F24 | 個人中心：帳號資料、變更密碼 | `/me` | `BE/features/auth` | 完成 | `FE/pages/me.tsx` |
| F25 | 投資免責聲明與首次造訪的風險提示 | `/disclaimer`、全站 | — | 完成 | `FE/pages/disclaimer.tsx`、`FE/components/layout/RiskNoticeBanner.tsx` |
| F26 | 管理後台：工作排程、執行紀錄、股票管理、操作紀錄、管理員 | `/admin` | `BE/features/admin`、`BE/features/audit`、`BE/jobs/runtime.py` | 完成 | `FE/pages/admin.tsx`、`FE/features/admin/StockManagement.tsx`、`BE/features/admin/router.py` |
| F27 | 後台 AI 成效：全站命中率、AI 摘要用量與估算成本、各功能（含 AI 對話）的模型呼叫用量、對話回饋 | `/admin` | `BE/features/admin`（`ai_usage.py`、`ai_feedback.py`） | 完成 | `FE/features/admin/AIEffectivenessPanel.tsx`、`BE/features/admin/ai_usage.py` |
| F28 | 後台訊號檢驗：18 個標準的技術、籌碼、營收、估值訊號 | `/admin` | `BE/features/signals` | 完成 | `FE/features/admin/SignalCheckPanel.tsx`、`BE/features/signals/detection.py:29-48` |
| F29 | 後台 AI 回測：純規則、AI、AI 加訊號三組比較 | `/admin` | `BE/features/backtest` | 完成：只有管理員能用 | `FE/features/admin/AIBacktestPanel.tsx`、`BE/features/backtest/service.py`、`BE/features/admin/router.py` |
| F30 | 每日資料排程：行情、法人、融資融券、基本面、集保、新聞爬蟲、新聞向量化、事件判讀、AI 摘要預熱 | 後台「工作排程」 | `BE/jobs/` | 完成 | `BE/jobs/scheduler.py`、`BE/jobs/runtime.py`、`BE/core/config.py:121-126` |
| F31 | AI 趨勢預測與分析彙整端點（`/api/trend_predict`、`/api/analysis_digest`） | 沒有畫面 | `BE/features/analysis/prediction.py` | 部分完成：前端沒有使用；`analysis_digests` 表在 app 內沒有寫入程式 | `BE/features/analysis/prediction.py`、`BE/features/analysis/repository.py` |
| F32 | Android App（Capacitor 包裝） | 沒有路由（Next.js 靜態匯出） | 和網頁共用 | 部分完成：骨架已有，推播缺 `google-services.json` | `FE/capacitor.config.ts`、`FE/android/`、`FE/package.json:26-28` |
| F33 | 一般使用者的歷史回測 | 沒有 | 沒有 | 規劃中：上學期列為特色，但程式只有管理員版（F29）；舊的公開回測端點已刪除 | `FE/docs/PARITY.md:47`、`FE/pages/admin.tsx` |
| F34 | 方案、額度、訂閱 | 沒有 | 沒有 | 規劃中 | `BE/db/models/user.py:6-16`（`users` 表沒有方案欄位）、`FE/openapi.json`（沒有相關路徑） |
| F35 | 金流（綠界測試環境） | 沒有 | 沒有 | 規劃中 | `backend/requirements.txt`（沒有金流套件）、`FE/openapi.json`（沒有付款路徑） |
| F36 | CSV 匯出、圖表存成圖片 | 沒有 | 沒有 | 規劃中：目前唯一的匯出是 F13 的瀏覽器列印 | `FE/features/brief/BriefReport.tsx:196-200` |
| F37 | Email、LINE 通知通道 | 沒有 | 沒有 | 規劃中 | `BE/features/notifications/schemas.py:23`（`platform` 只有 `web`、`android`） |
| F38 | 自訂提醒規則：自訂價位、指標訊號、法人連續買賣 | 沒有 | 沒有 | 規劃中 | `BE/db/models/notification.py:12-23`（每人只有一筆固定偏好，沒有規則表） |
| F39 | 桌面小燈（桌面常駐版） | 沒有 | 沒有 | 規劃中 | `FE/package.json`（沒有 Electron 或 Tauri）、`FE/public/`（沒有 PWA manifest） |

**統計：** 共 39 項。完成 27 項，部分完成 5 項（F06、F19、F20、F31、F32），規劃中 7 項（F33–F39）。

**和成本有關的實作事實**（第 6 節會用到）：
- AI 投資分析（F11）由每日排程對每檔支援股預先產生一份，所有使用者共用，前端只讀快取（`FE/lib/hooks/useStockTextBrief.ts`，`cache_only: true`）。所以看分析的人再多，LLM 成本也不會增加。
- 支援股範圍是 40 檔（`BE/jobs/market/stock_info.py:14-20`），管理員可以從上市櫃名錄新增。
- 新聞事件判讀每輪最多 100 篇，成本上限 0.50 美元（`BE/core/config.py:125-126`）。
- AI 對話（F14、F16）每問一次約呼叫模型 2–5 次，沒有快取。用量會寫進 `ai_usage_logs` 表（`BE/db/models/ai_usage.py`），後台 AI 成效的「各功能的模型呼叫」依功能列出請求數、每次請求的平均 token 與估算成本（`BE/features/admin/ai_usage.py`）。後台 AI 回測與 AI 摘要的過往檢討不寫這張表。

---

## 2. 目標客群

### Persona A：時間受限的受薪散戶「小安」

- **是誰**：28 歲，科技業工程師，投資 3 年，手上 5–8 檔股票。只有通勤和下班後的零碎時間能看盤。
- **痛點**：
  - 收盤後要開好幾個網站拼湊法人、新聞、技術指標。
  - 新聞太多，不知道哪則跟自己的股票有關。
  - 不想整晚盯盤，但怕漏掉大漲大跌。
- **會用的功能**：
  - 觀測台（F02）一次看完收藏股。
  - 收藏股（F18）加上通知中心的每日摘要與漲跌幅提醒（F19）；付費後改用手機推播（F20）。
  - 個股頁的 AI 投資分析（F11）與相關新聞（F10）。
  - 小燈（F16）隨手問。
- **對應方案**：進階版。主要買的是推播、更多 AI 提問次數和收藏檔數。

### Persona B：初階投資人「小禾」

- **是誰**：20 歲大學生，剛開戶，資金不多，還沒用真錢買過股票。
- **痛點**：
  - 看不懂 KD、外資買賣超這些術語。
  - 怕第一筆就賠錢。
  - 不知道 AI 說的話能不能信。
- **會用的功能**：
  - 小燈的「這頁怎麼看」導覽和選取文字後「問小燈」（F16）。
  - 技術指標（F05）。
  - 模擬投資與投資回顧（F21、F22）。
  - AI 判斷回顧（F12），用來看 AI 過去準不準。
- **對應方案**：免費版。核心學習功能（模擬投資、AI 判讀、導覽）全部免費，讓這群人留下來。

### Persona C：財經自媒體經營者「阿樂」

- **是誰**：經營台股圖文帳號和 Podcast，每週要產出 3–5 篇內容。
- **痛點**：
  - 整理多檔股票比較、法人動向很花時間。
  - 內容要能交代資料來源。
  - 需要把圖表、表格放進貼文。
- **會用的功能**：
  - 多股比較（F07）。
  - 新聞事件影響分析（F09），附來源。
  - AI 對話的引用來源（F14）。
  - AI 分析報告存 PDF（F13）。
  - 規劃中的 CSV 匯出與圖表存成圖片（F36）。
- **對應方案**：專業版。主要買的是匯出工具、更多提問次數和更多通知通道。
- **風險**：這群人轉發資料涉及授權問題，見第 7.2 節。

---

## 3. 商業模式畫布

| 區塊 | 內容（括號內是對應的盤點表 ID） |
|---|---|
| **目標客群** | 1. 時間受限的受薪散戶（Persona A）<br>2. 初階投資人、學生（Persona B）<br>3. 財經自媒體經營者（Persona C）<br>4. 規模參考：2026 年 9 月底累積開戶 14,763,301 人，30 歲以下約 282.1 萬人（第 5 節來源） |
| **價值主張** | 1. 收盤後一次看清楚：行情、法人、指標、新聞放在同一張桌上（F02、F03–F05、F08）<br>2. 可解釋的 AI 判讀：多空立場附證據，還公開歷史命中率，而且全部免費（F11、F12）<br>3. 新聞不只列標題，也整理事件和可能影響（F09、F10）<br>4. 用虛擬資金練習，事後和大盤比較（F21、F22）<br>5. 不賣明牌：付費只買量和工具 |
| **通路** | 1. 網站，首頁燈塔旅程作為品牌入口（F01）<br>2. Android App（F32）<br>3. 推播和站內通知，讓使用者回訪（F19、F20）<br>4. 小燈導覽，降低新手上手門檻（F16）<br>5. 規劃中的桌面小燈（F39） |
| **顧客關係** | 1. 自助式加會員制（F23、F24）<br>2. 小燈陪伴式導覽（F16）<br>3. 回答回饋與後台 AI 成效統計，持續改善 AI 品質（F15、F27）<br>4. 公開命中率建立信任（F12）<br>5. 免責聲明與風險提示（F25） |
| **收益流** | 1. 進階版、專業版訂閱，月繳或年繳（F34、F35 規劃中）<br>2. 年繳優惠，提高續訂率與現金流<br>3. 不放廣告，和上學期報告不同（理由見開頭的用語對照）<br>4. 不收取任何個股分析或推介費用 |
| **關鍵資源** | 1. 每日自動資料排程（F30）<br>2. 新聞向量庫（Qdrant）和事件判讀資料（F09、F10）<br>3. AI 分析與證據流程（F11）<br>4. 命中率、訊號檢驗、回測等驗證工具（F12、F28、F29）<br>5. 自建的台股圖表介面（F02–F07） |
| **關鍵活動** | 1. 每日資料更新與新聞判讀（F30、F09）<br>2. 監控 AI 品質與成本（F27、F12）<br>3. 平台維運與排程管理（F26）<br>4. 維護合規文案（F25） |
| **關鍵合作夥伴** | 1. LLM 與 Embedding 供應商（目前是 NVIDIA NIM 端點，`BE/core/config.py:58-59,86-88`）<br>2. 公開資料來源：證交所、櫃買中心、公開資訊觀測站、集保（F30）<br>3. 新聞來源：鉅亨網；自由財經的爬蟲預設暫停（F08）<br>4. Firebase（推播）、Google（登入）（F20、F23）<br>5. 綠界（金流，規劃中，F35） |
| **成本結構** | 1. LLM token：AI 摘要預熱、新聞判讀、AI 對話（F11、F09、F14）<br>2. 主機與資料庫：MySQL、Qdrant<br>3. 資料與新聞授權費（第 7.2 節）<br>4. 金流手續費（第 6 節）<br>5. 維運人力 |

---

## 4. 方案分級表

三級：**免費版**、**進階版**、**專業版**。所有方案都沒有廣告。

| 功能（ID） | 免費版 | 進階版 | 專業版 | 差別屬於 |
|---|---|---|---|---|
| 行情、K 線、技術指標、三大法人（F02–F05） | ✓ | ✓ | ✓ | 無差別 |
| **AI 投資分析：多空立場、三個區間展望、證據（F11）** | ✓ 完整內容，不需登入 | ✓ | ✓ | **無差別，不放付費牆** |
| **AI 判斷回顧、命中率（F12）** | ✓ | ✓ | ✓ | **無差別** |
| **新聞列表與事件影響分析（F08–F10）** | ✓ | ✓ | ✓ | **無差別** |
| AI 分析報告列印、存成 PDF（F13） | ✓ | ✓ | ✓ | 無差別 |
| 模擬投資與投資回顧（F21、F22） | ✓ | ✓ | ✓ | 無差別（核心學習功能） |
| 小燈「這頁怎麼看」導覽（F16） | ✓ | ✓ | ✓ | 無差別 |
| 站內通知：每日摘要、漲跌幅、重大新聞（F19） | ✓ | ✓ | ✓ | 無差別 |
| 匯出自己的帳號資料：模擬交易、對話紀錄（規劃中，屬於 F36 的一部分） | ✓ | ✓ | ✓ | 無差別（個資當事人權利，見 7.3） |
| AI 對話與小燈提問次數（F14、F16、F17） | 訪客每日 3 次（不保存）<br>會員每日 5 次 | 每月 300 次 | 每月 1,000 次 | 量 |
| 歷史對話保存（F15） | 最近 30 天 | 不限 | 不限 | 量 |
| 收藏股檔數（F18） | 10 檔 | 不限（目前系統涵蓋 40 檔） | 不限 | 量 |
| 多股比較同時檔數（F07） | 5 檔 | 30 檔（系統上限） | 30 檔 | 量 |
| 規則型歷史回測，用標準訊號設定進出場，不含 AI 判讀（F33，規劃中） | 每月 3 次 | 每月 30 次 | 不限 | 量 |
| 推播：Web、Android（F20） | — | ✓ | ✓ | 工具 |
| 自訂提醒規則（F38，規劃中） | — | 5 條 | 30 條 | 工具（免費版沒有）；進階版和專業版之間差在條數 |
| 桌面小燈（F39，規劃中） | — | ✓ | ✓ | 工具 |
| Email、LINE 通知（F37，規劃中） | — | — | ✓ | 工具 |
| 表格匯出 CSV、圖表存成圖片，附資料來源與日期（F36，規劃中） | — | — | ✓ | 工具 |

**設計說明：**
- **付費不會多拿到判讀內容。**個股的多空立場與趨勢判讀只透過 F11、F12、F09 提供，三者在每個方案都完整開放，訪客也看得到。AI 對話的額度限制的是「提問次數」。想知道某檔股票的 AI 判讀，不用問 AI 對話，直接看 F11 就好。
- **計算單位不同。**免費版以「每日」計，延續上學期「每日限額的免費問答」的說法；付費版以「每月」計，方便重度使用者集中使用，也讓每位付費者的成本有上限（第 6 節）。
- **規則型回測不呼叫 LLM。**做法和後台回測的「純規則」組相同（`BE/features/backtest/service.py`），成本只有運算。

---

## 5. 定價與理由

### 定價

| 方案 | 月繳 | 年繳 | 年繳折合每月 |
|---|---|---|---|
| 免費版 | 0 | 0 | 0 |
| 進階版 | NT$99 | NT$990（等於 10 個月） | NT$82.5 |
| 專業版 | NT$249 | NT$2,490（等於 10 個月） | NT$207.5 |

### 同類服務價格（查核日 2026-10-11）

| 服務 | 方案與價格 | 來源網址 | 備註 |
|---|---|---|---|
| 財報狗 | 個股方案：月繳 599、年繳 5,990，AI 助手每月 60 次<br>產業方案：月繳 799、年繳 7,990，AI 助手每月 120 次 | https://statementdog.com/pricing | 官方 |
| 玩股網 | 進階會員：月訂閱 199、年訂閱 1,990、365 天單次 2,388 | https://www.wantgoo.com/mall/category/13 | 官方商城；各方案功能內容 [待查證] |
| Yahoo股市 VIP | 月繳 299、年繳 2,990 | https://apps.apple.com/tw/app/id790214428 | App Store 台灣區上架頁 |
| CMoney 籌碼K線 | App 內購專業版一個月 480–680（同名項目有好幾個價）、一年 4,680–4,980 | https://apps.apple.com/tw/app/id981360113 | App Store 上架頁；清單和說明文字的價格不一致，所以寫成區間 |
| XQ 全球贏家 | 模組一個月 NT$300 起（台股進階模組 300、籌碼分析模組 500） | https://apps.apple.com/tw/app/id775687957 | App Store 上架頁；年費 [待查證] |
| 優分析產業資料庫 | 半年 7,800、一年 15,100 | https://store.uanalyze.com.tw/ | 官方；2026 年調價前後的對照 [待查證] |
| TradingView | 年繳折合每月：Essential US$12.95、Plus US$29.95、Premium US$59.95 | https://www.tradingview.com/pricing/ | 官方頁只列年繳價格；月繳價 [待查證] |
| Goodinfo! | 付費方案 [待查證] | https://goodinfo.tw/ | 網站可免費瀏覽，未找到公開的付費方案頁 |

### 定價理由

1. **賣的是量和工具，不是分析內容，所以價格壓在同類服務的低端。**
   - 進階版 NT$99，大約是查得到的最低台股會員月費（玩股網進階會員 199）的一半。
   - 專業版 NT$249，低於 Yahoo股市 VIP（299），也遠低於以研究內容為主的財報狗（599 起）。
2. **主要客群年輕、預算有限。**
   - 2026 年 9 月，30 歲以下新開戶約 4.1 萬人，占當月新開戶六成三；累積約 282.1 萬人，占 19.1%。
   - 來源：經濟日報 2026-10-02，引用證交所統計，https://money.udn.com/money/amp/story/5607/9789515
   - 總開戶數 14,763,301 人：中央社 2026-10-01，https://www.cna.com.tw/news/afe/202610010029.aspx
3. **年繳等於 10 個月，沿用同業慣例。**財報狗頁面寫年繳「省 2 個月」；玩股網年訂閱 1,990 正好是月費 199 的 10 倍。
4. **月繳手續費比例偏高，方案頁預設顯示年繳。**
   - 綠界一般賣家的國內信用卡費率是 2.75%，每筆最低 5 元，另收每筆訂單處理費 1 元，費用另加 5% 營業稅（https://www.ecpay.com.tw/Business/payment_fees）。
   - NT$99 月繳每筆手續費約 6.25 元，占 6.3%；年繳 990 約 29.6 元，占 3.0%。
5. **成本有上限。**
   - 進階版用滿 300 次，LLM 成本約 NT$56，加手續費仍低於 99。
   - 專業版用滿 1,000 次約 NT$186，加手續費約 NT$194，仍低於 249（試算見第 6 節）。

---

## 6. 收入與成本估算

> **下列數字都是假設，不是實測或預測。**標「假設」的是本組自訂的參數；標 [待查證] 的是還沒有可靠來源的成本。試算公式固定，換掉參數就能重算。

### 6.1 假設值

| 代號 | 假設 | 值 | 說明 |
|---|---|---|---|
| A1 | 註冊會員數 | 保守 1,000、基準 10,000、樂觀 50,000 | 假設。基準情境約是 30 歲以下累積開戶數（282.1 萬）的 0.35% |
| A2 | 付費轉換率（付費人數除以註冊會員數） | 保守 2%、基準 3%、樂觀 5% | 假設 |
| A3 | 付費方案組合 | 進階版 80%、專業版 20% | 假設 |
| A4 | 計費方式 | 全部以月繳計算 | 假設。實際有年繳的話，每人月收入最多少 1/6 |
| A5 | 免費會員每月活躍比例 | 30% | 假設 |
| A6 | 每人每月 AI 提問次數 | 活躍免費會員 15 次、進階版 120 次、專業版 400 次 | 假設。訪客的提問沒有算進去 |
| A7 | 每次 AI 提問的 token | 輸入 20,000、輸出 1,500（含規劃、選股、補查、回答等多次呼叫） | 假設。可以改用 `ai_usage_logs` 中 `feature='chat'` 的實測值 |
| A8 | 每份 AI 摘要的 token | 輸入 30,000、輸出 3,000 | 假設。可以改用後台「AI 摘要用量與估算成本」（F27）的實測值 |
| A9 | LLM 單價 | 輸入 0.20、輸出 1.20 美元／百萬 tokens | 取自專案設定預設值 `BE/core/config.py:75-76`，不是供應商報價；正式供應商的單價 [待查證] |
| A10 | 匯率 | 1 美元 = 32 新臺幣 | 假設 |
| A11 | 每月交易日 | 22 天 | 假設 |

依上表推算：
- 每次 AI 提問約 0.0058 美元，等於 **NT$0.19**。
- 每份 AI 摘要約 0.0096 美元，等於 NT$0.31。

### 6.2 成本項目

| 成本項目 | 怎麼算 | 每月金額 | 依據 |
|---|---|---|---|
| AI 摘要預熱（固定） | 40 檔 × 22 交易日 × 每份 0.0096 美元 | 約 NT$270 | 40 檔：`BE/jobs/market/stock_info.py:14-20`；token 用 A8 |
| 新聞事件判讀（固定，取上限） | 每輪上限 0.50 美元 × 30 輪 | 最多 NT$480 | `BE/core/config.py:125-126`，程式裡的成本上限 |
| AI 對話（變動） | 提問次數 × NT$0.19 | 見 6.3 | A6、A7、A9 |
| Embedding（新聞向量化、檢索） | — | [待查證] | 目前用 NVIDIA NIM 的 embedding 端點（`BE/core/config.py:86-88`）。NVIDIA 官方 FAQ 說 API 端點限原型開發，正式上線需要 NVIDIA AI Enterprise 授權，「start at $4500 per GPU per year」：https://docs.api.nvidia.com/nim/docs/product |
| LLM 供應商換約 | — | [待查證] | 理由同上。正式上線不能沿用試用端點，需要改用付費 API 或自架 |
| 主機 | 目前部署在自有的 Windows 主機（`.github/workflows/ci-cd.yml` 的 Deploy to Windows） | [待查證] | 電費、硬體折舊或雲端主機報價都還沒查 |
| Qdrant 向量庫 | 目前自架（Docker） | 自架不收授權費；Qdrant Cloud 付費起價 [待查證] | Qdrant Cloud 免費方案是 1GB RAM、4GB 磁碟，標示用於測試：https://qdrant.tech/pricing/ |
| 推播 | Firebase Cloud Messaging | 0 | 官方標示 No-cost：https://firebase.google.com/pricing |
| 金流手續費 | 每筆 max(2.75% × 金額, 5 元) × 1.05 + 1 元 | 見 6.3 | https://www.ecpay.com.tw/Business/payment_fees |
| 行情資料授權 | — | 盤後資訊可能 0，也可能每月 5 萬元起，[待查證] | 見 7.2 |
| 新聞授權 | 鉅亨網、自由財經 | [待查證] | 見 7.2 |
| 網域、SMTP 寄信、維運人力 | — | [待查證] | — |

### 6.3 情境試算（每月，新臺幣）

| 項目 | 保守 | 基準 | 樂觀 |
|---|---|---|---|
| 註冊會員（A1） | 1,000 | 10,000 | 50,000 |
| 付費人數（A2） | 20 | 300 | 2,500 |
| 其中進階版、專業版（A3） | 16、4 | 240、60 | 2,000、500 |
| **訂閱收入** | **2,580** | **38,700** | **322,500** |
| 金流手續費 | 133 | 1,991 | 16,595 |
| AI 對話：免費會員 | 818 | 8,101 | 39,672 |
| AI 對話：進階版 | 356 | 5,345 | 44,544 |
| AI 對話：專業版 | 297 | 4,454 | 37,120 |
| 固定 LLM（摘要預熱加新聞判讀上限） | 750 | 750 | 750 |
| **貢獻毛利**（還沒扣主機、授權、人力） | **225** | **18,057** | **183,819** |

**每位付費者的單位經濟**（月繳）：

| 方案 | 收入 | 手續費 | 平均 LLM 成本 | 貢獻 | 用滿額度時的貢獻 |
|---|---|---|---|---|---|
| 進階版 | 99 | 6.25 | 22.3（120 次） | 70.5 | 37.1（300 次） |
| 專業版 | 249 | 8.19 | 74.2（400 次） | 166.6 | 55.2（1,000 次） |

**損益兩平：**
- 在基準假設下，扣掉免費會員攤到的 AI 對話成本後，每位付費者每月淨貢獻約 NT$62.7。
- 只要 12 位付費者，就能打平固定 LLM 成本（NT$750）。
- 如果行情授權被認定要付每月 5 萬元（7.2），需要約 810 位付費者；以 3% 轉換率換算，約 27,000 位註冊會員。

**解讀：**
- 免費會員的 AI 對話是最大的變動成本。在基準情境，免費會員的對話成本（8,101）比進階版（5,345）還高。所以免費版的 AI 對話用每日上限控管，F11 則用「預先產生、全站共用」的方式免費提供。
- 主機、授權、人力都還是 [待查證]。上面的「貢獻毛利」只能說明變動成本能不能被收入涵蓋，**不代表整體獲利**。

---

## 7. 風險控管

### 7.1 投顧法規

**法條：**
- 《證券投資信託及顧問法》第 4 條：證券投資顧問指「直接或間接自委任人或第三人取得報酬」，對有價證券的投資或交易「提供分析意見或推介建議」。https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0400121&flno=4
- 同法第 107 條：未經許可經營證券投資顧問業務，處 5 年以下有期徒刑，併科新臺幣 100 萬元以上 5,000 萬元以下罰金。https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0400121&flno=107
- 《證券投資顧問事業管理規則》第 25 條之 1：自動化投資顧問（機器人理財）是「透過演算法由系統自動產生之投資組合建議」，只有投顧事業能提供。https://law.fsc.gov.tw/LawContent.aspx?id=GL000529

**對應做法：**
1. 付費只買量和工具（第 4 節），個股的多空立場、趨勢判讀對所有人免費。
2. 方案頁和行銷文案不寫「投資顧問」「明牌」「勝率」「保證獲利」。上學期的「AI 投資顧問」一律改稱「AI 對話」。
3. 現有免責聲明已寫明本站不是投顧事業、不提供個別有價證券的投資建議、不收取投資顧問費用（`FE/pages/disclaimer.tsx`）。方案頁要再加一段說明：付費內容不含投資建議（第 8 節）。

**殘餘風險：**第 4 條也涵蓋「間接」取得報酬。付費版的 AI 對話次數比較多，只要對話內容包含個股分析意見，仍可能被認定為間接收費。程式目前的情況會放大這個風險，見下表。如果真的要收費，必須先調整這些地方，並取得法律意見 [待查證]。

**目前系統與本文件定位的落差**（報告揭露用，這個階段不改程式）：

| 落差 | 證據 |
|---|---|
| AI 對話的系統提示允許「選股推薦與有條件的買賣看法」，也會寫「建議投入可用資金X元」 | `BE/features/chat/prompts.py:106-108`、`BE/features/chat/prompts.py:137-139` |
| 合規規則（目標價、操作指令、保證用語等）已寫好，但正式 AI 摘要流程標示為只做結構驗證，沒有套用這些規則 | `BE/features/analysis/compliance.py`、`BE/features/analysis/service.py:63,67` |
| 趨勢預測端點會輸出目標價和 1–5 的信心分數，不需登入，前端沒有使用 | `BE/features/analysis/prediction.py:15-49` |

### 7.2 資料授權

**行情資料：**
- 證交所網站使用條款：未經書面同意，不得重製、散布網站資料。https://www.twse.com.tw/zh/terms/use.html
- 證交所 FAQ：加值後提供他人使用，須取得同意並簽訂書面契約。https://www.twse.com.tw/zh/products/information/qa.html
- 《交易資訊使用管理辦法》（110.12.24）：
  - 第 3 條：盤後資訊指市場交易時間以後傳播的當日行情。
  - 第 29 條：提供盤後資訊給資訊用戶，「得報經本公司同意後，不收取費用」。
  - 出處：https://twse-regulation.twse.com.tw/m/LawContent.aspx?FID=FL007129
  - 本系統只用收盤後資料（`FE/pages/disclaimer.tsx` 第二節），**適用第 29 條的可能性較高，但需要申請同意**。
- 收費標準（109.01.03 版，可能已調整）：非自動更新的網頁報價，註冊會員未滿 20 萬戶時每月 5 萬元。https://twse-regulation.twse.com.tw/m/LawContent.aspx?FID=FL007126
  - 本系統是否屬於這一類 [待查證]。第 6 節的損益兩平已列出最壞情況。
- 櫃買中心、公開資訊觀測站、集保的商業使用條款 [待查證]。證交所 OpenAPI 頁面沒有授權文字 [待查證]。

**新聞：**
- 鉅亨網新聞由爬蟲取得（`BE/jobs/crawlers.py`），自由財經的爬蟲預設暫停。
- `/news` 端點不需登入，會回傳新聞全文（`BE/features/news/schemas.py`）。
- 商業使用需要和新聞來源簽授權 [待查證]。對應做法：付費前改成只顯示摘要、事件判讀和原文連結。

**對應做法：**
- 付費方案不提供原始行情 API 或資料轉售。
- 專業版的 CSV 匯出與圖表存圖（F36）限個人使用，並附資料來源與日期。

### 7.3 免責聲明與個資

**現有的免責機制：**
- `/disclaimer` 七節聲明（`FE/pages/disclaimer.tsx`）。
- 首次造訪的風險提示條（`FE/components/layout/RiskNoticeBanner.tsx`）。
- AI 摘要附固定免責文字（`BE/features/analysis/validation.py:39-44`）。
- AI 對話輸入框下方的固定提醒（`FE/features/ai/ChatInput.tsx`）。後端不在回覆裡附加投資提醒，對話提示也照實告訴模型「投資提醒由網站介面固定顯示」（`BE/features/chat/prompts.py:114`）。
- 複製 AI 回覆時，最後附上同一句提醒（`FE/lib/utils/chatCitations.ts` 的 `chatCopyText`）。

**要補的內容：**
- 方案頁和結帳示意頁要寫明：
  - 這是專題展示，不實際收費。
  - 付費內容只有量和工具，不包含投資建議。
- 免責聲明目前寫「專題作品…不收費」，展示方案頁時要同步更新說法（第 8 節）。

**個資：**
- 《個人資料保護法》第 3 條：當事人可以請求閱覽、製給複製本，這些權利「不得預先拋棄或以特約限制之」。https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=I0050021&flno=3
- 所以「匯出自己的帳號資料」放在所有方案（第 4 節），不當作付費工具。

### 7.4 AI 輸出錯誤

**現有機制：**
- AI 摘要附證據清單，狀態分成 verified、limited、unavailable（`BE/features/analysis/schemas.py`）。
- 公開歷史命中率，並和「每次都猜漲」的基準、大盤比較（F12，`BE/features/analysis/track_record.py`）。
- 回答回饋（F15）。
- 後台 AI 成效：全站命中率與回答回饋統計（F27）。
- 訊號檢驗與回測工具，用來驗證判讀依據（F28、F29）。

**對應做法：**
1. 方案頁明確寫出：AI 可能出錯，付費不會提高 AI 的準確度，付費差異和 AI 判讀品質無關。
2. 命中率持續公開，不挑對自己有利的區間（`track_record.py` 只計入分析日後 4 天內產生的摘要，排除事後重跑）。
3. 每份 AI 摘要都標示資料日期，提醒不是即時資料。
4. 退費規則：數位內容適用的消費者保護法例外條款 [待查證]。

**成本風險：**
- 目前 `/api/ask`、`/analyze/stock-behavior/text-brief`（帶 `force_refresh`）、`/api/trend_predict` 都不需登入，也沒有限流，任何人都能觸發 LLM 呼叫（`BE/features/chat/router.py`、`BE/features/analysis/router.py`）。
- 真的要實作方案時，額度機制要先擋住這些入口。

---

## 8. 畫面對應清單

「需要後端」欄的寫法：
- **不需要**：純前端靜態內容。
- **展示用靜態資料**：先用前端寫死的方案狀態和用量展示。
- **後續**：要等後端額度、訂閱或金流做好才能真正運作。

| # | 路由 | 新增或調整 | 要顯示的內容 | 需要後端 |
|---|---|---|---|---|
| 1 | `/pricing` | 新增 | 三級方案表（第 4 節）、月繳和年繳切換（預設年繳）、「AI 判讀為什麼全部免費」說明、常見問題、專題展示不實際收費的聲明 | 不需要 |
| 2 | `/pricing` 方案按鈕 → `/checkout` | 新增 | 選定方案摘要、金額、綠界測試環境說明；這個階段按鈕顯示「專題展示，未開放付款」 | 後續（綠界測試環境，`https://payment-stage.ecpay.com.tw`，文件：https://developers.ecpay.com.tw/2900/） |
| 3 | `/me` | 調整：新增「我的方案」區塊 | 目前方案、本月 AI 提問用量、收藏股已用和上限（例如 7／10）、到期日、前往 `/pricing` | 展示用靜態資料；後續接額度 API |
| 4 | `/ai` | 調整 | 輸入框旁顯示剩餘提問次數；用完時的提示卡說明可升級，也說明 AI 投資分析（F11）不受限，附個股頁連結 | 展示用靜態資料；後續 |
| 5 | 全站小燈面板 | 調整 | 和 `/ai` 共用剩餘次數與用完提示 | 展示用靜態資料；後續 |
| 6 | `/favorites` | 調整 | 「已收藏 x／10 檔」；免費版加到第 11 檔時的提示 | 展示用靜態資料；後續 |
| 7 | `/compare` | 調整 | 免費版超過 5 檔時提示上限，並說明付費版可以比到 30 檔 | 展示用靜態資料；後續 |
| 8 | `/notifications` | 調整 | 「此裝置推播」標示進階版起；Email、LINE、自訂提醒規則以「規劃中」加方案徽章呈現 | 展示用靜態資料；後續 |
| 9 | `/stock/[id]` | 調整 | AI 投資分析卡加一行「所有方案皆可完整檢視」 | 不需要 |
| 10 | `/disclaimer` | 調整 | 新增「付費方案的範圍」：只差量與工具，不提供投資建議，專題展示不實際收費；更新 `LAST_UPDATED` | 不需要 |
| 11 | 頁尾導覽、選單抽屜 | 調整 | 新增「方案」連結（`FE/lib/nav.ts` 的 `FOOTER_NAV`） | 不需要 |
| 12 | `/`（「觀測台以外」區塊） | 調整 | 新增方案入口卡 | 不需要 |
| 13 | `/admin` | 調整：新增分頁「方案與營收（展示）」 | 各方案人數、每月經常性收入，並和「AI 摘要用量與估算成本」（F27）並列；資料讀 `ai_usage_logs` 中對話的實際用量 | 展示用靜態資料；後續接訂閱資料和 `ai_usage_logs` |
| 14 | `/pricing#desktop` | 新增區塊 | 桌面小燈介紹（規劃中），標示進階版起 | 不需要（介紹）；實際的桌面版是後續 |
