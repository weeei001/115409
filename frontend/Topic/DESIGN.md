# DESIGN.md — 股海明燈設計規範

風格：**燈塔表（Light List）**。全站排成一本航海用的燈塔名錄：每檔股票是一筆條目，代號是編號、產業是所屬海岸、收盤／漲跌／資料日是它的燈質。
兩套主題是同一天的兩個班：dark＝**夜海**（夜班），light＝**晨海**（晨班），品質要求相同。
token 的實際數值只寫在 `styles/main.css`，這裡寫用途與規則。圖表需要解析後的色值，放在 `lib/charts/theme.ts`；手機網址列的 `theme-color` 也寫了 `--background` 的解析值（`components/layout/ThemeColorMeta.tsx`）；首屏晨班文案襯底的取色寫在 `features/home/HomeHero.tsx`（`DAWN_SCRIM`）。改 token 時這幾處要一起改。

三個識別特徵：

1. **條目列**（`components/common/LightEntry.tsx`）：代號、名稱（下方小字產業與資料日）、收盤、帶正負號的漲跌。全站共用。
2. **圖廓**（`neatline` utility）：每頁只有一個，框住該頁的主圖表，上緣與左緣有海圖刻度。
3. **燈只當光用**：燈色（`brand`）只出現在 focus、選取列的標線、主要按鈕、光束，永遠不代表漲跌或狀態。一個視窗最多兩個燈色元素。內文連結用中性細底線（`decoration-input`），hover 轉墨色（`components/ui/button.tsx` 的 `textLinkClass`）。

## 1. 色彩 token

一律用 token，不在元件裡寫 hex，也不用 Tailwind 的原生色（`red-500`、`emerald-*`…）。Light 是 `:root`，Dark 是 `.dark`。

| 用途 | Tailwind class | 規則 |
|---|---|---|
| 頁面底／面板／彈出層 | `bg-background`、`bg-card`、`bg-popover` | 晨海是冷色霧底加純白面板，不用米白 |
| 次要底色 | `bg-muted`、`bg-secondary`、`bg-accent` | 表頭、選取列、hover 列、輸入框 |
| 文字 | `text-foreground` > `text-subtle` > `text-muted-foreground` | 由主到次 |
| 線 | `border`（細線）、`border-border-strong`（粗線） | 粗線用在帳頁標題下方與圖廓；輸入框外框用 `border-input`（對比 ≥ 3:1） |
| 燈 | `bg-brand`、`text-on-brand`、`border-brand-deep`、`text-brand-text` | 見上方第 3 點。燈色上的字用 `text-on-brand`；金色文字只用 `text-brand-text` |
| focus | `focus-lamp` utility；捲動容器裡用 `focus-lamp-inset` | 外圈 `--focus`、內圈燈色；晨海外圈是墨色（燈色在白底只有 1.86:1）。元件貼著 `overflow` 容器邊緣時（橫向捲動的分頁與圖例、抽屜與清單裡的滿寬列）改用 `focus-lamp-inset`：兩圈畫在元件內側，外圈貼邊、燈色在內，不會被裁掉。程式移過去的大容器（`main`、`section`）不顯示框：`outline-none focus-visible:shadow-none` |
| 漲／跌 | `text-up`、`text-down`、`bg-up-muted`、`bg-down-muted`、`text-up-emphasis`、`text-down-emphasis` | 見第 7 節 |
| 狀態 | `danger`、`success`、`warning`（各有 `-muted`、`-border`），`text-warning-icon` | 錯誤、成功、警告；刻意避開漲跌的紅綠，也不用燈色 |
| 海報上的文字襯底 | `--scrim`（首屏用 inline style 的 `var(--scrim)`） | 首頁首屏的文案襯底 |
| 小燈像素圖 | `--mascot-line`、`-eye`、`-body`、`-shade`、`-glass`、`-lamp`、`-lamp-dim`、`-lamp-off`（SVG `fill` 直接用 `var()`） | 只給站內助手（第 12 節）。黑白條紋，不用紅白；燈只用燈色 |
| 捲軸 | 全站統一（`styles/main.css` base 層），元件不用另外寫；要藏起來用 `scrollbar-none` | 透明軌道、`--input` 色的細滑塊、沒有箭頭，hover 加粗轉 `--muted-foreground`。元件不要設 `scrollbar-color`／`scrollbar-width`（`none` 除外）：Chromium 會改走標準捲軸，箭頭又跑回來 |

