# DESIGN.md — 股海明燈設計規範

風格：**燈塔表（Light List）**。全站排成一本航海用的燈塔名錄：每檔股票是一筆條目，代號是編號、產業是所屬海岸、收盤／漲跌／資料日是它的燈質。
兩套主題是同一天的兩個班：dark＝**夜海**（夜班），light＝**晨海**（晨班），品質要求相同。
token 的實際數值只寫在 `styles/main.css`，這裡寫用途與規則。圖表需要解析後的色值，放在 `lib/charts/theme.ts`；手機網址列的 `theme-color` 也寫了 `--background` 的解析值（`components/layout/ThemeColorMeta.tsx`）；首頁旅程的螢幕畫面在讀不到 token 時用的解析值與晨班文案襯底色在 `features/home/journey/scene/theme.ts`（`PAGE_TOKEN_FALLBACK`、`DAWN_CAPTION_TINT`）。改 token 時這幾處要一起改。

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
| 3D 上的文字襯底 | `--scrim`（旅程用 inline style 的 `var(--scrim)`） | 首頁旅程的文案襯底 |

沒有漸層、玻璃、光暈；唯一的光暈是 3D 場景裡的燈。

## 2. 字型

- 顯示標題：`font-serif` = Noto Serif TC 900（只載入 900）。用在 h1、帳頁 h2、旅程標題。
- 介面與內文：`font-sans` = Noto Sans TC 400／500／700。
- 數字與代號：`font-mono` = IBM Plex Mono 400／500／600，一律加 `tabular-nums`。
- 字型由 `pages/_app.tsx` 用 `next/font/google` 自架載入，寫進 `--font-app-serif／sans／mono`；`styles/main.css` 的 `--font-*` 引用它們，並列同一組字族當退路。要換字型時，兩邊一起改。

| 角色 | class | 用在 |
|---|---|---|
| Display | `font-serif font-black tracking-[0.03em]`；lg 以上 `text-[clamp(44px,min(6.2vw,9svh),86px)] leading-[1.12]`，手機 `text-[clamp(32px,10.2vw,46px)] leading-[1.14]` | 首頁 h1（`BeaconJourney.tsx`） |
| Chapter | `font-serif font-black text-[clamp(28px,3.3vw,46px)] leading-[1.22]` | 觀測台標題、交接章標題（lg 以上）；其他旅程章節標題另外依視窗高度縮放（`BeaconJourney.tsx` 的 `HEADING_*`） |
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

面板沒有陰影，靠線分隔。只有浮在內容上方的層（popover、sheet、回到頂部鈕）用 `shadow-raised`。

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
- **可收合表格**：`components/common/CollapsibleSection.tsx`，預設收合（決議 c53）；手機加 `TableScrollHint`。
- **圖示**只用 `lucide-react`，不用 emoji 當圖示。品牌標誌是 `components/common/BrandMark.tsx`（商標圖形，不算介面圖示）。圖示預設用文字色或 `text-muted-foreground`，不用燈色。
- **觸控目標至少 44px**：圖示按鈕 `size-11`，文字按鈕 `min-h-11`。
- **Toast**：`sonner`（`components/layout/AppToaster.tsx`），顏色已接上狀態 token；2px 圓角（`--radius`）、在底部置中、不放小關閉鈕。
- **頁首**：子頁用 `components/layout/SiteHeader.tsx`，首頁用 `features/home/HomeHeader.tsx`。`lg` 以上顯示主導覽（`PrimaryNav`，目前頁用粗線標示、不用燈色）；股票搜尋在子頁是 `HeaderStockSearch`（`lg` 以上），首頁頁首在 `md` 以上直接放 `StockSearch`。主選單抽屜（`AppNavDrawer`）各寬度都有，手機靠它導覽。h1 是頁面的任務或主體（登入、台積電、新聞標題），不是品牌名。

## 7. 台股紅漲綠跌

