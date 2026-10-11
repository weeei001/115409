/**
 * 「這頁怎麼看」導覽的內容：每頁幾個區塊，依畫面由上到下。
 * 區塊用 data-tour 標記（pages 與 features 裡的區塊最外層）；畫面上沒有的區塊（沒登入、還沒比較、資料讀不到）自動跳過。
 * 文案只說明「這一區是什麼、怎麼操作」，不解讀行情、不給買賣建議。
 */

export const TOUR_ATTR = 'data-tour';

export interface TourStep {
  /** data-tour 的值 */
  target: string;
  title: string;
  body: string;
}

export interface PageTourDef {
  /** 記錄「這頁導覽提示過了」用的代號 */
  id: string;
  /** 說明卡上方的小標題 */
  title: string;
  steps: TourStep[];
}

/** 有導覽的頁面（key 是 Next 的路由樣板） */
export const TOURS: Record<string, PageTourDef> = {
  '/stock/[id]': {
    id: 'stock',
    title: '個股頁怎麼看',
    steps: [
      { target: 'stock-hero', title: '收盤價與 K 線', body: '大字是最近交易日的收盤價，旁邊是和前一個交易日比的漲跌（紅漲綠跌）。可以切換 3 個月、6 個月、1 年；「K 線與量能」打開完整圖表。' },
      { target: 'stock-kpi', title: '區間漲跌與高低', body: '上面選的期間裡，這檔的區間漲跌幅、最高價與最低價。' },
      { target: 'stock-flows', title: '法人與指標', body: '一張是最近交易日三大法人（外資、投信、自營）的買賣超張數，一張是 RSI、MACD、KD 的讀數與訊號。按「籌碼明細」「技術指標明細」看完整圖表。' },
      { target: 'stock-brief', title: 'AI 投資分析', body: 'AI 依行情、法人、營收與新聞整理的摘要，分短線、波段、中期說明方向與分析信心。按「查看完整分析」看每一段的依據。僅供研究參考，不是投資建議。' },
      { target: 'stock-track', title: 'AI 判斷回顧', body: '回頭檢查過去的 AI 摘要：判斷之後第 5、20、40 個交易日，實際走勢有沒有對上，並和「每次都猜漲」與大盤比較。' },
      { target: 'stock-news', title: '相關新聞', body: '和這檔有關的新聞。標籤是 AI 判讀的影響方向，正向紅、負向綠；最下面一列看更多新聞與原文依據。' },
    ],
  },
  '/': {
    id: 'home',
    title: '觀測台怎麼看',
    steps: [
      { target: 'terminal-watchlist', title: '觀測清單', body: '本站收錄的全部股票，依產業分組，收藏的排最前面。點一檔，報價與 K 線就換成它。' },
      { target: 'terminal-quote', title: '報價與 K 線', body: '選中股票最近交易日的收盤、開高低與成交量，下面是 K 線和區間尺。要看完整資料，按「開啟完整個股頁」。' },
      { target: 'terminal-side', title: '大盤、法人與指標', body: '加權指數，以及這檔的三大法人買賣超與技術指標。都是最近一個交易日的收盤資料，不是盤中報價。' },
      { target: 'terminal-news', title: '最新財經新聞', body: '用股票代號或關鍵字搜尋新聞，點標題看全文與 AI 判讀的事件影響。' },
      { target: 'terminal-more', title: '觀測台以外', body: '想再深入：到 AI 對話直接問、用多股比較把幾檔放在一起看，或在模擬投資用虛擬資金練習。' },
    ],
  },
  '/compare': {
    id: 'compare',
    title: '多股比較怎麼看',
    steps: [
      { target: 'compare-pick', title: '加入股票與期間', body: '用代號、公司名稱或產業加入要比較的股票，選好日期區間後按「開始比較」。' },
      { target: 'compare-selected', title: '已選股票', body: '已加入的股票和它在圖上的代表色，按 X 可以移除。' },
      { target: 'compare-outputs', title: '比較後會看到什麼', body: '按下「開始比較」，這裡會換成航跡圖、比較指標表和延伸分析。' },
      { target: 'compare-result', title: '航跡圖', body: '各檔從同一天起算換成 100，走勢放在同一張圖比較；可以切換報價、指數化與區間漲跌幅，也能點股票把它從圖上藏起來。' },
      { target: 'compare-metrics', title: '比較指標表', body: '區間漲跌幅、年化波動、最大回撤等標準指標並排，點欄位標題排序；有粗底線的是這一欄比較好的那檔。' },
      { target: 'compare-leaders', title: '類別冠軍', body: '每一項標準指標最高與最低的是哪一檔，快速對照用。' },
      { target: 'compare-analysis', title: '延伸分析', body: '波動分佈、基本面、三大法人、技術指標、相關性與計算方法，想看哪一項就展開。' },
    ],
  },
  '/order': {
    id: 'order',
    title: '模擬投資怎麼看',
    steps: [
      { target: 'order-setup', title: '設定模擬資金', body: '先決定想用多少虛擬資金練習，金額可以貼近你實際願意投入的預算。' },
      { target: 'order-summary', title: '我的模擬投資', body: '可用資金、總資產與投資損益，持股依最近交易日收盤估值。「模擬買進」下單，「與 AI 討論」請 AI 幫你整理想法。' },
      { target: 'order-positions', title: '我的持股', body: '每檔的市值、未實現損益、報酬率與平均成本，可以直接買進、賣出，或請 AI 一起討論。' },
      { target: 'order-reviews', title: '投資回顧', body: '買進時留下的想法，到了回顧日會出現在這裡，回頭看當初的判斷。' },
      { target: 'order-orders', title: '交易紀錄', body: '委託會在下一個交易日收盤成交，還沒成交的可以取消；已成交與已取消的收在下面。' },
      { target: 'order-funds', title: '管理資金', body: '增加或取回模擬資金；追加的資金不算投資獲利。' },
    ],
  },
  '/favorites': {
    id: 'favorites',
    title: '收藏股怎麼看',
    steps: [
      { target: 'favorites-list', title: '收藏清單', body: '收藏的股票和最近交易日的收盤、漲跌。「看行情」到個股頁，按 X 移除收藏。' },
      { target: 'favorites-search', title: '加入收藏股', body: '用代號、公司名稱或產業搜尋，按「加入」就會出現在收藏清單。' },
    ],
  },
  '/news/[id]': {
    id: 'news',
    title: '新聞頁怎麼看',
    steps: [
      { target: 'news-article', title: '新聞內文', body: '第三方媒體的報導，上方是來源與時間；有原始網址時，按「前往原始新聞來源」看原文網頁。' },
      { target: 'news-stocks', title: '關聯個股', body: '這則新聞提到的股票，點代號到它的個股頁。' },
      { target: 'news-analysis', title: '新聞事件影響分析', body: 'AI 判讀這則新聞對大盤、產業、個股的影響方向，並列出原文依據，點引用會在內文標出那一句。僅供研究參考。' },
    ],
  },
  '/notifications': {
    id: 'notifications',
    title: '通知中心怎麼看',
    steps: [
      { target: 'notifications-inbox', title: '最近通知', body: '收藏股的每日摘要、單日漲跌幅提醒、重大新聞與公告，都會出現在這裡。' },
      { target: 'notifications-device', title: '此裝置推播', body: '開啟後，這台裝置也會收到推播通知。' },
      { target: 'notifications-prefs', title: '通知偏好', body: '選要收哪幾種通知、漲跌幅門檻與安靜時段，改完記得按「儲存通知偏好」。' },
    ],
  },
};

/** 少於這麼多步就不提供導覽（只剩一兩個區塊時，導覽沒有意義） */
export const MIN_TOUR_STEPS = 2;

export function tourFor(pathname: string): PageTourDef | null {
  return TOURS[pathname] ?? null;
}

/** 畫面上看得到的那一個（同一個 data-tour 在手機、桌面版各有一份時，取顯示中的） */
export function findTourTarget(target: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const all = document.querySelectorAll<HTMLElement>(`[${TOUR_ATTR}="${target}"]`);
  for (const element of all) {
    if (element.getClientRects().length && element.offsetHeight > 0) return element;
  }
  return null;
}

/** 現在畫面上有的步驟 */
export function availableSteps(tour: PageTourDef, isShown: (target: string) => boolean = (target) => findTourTarget(target) !== null): TourStep[] {
  return tour.steps.filter((step) => isShown(step.target));
}