沒有漸層、玻璃、光暈；唯一的光暈是首屏海報裡的燈。

## 2. 字型

- 顯示標題：`font-serif` = Noto Serif TC 900（只載入 900）。用在 h1、帳頁 h2。
- 介面與內文：`font-sans` = Noto Sans TC 400／500／700。
- 數字與代號：`font-mono` = IBM Plex Mono 400／500／600，一律加 `tabular-nums`。
- 字型由 `pages/_app.tsx` 用 `next/font/google` 自架載入，寫進 `--font-app-serif／sans／mono`；`styles/main.css` 的 `--font-*` 引用它們，並列同一組字族當退路。要換字型時，兩邊一起改。

| 角色 | class | 用在 |
|---|---|---|
| Display | `font-serif font-black tracking-[0.03em]`；lg 以上 `text-[clamp(44px,min(6.2vw,9svh),86px)] leading-[1.12]`，手機 `text-[clamp(32px,10.2vw,46px)] leading-[1.14]` | 首頁 h1（`HomeHero.tsx`） |
| Chapter | `font-serif font-black text-[clamp(28px,3.3vw,46px)] leading-[1.22]` | 觀測台標題 |
| Page title | `font-serif font-black text-[clamp(1.625rem,3.2vw,2.75rem)] leading-[1.2] tracking-[0.04em]` | 各頁 h1（`SiteHeader` 輸出） |
| Section | `font-serif font-black text-xl tracking-[0.06em]` | 帳頁 h2（`Ledger`） |
| Panel caption | `text-[13px] font-medium tracking-[0.04em] text-muted-foreground` | 面板 h3（`LedgerPanel`） |
| Body | `text-[15px] leading-[1.8]`；文章 `text-[17px] leading-[1.9]`，行寬 34em | 內文 |
| Note | `text-[13px] leading-relaxed`，最小 12px | 免責、空狀態 |
| Figure XL | `font-mono font-semibold tabular-nums text-[clamp(30px,3vw,40px)]` | 主要收盤價 |
| Figure | `font-mono tabular-nums text-[13.5px]` | 表格數字 |
| 燈質列 | `characteristic` utility | 條目的代號／產業／資料日、單位。內容只放真實資料，不放裝飾用英文 |

標題不用斜體強調字；區塊不用「01／02／03」編號（唯一的編號是股票代號）。

## 3. 間距與版面

- 頁面容器：`mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-10`，主內容 `py-6 lg:py-10`；頁首用同一個寬度。文章內文 68ch。
- **帳頁**（`components/common/Ledger.tsx`）取代卡片格：`Ledger` 是襯線標題＋右側燈質列＋一條粗線，底下的 `LedgerPanel` 之間用 1px 線分隔（父層 `gap-px bg-border`、子層 `bg-card`），不留間距、不用陰影。欄位依內容切 8/4、7/5 或 4/4/4。
- 面板內固定順序：標題與單位 → 讀數 → 圖或刻度 → 日期戳記（`DataStamp`）。
- 帳頁之間 `gap-10 lg:gap-16`；面板內距 `p-4 sm:p-5`；表格列高至少 44px。
- 帳頁結尾可以放一列 `NextStep`（一行字加一個真的連結）。

## 4. 圓角

面板、表格、抽屜、對話框是方角（`rounded-xl` 以上都是 0）；按鈕、輸入框、分頁、徽章是 2px（`rounded-sm`／`md`／`lg`）。唯一的圓形是狀態燈點（`rounded-full` 只用在 6～8px 的點）。不用膠囊按鈕。

## 5. 陰影

面板沒有陰影，靠線分隔。只有浮在內容上方的層（popover、sheet、回到頂部鈕、小燈按鈕與面板）用 `shadow-raised`。

## 6. 元件