- 漲、買超、偏多：`up`（紅）；跌、賣超、偏空：`down`（綠）；0 或缺值：中性。
- 依**數值正負**上色，不是依欄位上色。helper 在 `lib/utils/tone.ts`（`getValueTone`、`valueToneText`、`toneBadge`）。
- 漲跌數字一律帶正負號（`signedText`，在 `LightEntry.tsx`），不只靠顏色。負號一律 U+2212，helper 在 `lib/utils/format.ts`（`withSign`、`uMinus`）。
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
| `getMaColors(isDark)` | MA5 藍、MA10 紫、MA20 青、MA60 褐、MA120 灰藍；避開紅綠（決議 D8），也避開燈色 |
| `getInstitutionColors(isDark)` | 外資、投信、自營各一色，依法人上色、不依正負 |
| `AI_SERIES_PALETTE` | AI 對話圖表的類別色（`SERIES_PALETTE` 去掉橘、琥珀、褐與洋紅），不帶漲跌意義 |
| `COMPARE_SYMBOL_COLORS` | 多股比較依清單順序給每檔一個顏色（最多 6 檔，不撞色，決議 c76） |
| `correlationColor(value, isDark)`、`correlationGradient(isDark)` | 相關係數色階（負藍、0 灰、正橘），格子與圖例共用同一個函式 |

- 帶正負的單一序列（例如法人合計柱）依正負上色，0 用 `flat`。
- 單一主線（收盤、RSI、DIF、K、中軌）用 `palette.text`（墨色），不用燈色。
- 所有 ECharts 圖共用 `lib/charts/adapters.ts` 的 helper（`baseAxis`、`valueAxis`、`tooltip`、`legend`、`lineLook`、`chartGrid`、`shortDateLabel`）：圖例色樣依序列型別（線是細條、虛線是兩段、柱是方塊，不用圓點）、線不平滑也不畫節點（hover 才出現）、軸字用等寬字 11px、tooltip 方角無陰影、柱子方角、日期軸顯示 MM-DD。不用漸層面積。
- K 線、成交量柱：漲 `up`、跌 `down`、平盤 `flat`。
- 圖表函式庫的用法見 `charts-tei` skill。

## 9. RWD

- 斷點用 Tailwind 預設：`sm` 640、`md` 768、`lg` 1024。`useIsMobile()`（`lib/hooks/useClientEnv.ts`）以 1023px 以下算手機版版面。
- 兩個例外：頁首在 `xl`（1280）以上才放寬主導覽內距並顯示「大盤收盤 · 非即時」戳記（1024～1279 時六個項目加搜尋會擠到換行）；`/ai` 在 1440 以上才把資料欄並排在對話右側，`lg`～1439 收在「資料」開關後面（`features/ai/ChatArea.tsx`）。
- 手機優先寫法：先寫單欄，再用 `md:`、`lg:` 加欄數。
- 詳細內容抽屜（`DetailDrawer`）在手機全寬，`sm` 以上最寬 `min(1100px, 90vw)`。
- AI 證據詳情：`lg` 以上是右欄 sticky，以下改成底部 sheet。
- 驗收寬度：375px 與 1440px，light、dark 都要看；不可出現橫向捲動。
- 瀏海、底部手勢區用 `--app-safe-area-*` 變數閃開。

## 10. 動效

節奏來自燈質「Fl W 10s」：週期 P = 10 秒（3D 場景的兩道光束 20 秒轉一圈，每 10 秒掃過一次，見 `features/home/journey/scene/buildBeacon.ts`），所有時長都是 P 的分數（token 在 `styles/main.css`）。

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
- `prefers-reduced-motion`：CSS 會把動畫與過渡壓到幾乎為 0，`AnimatedSection` 與換頁直接不做動畫，Q 光帶靜止；程式捲動（`scrollTo`、`scrollIntoView`）改用 `behavior: 'auto'`。
- 捲動驅動的透明度與位移：scroll listener 算出進度後手動 `set` 到 `useMotionValue`，再用 `useMotionValueEvent(progress, 'change')` 直接寫 style（`features/home/journey/BeaconJourney.tsx`）；不要用 `useScroll`／`useTransform` 直接綁到 `style`（會被升級成 ViewTimeline 而算錯）。

## 11. 首頁旅程

