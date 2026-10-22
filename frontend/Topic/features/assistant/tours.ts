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
      { target: 'stock-report', title: 'AI 分析完整報告', body: '「AI 分析報告」在新分頁打開整份 AI 分析，所有段落與引用資料都展開；「下載 PDF」會直接跳出列印視窗，目的地選「另存為 PDF」就能存檔。' },
      { target: 'stock-hero', title: '收盤價與 K 線', body: '大字是最近交易日的收盤價，旁邊是和前一個交易日比的漲跌（紅漲綠跌）。可以切換 3 個月、6 個月、1 年；「K 線與量能」打開完整圖表。' },
      { target: 'stock-kpi', title: '區間漲跌與高低', body: '上面選的期間裡，這檔的區間漲跌幅、最高價與最低價。' },
      { target: 'stock-flows', title: '法人與指標', body: '一張是最近交易日三大法人（外資、投信、自營）的買賣超張數，一張是 RSI、MACD、KD 的讀數與訊號。按「籌碼明細」「技術指標明細」看完整圖表。' },
      { target: 'stock-fundamentals', title: '基本面與持股', body: '月營收與年增率、單季 EPS、本益比與殖利率、最近一次除權息，以及融資融券、外資持股比例和集保股權分散。按「基本面明細」「信用交易與持股」看走勢與明細表。' },
      { target: 'stock-brief', title: 'AI 投資分析', body: 'AI 依行情、法人、營收與新聞整理的摘要，分短線、波段、中期說明方向與分析信心。按「查看完整分析」看每一段的依據。僅供研究參考，不是投資建議。' },
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
  '/stock/[id]/report': {
    id: 'report',
    title: 'AI 分析報告怎麼看',
    steps: [
      { target: 'report-print', title: '列印與存檔', body: '整份報告可以直接列印；在列印視窗的「目的地」選「另存為 PDF」就能存檔。列印時自動換成淺色，不印按鈕與目錄。' },
      { target: 'report-provenance', title: '這份分析怎麼產生的', body: '分析基準日、行情與新聞截止日、模型和使用的資料。AI 依這些資料整理，推論與數字仍可能有誤。' },
      { target: 'report-summary', title: '整體結論', body: '這份分析的總結和分析信心，以及信心高低的理由。' },
      { target: 'report-toc', title: '報告目錄', body: '點標題直接跳到那一段：目前狀態、正負面因素、不同時間長度的看法、風險與觀察點。' },
      { target: 'report-views', title: '不同時間長度的看法', body: '短線、波段、中期各自的方向，以及「什麼情況就不成立」。只講方向，不給買賣建議與目標價。' },
      { target: 'report-sources', title: '引用資料', body: '這份分析實際引用的資料，依類別列出；前面每一段的引用都對得到這裡。' },
    ],
  },
  '/pricing': {
    id: 'pricing',
    title: '方案頁怎麼看',
    steps: [
      { target: 'pricing-plans', title: '選擇方案', body: '免費版、進階版、專業版的價格與內容，標題旁切換月繳或年繳。本頁是專題展示，不會實際收費。' },
      { target: 'pricing-compare', title: '方案比較', body: 'AI 提問額度、收藏股檔數、多股比較檔數等逐項對照。AI 投資分析在所有方案都完整開放，付費只差在用量和工具。' },
      { target: 'pricing-desktop', title: '桌面小燈', body: '規劃中的功能：把小燈做成常駐電腦桌面的版本，不用打開網頁也能問。' },
      { target: 'pricing-faq', title: '常見問題', body: '額度怎麼算、月繳和年繳差在哪、付費會不會讓 AI 更準等問題，點問題展開答案。' },
      { target: 'pricing-scope', title: '付費方案的範圍', body: '付費包含什麼、不包含什麼，以及投資風險提示。' },
    ],
  },
  '/checkout': {
    id: 'checkout',
    title: '結帳頁怎麼看',
    steps: [
      { target: 'checkout-summary', title: '訂單摘要', body: '選好的方案、金額與計費週期，可以在這裡切換月繳或年繳；開通日與續訂日只是展示。' },
      { target: 'checkout-payment', title: '付款', body: '金流尚未串接，不會收費。登入後按「模擬開通」，帳號會直接換成這個方案、額度立即生效；隨時可以在個人中心恢復免費版。' },
    ],
  },
  '/me': {
    id: 'me',
    title: '個人中心怎麼看',
    steps: [
      { target: 'me-profile', title: '帳號資料', body: '登入的電子郵件與顯示名稱。「重新整理資料」重新讀取帳號，「登出」會清掉這台裝置的登入狀態。' },
      { target: 'me-plan', title: '目前方案', body: '現在的方案，以及 AI 提問、收藏股、多股比較等額度用了多少。要換方案按「升級方案」或「變更方案」。' },
      { target: 'me-password', title: '變更密碼', body: '用電子郵件註冊的帳號可以在這裡改密碼；只用 Google 登入的帳號沒有密碼，不能在這裡改。' },
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