- **shadcn 元件**在 `components/ui/`（Radix）。新增方式見 `CLAUDE.md`。`Button` 的 `default` 是燈色主要按鈕，一個畫面只放一顆；其餘用 `outline`／`ghost`。預設高度 44px。
- **面板**：用 `Ledger`／`LedgerPanel`（規則見第 3 節「帳頁」）。個股頁小卡用 `features/stock/cards/CardShell.tsx`。
- **條目列**：`LightEntry`。可點的列加 `lamp-row`：hover 只換淺色底；左側 2px 燈色標線只給選取（`data-selected="true"`、`aria-current="page"`、`aria-selected="true"`），滑鼠停在別列時才不會看起來有兩列被選取；停用時半透明、不反白。
- **燈質記號**（`LightGlyph`／`DataStamp` 的 `state`，在 `components/common/Ledger.tsx`）：8px 的燈標資料狀態——Q 急閃（墨色，每秒一次）＝讀取中、F 定光（實心）＝已載入、熄燈（空心加斜線）＝失敗。放在面板標題或戳記旁，不另外加文字也看得懂。
- **圖廓的光束與水深註記**：主圖表資料到位時，圖廓內一道燈色線由左掃到右一次（`neatline-sweep`，用 `key` 綁資料才會重播）；圖廓上緣寫實際畫出的首尾日期、左緣寫畫出的高低價（`components/charts/NeatlineSoundings.tsx`）。
- **提示與狀態**（都在 `components/common/Notice.tsx`）：
  - `Notice`：tone 為 `danger`／`warning`／`success`／`info`，一律附圖示；danger 預設 `role="alert"`，圖示是熄掉的燈。
  - `EmptyState`：一盞沒有光束的燈加一句說明；有真正的下一步時傳 `action`（連結或按鈕）。
  - `LoadingRows`：有線的空白列加掃過的光帶，並且寫出「讀取中…」；用 `className` 給高度。
  - 同一個畫面的錯誤只說一次；依賴它的面板改顯示靜止的說明，不要一邊報錯一邊繼續閃載入。
- **詳細內容放右側抽屜**：`features/stock/DetailDrawer.tsx`，內容只在打開時掛載，關閉後焦點回到觸發鈕。
- **可收合表格**：`components/common/CollapsibleSection.tsx`，預設收合；手機加 `TableScrollHint`。
- **圖示**只用 `lucide-react`，不用 emoji 當圖示。品牌標誌是 `components/common/BrandMark.tsx`、站內助手的像素小燈是 `features/assistant/LighthouseMascot.tsx`（都是商標圖形，不算介面圖示）。圖示預設用文字色或 `text-muted-foreground`，不用燈色。
- **觸控目標至少 44px**：圖示按鈕 `size-11`，文字按鈕 `min-h-11`。
- **Toast**：`sonner`（`components/layout/AppToaster.tsx`），顏色已接上狀態 token；2px 圓角（`--radius`）、在底部置中、不放小關閉鈕。
- **頁首**：子頁用 `components/layout/SiteHeader.tsx`，首頁用 `features/home/HomeHeader.tsx`。`lg` 以上顯示主導覽（`PrimaryNav`，目前頁用粗線標示、不用燈色）；股票搜尋在子頁是 `HeaderStockSearch`（`lg` 以上），首頁頁首在 `md` 以上直接放 `StockSearch`。主選單抽屜（`AppNavDrawer`）各寬度都有，手機靠它導覽。h1 是頁面的任務或主體（登入、台積電、新聞標題），不是品牌名。

## 7. 台股紅漲綠跌