- 觀測台（`features/home/terminal/ObservationTerminal.tsx`）是旅程的終點，上下留白用 `py-10 lg:py-16`（比一般頁面的 `py-6 lg:py-10` 寬），讓交接後的第一屏和旅程同一個呼吸。
- 結構：`features/home/journey/BeaconJourney.tsx` 是首屏外殼（不 import three），`BeaconScene.tsx` 與 `scene/` 是 3D 場景，閒置後才用 `next/dynamic`（`ssr: false`）載入。首屏是海報圖加真正的 DOM 文字，LCP 不等 WebGL。
- 五段文案（海面、燈塔、窗、桌前、交接）、四個進度站（海面／燈塔／觀測室／觀測台）；章節區間、文案透明度與時間（`shiftHour`）在 `journeyMath.ts`，測試在 `journeyMode.test.ts`。
- 兩條路線都要當成正式版面設計：
  - **3D 路線**：文案直接放在場景的留白處（燈塔章在天空、窗章在窗旁、桌前章在牆上、交接章在上方），底下是從畫面邊緣淡進來、沒有邊緣的 `--scrim` 柔和襯底，不是卡片，也不用全寬橫條；每章位置不同，不蓋住該章的主體。桌面進度列是一條髮線上的四個刻度，四個站名都顯示、目前站加粗，沒有框。晨海的文案襯底是貼合文字塊的柔邊橢圓（取該章畫面的冷色調，透明度最多 0.55），不是整段白霧。最後 8% 的捲動（進度 0.92→1.0）是連續的交接：相機直線推進，三面螢幕從機身上的位置插值到觀測台量到的三欄矩形（觀測清單／報價／加權指數，誤差 ≤ 1px；窄螢幕只有中間那面對到報價欄，左右兩面移出畫面），邊框從機身邊框的寬度收成 1px 並換成頁面線色，螢幕內容交叉淡入成觀測台的版式，房間溶接成頁面底色。同一段期間場景把 `--handoff`（0→1）寫在 `<html>` 上：觀測台頂端的燈光餘溫隨之淡出、第一組面板隨之淡入（`styles/main.css` 的 `#terminal` 規則）；場景不在跑（海報路線、卸載、換頁、分頁隱藏）時這個變數一定要移除，面板才不會留在半透明。最後一章有主要按鈕「進入觀測台」，交接時淡出。
  - **海報路線**（`data-mode="poster"`）：第一屏之後是一張張「圖版」——有粗線的章名列、固定比例且有外框的圖、圖旁（手機在圖下）的一般頁面文字，圖版之間留 `gap-10 lg:gap-16`。最後一張圖版是裁到三台螢幕的滿版圖，下面接著用真實資料、照觀測台三欄順序排的「看板」（格式在 `boardFormat.ts`），再以「進入觀測台」結尾，直接接上觀測台。
- 場景與看板只畫傳進來的真實資料；沒有資料就顯示「讀取中…」，不放只有標誌的畫面。收盤價下方只放日漲跌，不另外放區間漲跌（同一檔股票的漲跌幅只用一種口徑）。海報是靜態圖，不把有日期的數字烤進去；螢幕畫中性的格線與無日期的走勢線。
- 時間順著旅程走：夜班從餘暉到入夜，晨班從天亮前到日出；文案要和畫面一致。室內夜班靠桌燈與螢幕照明，晨班靠窗外天光。晨夜切換用一個混合值在 1250ms 內過渡。
- 降級成海報路線的條件：`prefers-reduced-motion`、沒有 WebGL2、低功耗裝置（核心數或記憶體 ≤ 4、`saveData`、Android WebView／Capacitor）。判斷在 `journeyMode.ts`。系統開了「減少動態」的電腦看到的就是海報路線。
- 效能：DPR 桌面最多 1.5、手機 1.25；分頁隱藏、舞台捲出視窗、捲到終點時停止 render loop；卸載時釋放 geometry、material、texture、render target 與 renderer。
- 海報在 `public/beacon/`（夜／晨 × 4 張 × 橫式／直式），由場景自己擷取；場景或燈光改了要重新產生。第一張 ≤ 70KB，其餘 ≤ 90KB。