- 漲、買超、偏多：`up`（紅）；跌、賣超、偏空：`down`（綠）；0 或缺值：中性。
- 依**數值正負**上色，不是依欄位上色。helper 在 `lib/utils/tone.ts`（`getValueTone`、`valueToneText`、`toneBadge`）。
- 漲跌數字一律帶正負號（`signedText`），不只靠顏色。負號一律 U+2212，helper 都在 `lib/utils/format.ts`（`signedText`、`withSign`、`uMinus`）；`fmtPercent`、`fmtAmount`、`fmtNum`、`fmtPrice` 與圖表 `valueAxis` 的預設刻度也都輸出 U+2212，自己用 `toFixed`、`toLocaleString` 寫數字時要套 `uMinus`。
- 新聞事件影響方向：正向用 up、負向用 down，其餘（中性、正負並存、方向未明）一律中性（`lib/utils/newsImpact.ts`）。
- RSI 超買、超賣不是漲跌方向，用 `warning`（`lib/utils/indicatorSignals.ts`）。
- 同一張卡的買進量、賣出量不上漲跌色，只有淨額上色。
- 成交量、法人買賣超一律用「張」（1 張 = 1,000 股，四捨五入到整數張），同一欄不在股／萬股／億股之間切換；不滿 1 張的非零值寫「不到 1 張」、不帶號、不上漲跌色。helper 在 `lib/utils/format.ts`（`fmtVolume`、`lotToneValue`；帶正負號的買賣超用 `signedShares`、`signedLots`）。模擬投資的持股與委託數量仍用股。
- 買進／賣出的確認按鈕用中性的燈色，方向只用標線或文字表示。
- 資料是最近儲存的收盤，不是今天的：不寫「今日」「即時」，寫「最近交易日」並附日期。每個漲跌幅都要在數字旁寫明區間（例如「近 30 個交易日漲跌幅」）。
- 新聞列每個影響對象只顯示一個方向標籤（`features/news/impactGroups.ts`）：方向一致就顯示那個方向，正負都有就顯示中性的「正負並存」，其他不一致的組合顯示中性的「方向未明」；同一對象有多項事件時另外附「N 項事件」。

## 8. 圖表色

一律從 `lib/charts/theme.ts` 取色，不在圖表程式裡寫 hex。

| 函式 | 用途 |
|---|---|
| `getChartPalette(isDark)` | 格線、軸、tooltip、燈色（只給十字線與選取用）、`up`／`down`／`flat`、成交量柱色 |
| `getMaColors(isDark)` | MA5 藍、MA10 紫、MA20 青、MA60 褐、MA120 灰藍；避開紅綠，也避開燈色 |
| `getInstitutionColors(isDark)` | 外資、投信、自營各一色，依法人上色、不依正負 |
| `AI_SERIES_PALETTE` | AI 對話圖表的類別色（`SERIES_PALETTE` 去掉橘、琥珀、褐與洋紅），不帶漲跌意義 |
| `COMPARE_SYMBOL_COLORS` | 多股比較依清單順序給每檔一個顏色（最多 6 檔，不撞色） |
| `correlationColor(value, isDark)`、`correlationGradient(isDark)` | 相關係數色階（負藍、0 灰、正橘），格子與圖例共用同一個函式 |

- 帶正負的單一序列（例如法人合計柱）依正負上色，0 用 `flat`。
- 單一主線（收盤、RSI、DIF、K、中軌）用 `palette.text`（墨色），不用燈色。
- 所有 ECharts 圖共用 `lib/charts/adapters.ts` 的 helper（`baseAxis`、`valueAxis`、`tooltip`、`legend`、`lineLook`、`chartGrid`、`shortDateLabel`）：圖例色樣依序列型別（線是細條、虛線是兩段、柱是方塊，不用圓點）、線不平滑也不畫節點（hover 才出現）、軸字用等寬字 11px、tooltip 方角無陰影、柱子方角、日期軸顯示 MM-DD。不用漸層面積。
- K 線、成交量柱：漲 `up`、跌 `down`、平盤 `flat`。
- 圖表函式庫的用法見 `charts-tei` skill。

## 9. RWD

- 斷點用 Tailwind 預設：`sm` 640、`md` 768、`lg` 1024。`useIsMobile()`（`lib/hooks/useClientEnv.ts`）以 1023px 以下算手機版版面。
- 兩個例外：頁首在 `xl`（1280）以上才放寬主導覽內距並顯示「大盤收盤 · 非即時」戳記（1024～1279 時七個項目加搜尋會擠到換行）；`/ai` 在 `lg` 以上是全螢幕工作台（下一點）。
- `/ai` 工作台（`pages/ai.tsx`、`features/ai/ChatArea.tsx`、`features/ai/layout.ts`）：`lg` 以上標題區只留給螢幕報讀器、不放頁尾，頁首與工作台滿版，工作台四周留 16px、剛好一個視窗高，整頁不捲動。三欄的標題列同高（h-14）、底下同一條粗線：歷史欄可收合成細條（沒設定時 1440 以上展開）；對話欄的訊息與輸入列在 46rem 的閱讀欄置中；資料欄從頂端到底，和對話欄之間的分隔線可拖曳或用方向鍵調整（資料欄最窄 22rem、對話欄最窄 24rem），也可放大蓋住對話欄（Esc 還原）或收起。欄寬與收合記在 localStorage（`tei:ai-*`）。資料面板裡的指標格欄數與圖高依面板寬度（container query）決定，不看視窗寬度。手機維持整頁捲動。
- 手機優先寫法：先寫單欄，再用 `md:`、`lg:` 加欄數。
- 詳細內容抽屜（`DetailDrawer`）在手機全寬，`sm` 以上最寬 `min(1100px, 90vw)`。
- AI 證據詳情：`lg` 以上是右欄 sticky，以下改成底部 sheet。
- 驗收寬度：375px 與 1440px，light、dark 都要看；不可出現橫向捲動。
- 瀏海、底部手勢區用 `--app-safe-area-*` 變數閃開。貼著畫面底部的內容改用 `--app-bottom-inset`：它是手勢區與首次造訪風險提示條（`--risk-notice-height`，提示條自己寫入）兩者取大，提示條在時不會蓋住內容。Capacitor App 的狀態列與手勢列圖示顏色跟著網站主題（`components/layout/ThemeColorMeta.tsx` 呼叫 `SystemBars.setStyle`）。

## 10. 動效

節奏來自燈質「Fl W 10s」：週期 P = 10 秒（燈塔的兩道光束 20 秒轉一圈，每 10 秒掃過一次），所有時長都是 P 的分數（token 在 `styles/main.css`）。

| token | 時長 | 用在 |
|---|---|---|
| `--dur-flash` | 125ms | hover 變色、按下、換頁淡出 |
| `--dur-sweep` | 250ms | 分頁標線、換頁淡入（上移 8px） |
| `--dur-beam` | 625ms | 區塊進場、頁首粗線畫出、主題顏色過渡 |
| `--dur-quick` | 1000ms | 燈質 Q 急閃、載入列的光帶 |
| `--dur-eclipse` | 1250ms | 場景溶接、晨夜混合、圖廓光束 |

緩動：`--ease-flash`（快進）、`--ease-swell`（海與相機）。Tailwind 寫法：`duration-(--dur-flash) ease-flash`；沒寫 `ease-*` 時預設就是 `--ease-flash`（`@theme` 的 `--default-transition-timing-function`）。

- 使用 `motion/react`；`pages/_app.tsx` 已設定 `MotionConfig reducedMotion="user"`。
- 區塊進場用 `components/common/AnimatedSection.tsx`（淡入並上移 8px，625ms）。
- 換頁在 `components/layout/AppShell.tsx`；`SiteHeader` 標題區的粗線每次換頁由左到右畫出（`anim-beam-draw`）。
- **載入＝燈質 Q（急閃）**：骨架用 `q-rows`（有線的空白列，一道光帶每秒掃過一次），不用灰色圓角塊。
- **空資料＝燈質 F（定光）**：`EmptyState`，不動。**錯誤＝熄燈**：`Notice tone="danger"`，不動。
- hover 不做傾斜與放大；只適合滑鼠的效果要用 `useCanHoverTilt()` 判斷 `(hover: hover) and (pointer: fine)` 才啟用。唯一的 hover 位移是列尾箭頭右移 2px（`group-hover:translate-x-0.5`）。浮層（popover）開合只淡入淡出，不縮放。
- 抽屜（`components/ui/sheet.tsx`）開用 `--dur-beam`、關用 `--dur-sweep`，遮罩同步。
- focus 立即出現，不做動畫：focus 狀態一律 `transition: none`（`styles/main.css` 的 base 規則與 `focus-lamp`），連外圈顏色都不漸變。
- 按鈕忙碌（送出、重新整理中）：文字改成進行中的說法（「處理中…」「更新中…」）並加 `aria-busy`，不用轉圈圖示。
- 換班（切換主題）：顏色過渡 625ms，標了 `data-stagger` 的面板每張延遲 25ms（`lib/theme/ThemeContext.tsx`）；減少動態時不過渡，直接換色。
- `prefers-reduced-motion`：CSS 會把動畫與過渡壓到幾乎為 0，`AnimatedSection` 與換頁直接不做動畫（只改動畫參數，不換掉元件結構，否則整頁會在載入後重掛），Q 光帶靜止；程式捲動（`scrollTo`、`scrollIntoView`）改用 `behavior: 'auto'`。

## 11. 首頁首屏

- 結構：`features/home/HomeHero.tsx` 是首屏，一個視窗高（`100svh` − 頁首）：燈塔海報加真正的 DOM 文字（燈質列、h1、一句說明、「直接看行情」），往下直接是觀測台（`features/home/terminal/ObservationTerminal.tsx`）。沒有 3D 場景，也沒有捲動驅動的動畫。
- 海報夜班／晨班各一張，主題 class 在首次繪製前就寫在 `<html>`，用 `dark:` 選圖才不會閃；直式窄螢幕用 720×1440 的直幅版本。文字底下是柔邊襯底：夜班用 `--scrim`，晨班是貼合文字塊的柔邊橢圓（取海報的冷色天光），不是卡片或全寬橫條。
- 燈質列寫加權指數、漲跌與收盤日（`features/home/boardFormat.ts`，跟觀測台同一組格式函式）；沒有資料時寫「最近儲存的收盤資料 · 非即時」。
- 海報在 `public/beacon/`：第 1 張（橫式＋直式）是首屏；第 3、4 張（橫式）用在登入、註冊頁（`features/auth/AuthForm.tsx`）。第一張 ≤ 70KB，其餘 ≤ 90KB。

## 12. 站內助手「小燈」

- 右下角站在一小片像素海浪上的燈塔（`features/assistant/`），點開是可以直接對話的面板，用的是和 AI 對話頁同一支 `/api/ask`（`useChat({ listHistory: false })`，不抓歷史清單）。掛在 `AppShell`，換頁時對話還在；登入使用者的對話照樣存進 AI 對話紀錄，面板右上角可以帶著這則對話開 `/ai?c=<對話 ID>`。
- 造型：26×25 格的像素圖（`sprite.ts`）：上方 4 列留給跳躍與頭頂的字，中間是 20×18 的燈塔（`MASCOT_BODY`），最下面 3 列是會往左流的海（股海）。黑白條紋燈塔，不畫紅白（紅＝漲）；顏色全部來自 `--mascot-*`（含 `--mascot-sea` 浪頂、`--mascot-water` 海水）。這是唯一的像素圖，介面其他地方不跟著用像素風。
- 表情與動作只跟著對話狀態和使用者的操作走，**不跟行情漲跌走**（不表達多空立場）：
  - 待機：燈亮著，每 1.25 秒上下一格像在呼吸、不規則眨眼，光束照 Fl W 10s 每 10 秒左右掃一次；每 20 秒輪一個小動作：張望、走兩步、轉燈、揮手、跳一下（`IDLE_ACTIONS`，避開光束掃過的時間）。
  - 打招呼（出現、滑鼠移上去、打開面板、切換晨海／夜海、從瞌睡中被叫醒）：先睜大眼，再跳起來揮手、光束全開。
  - 思考中：燈照 Q 急閃每秒一次（和「讀取中」同一個節奏）、眼睛往上、腳打拍子、頭頂「…」。
  - 有新回覆：兩道光束一直亮著；面板關著時亮到打開為止，開著時亮 5 秒。
  - 出錯：熄燈、眼睛往下、往海裡沉一格。
  - 打瞌睡：45 秒沒有任何操作（面板關著、不在回覆中）時閉眼、燈調暗、頭頂飄 Z；一有動靜就醒來打招呼。
  - 頁面捲動時浪流得比較快、身體晃快一點，不做小動作。眼睛會往游標的方向看（只在滑鼠裝置）。
- 動畫一格 125ms（`--dur-flash`），全站共用一個時鐘（`LighthouseMascot.tsx`），分頁在背景時停。減少動態、或在面板按了「暫停小燈動作」（WCAG 2.2.2，記在 `tei:assistant-still:v1`）時，每種狀態一張靜止的圖，靠表情與燈色分辨。
- 按鈕：沒有外框與底色，整張小燈（含海）就是按鈕，`sm` 以上寬 78px、手機 65px；focus 時照常出現 `focus-lamp` 外圈。右下角離邊 16px（`sm` 以上）／8px（手機），「回到頂部」鈕疊在它上方（小燈出現時寫 `--assistant-dock-offset: 5rem`）。
- 旁邊的對話泡泡（左側，方角加 `shadow-raised`）：第一次出現的自我介紹（8 秒、看過就不再出現，`tei:assistant-intro:v1`）、「回覆好了，點我看」、「整理中…」會一直顯示；「有問題問我」、出錯後的「再問一次」只在滑鼠移上去或鍵盤 focus 時出現。面板打開時不顯示。
- 面板：`sm` 以上是浮在小燈上方的 400px 面板，不擋操作（點頁面、捲動都不會關），只淡入淡出；手機是從底部升起的全寬面板（有遮罩）。標題列 h-14 加粗線（小燈、暫停動作、開新對話、在 AI 對話頁開啟、關閉）→ 對話 → 輸入列（含 AI 免責一行）。沒有訊息時：自我介紹、目前在看什麼、依頁面的「可以這樣問」（`context.ts`，只放 AI 對話已經支援的問題）、小技巧。資料面板收在回覆下方的展開列。
- 頁面在看什麼：個股頁從網址與股票清單取代號、名稱；新聞頁用 `useProvideAssistantTopic` 把標題交給小燈（`topic.ts`），問題直接引用標題。
- 個股頁多一個「回答只看 ○○」（預設勾選，送 `AskRequest.stock_id`）。後端收到 `stock_id` 會只分析那一檔，所以要比較多檔時取消勾選。
- 選取文字問小燈（只在滑鼠裝置）：在頁面上選取文字，選取範圍上方（太靠近頁首就放下方）出現「問小燈」，按下去打開面板、問「用白話解釋「…」」（最多 200 字，不送 `stock_id`）。輸入框、對話框、小燈自己的文字、視覺隱藏的文字、捲出視窗的選取都不出現。
- 「這頁怎麼看」導覽（`tours.ts` 內容、`PageTour.tsx` 畫面、`tourLayout.ts` 位置計算）：小燈一步一步框出頁面上的區塊並說明。
  - 區塊用 `data-tour="<名稱>"` 標在最外層；畫面上找不到的（沒登入、還沒比較、資料讀不到、手機版沒有）自動跳過，少於 2 步就不提供。
  - 被介紹的區塊外面一圈 2px 燈色框（光照到的地方），其餘蓋一層 `--overlay`；換步時一道光由左掃到右（`tour-sweep`，和圖廓同一個 `neatline-sweep`）。區塊比視窗高時只框看得到的部分。
  - 說明卡：方角、`shadow-raised`，上方是小燈（每步跳一下）與「頁名 · 2／5」，接著 `font-serif` 標題與一兩句說明，底部「結束導覽」「上一步」「下一步／完成」（「下一步」是這個畫面唯一的燈色按鈕）。桌面放在框的下方，放不下放上方，再不行放在框的右邊或左邊（窄而高的欄），都放不下疊在視窗底部；手機貼在畫面底部、全寬。
  - 換步時把區塊捲到「頁首以下、說明卡以上」的中間（桌面也預留說明卡的高度，讓它排在區塊下方；太高就讓頂端貼著頁首），減少動態時不平滑捲動、不掃光。
  - 變暗用外框四周四塊 `--overlay`，不用超大的 `box-shadow`（太大時瀏覽器不一定畫得出來）。
  - Radix Dialog（modal）：焦點在說明卡裡、Esc 或「結束導覽」結束、方向鍵左右換步；點變暗的地方不結束（避免誤觸）。讀屏器每步念「第幾步、標題、說明」。結束後焦點回到小燈。
  - 入口：面板開頭的「帶我看這頁怎麼看」與標題列的指南針鈕；第一次來某一頁時，小燈的泡泡會問「第一次來這頁？點我帶你看看」（每頁只問一次，`tei:assistant-tour-offered:v1`），這時點小燈直接開始導覽。
  - 文案只說這一區是什麼、怎麼操作，不解讀行情、不給買賣建議，不寫「今日」「即時」。
- 什麼時候不出現：`/ai`（本身就是助手）、首頁還沒捲到觀測台時（觀測台上緣捲到視窗上半部才出現）、首次造訪的風險提示條還在時（按「我已了解」後才出現）、列印。
- 燈色元素：小燈的燈點與光束是角色的一部分，列為「一個視窗最多兩個燈色元素」的例外，不拿來代表漲跌或狀態以外的意思；面板裡的燈色只有送出鈕。
