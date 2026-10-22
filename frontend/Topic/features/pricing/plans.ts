import { COMPARE_URL_MAX_SYMBOLS } from '@/lib/utils/compareQuery';

/**
 * 方案卡、價格與比較表的資料（docs/business-model.md 第 4、5 節），前端靜態展示。
 * 額度數字和後端 backend/app/features/subscriptions/plans.py 的 PLAN_LIMITS 相同，改的時候兩邊一起改；
 * 目前方案、用量與實際生效的上限讀 GET /subscription（currentPlan.ts），後端也會照方案擋。
 */

export type PlanId = 'free' | 'plus' | 'pro';
export type BillingPeriod = 'monthly' | 'yearly';

export interface PlanHighlight {
  text: string;
  /** 系統還沒有實作（商業模式盤點表的「規劃中」） */
  planned?: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** 適合誰（商業模式第 2 節的 persona） */
  audience: string;
  /** 新臺幣；年繳等於 10 個月的月費 */
  price: Record<BillingPeriod, number>;
  /** 方案卡上的重點，接在 includes 後面 */
  includes?: string;
  highlights: PlanHighlight[];
}

export const BILLING_PERIODS: Array<{ value: BillingPeriod; label: string; unit: string }> = [
  { value: 'monthly', label: '月繳', unit: '月' },
  { value: 'yearly', label: '年繳', unit: '年' },
];

/** 方案頁預設顯示年繳：月繳的金流手續費比例偏高（商業模式第 5 節定價理由 4） */
export const DEFAULT_BILLING: BillingPeriod = 'yearly';

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: '免費版',
    audience: '剛開始學投資、想先用虛擬資金練習的人',
    price: { monthly: 0, yearly: 0 },
    highlights: [
      { text: 'AI 投資分析、新聞事件影響完整開放' },
      { text: '模擬投資與投資回顧' },
      { text: 'AI 對話與小燈：會員每日 5 次、訪客每日 3 次' },
      { text: '收藏股 10 檔、多股比較 5 檔' },
      { text: '歷史對話保存最近 30 天' },
      { text: '站內通知：每日摘要、漲跌幅、重大新聞' },
    ],
  },
  {
    id: 'plus',
    name: '進階版',
    audience: '收盤後才有空看盤、想用推播追蹤收藏股的上班族',
    price: { monthly: 99, yearly: 990 },
    includes: '包含免費版的全部功能，另外：',
    highlights: [
      { text: 'AI 對話與小燈每月 300 次' },
      { text: '收藏股不限、多股比較 30 檔' },
      { text: '歷史對話不限期保存' },
      { text: 'Web、Android 推播' },
      { text: '自訂提醒規則 5 條', planned: true },
      { text: '規則型歷史回測每月 30 次', planned: true },
      { text: '桌面小燈', planned: true },
    ],
  },
  {
    id: 'pro',
    name: '專業版',
    audience: '要整理多檔比較、把圖表放進貼文的財經內容創作者',
    price: { monthly: 249, yearly: 2490 },
    includes: '包含進階版的全部功能，另外：',
    highlights: [
      { text: 'AI 對話與小燈每月 1,000 次' },
      { text: 'Email、LINE 通知', planned: true },
      { text: '表格匯出 CSV、圖表存成圖片' },
      { text: '自訂提醒規則 30 條', planned: true },
      { text: '規則型歷史回測不限次數', planned: true },
    ],
  },
];

/** 升級鈕用燈色的方案：主要客群（商業模式第 2 節 Persona A）；其他方案用外框鈕，一個畫面只放一顆主要按鈕 */
export const PRIMARY_PLAN_ID: PlanId = 'plus';

/** 方案卡下方的一句說明 */
export const PRICING_LEAD = '所有方案都能完整查看 AI 投資分析與新聞事件影響；付費只差在用量和工具，所有方案都沒有廣告。';

export function planById(id: PlanId): Plan {
  const plan = PLANS.find((item) => item.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** NT$990、NT$82.5：最多一位小數 */
export function formatTwd(amount: number): string {
  return `NT$${amount.toLocaleString('zh-TW', { maximumFractionDigits: 1 })}`;
}

/** 年繳折合每月 */
export const yearlyPerMonth = (plan: Plan): number => plan.price.yearly / 12;

/** 年費等於幾個月的月費（免費版回傳 null） */
export const yearlyInMonths = (plan: Plan): number | null =>
  plan.price.monthly > 0 ? Math.round(plan.price.yearly / plan.price.monthly) : null;

export interface PlanLimits {
  /** AI 對話與小燈共用的提問額度：免費版以每日計（訪客另有較低的額度），付費版以每月計 */
  ask: { per: 'day' | 'month'; member: number; guest?: number };
  /** 收藏股檔數；null＝不限 */
  favorites: number | null;
  /** 多股比較同時檔數 */
  compare: number;
  /** 自訂提醒規則條數（規劃中）；0＝這個方案沒有 */
  alertRules: number;
}

/** 方案的額度數字（比較表、方案卡與提示文字用；實際限制以後端為準） */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { ask: { per: 'day', member: 5, guest: 3 }, favorites: 10, compare: 5, alertRules: 0 },
  plus: { ask: { per: 'month', member: 300 }, favorites: null, compare: COMPARE_URL_MAX_SYMBOLS, alertRules: 5 },
  pro: { ask: { per: 'month', member: 1000 }, favorites: null, compare: COMPARE_URL_MAX_SYMBOLS, alertRules: 30 },
};

export const ASK_PERIOD_LABEL: Record<PlanLimits['ask']['per'], string> = { day: '每日', month: '每月' };

/** 1,000：千分位 */
export const formatCount = (value: number): string => value.toLocaleString('zh-TW');

export type PlanCell =
  | { kind: 'included'; note?: string }
  | { kind: 'excluded' }
  | { kind: 'quota'; text: string; note?: string };

export interface ComparisonRow {
  feature: string;
  planned?: boolean;
  cells: Record<PlanId, PlanCell>;
}

export interface ComparisonGroup {
  id: 'same' | 'quantity' | 'tools';
  title: string;
  description: string;
  rows: ComparisonRow[];
}

const yes = (note?: string): PlanCell => ({ kind: 'included', note });
const no: PlanCell = { kind: 'excluded' };
const quota = (text: string, note?: string): PlanCell => ({ kind: 'quota', text, note });
const everyPlan = (free: PlanCell = yes()): Record<PlanId, PlanCell> => ({ free, plus: yes(), pro: yes() });
const perPlan = (cell: (id: PlanId) => PlanCell): Record<PlanId, PlanCell> => ({ free: cell('free'), plus: cell('plus'), pro: cell('pro') });

function askCell(id: PlanId): PlanCell {
  const { per, member, guest } = PLAN_LIMITS[id].ask;
  const period = ASK_PERIOD_LABEL[per];
  return guest == null
    ? quota(`${period} ${formatCount(member)} 次`)
    : quota(`會員${period} ${formatCount(member)} 次`, `訪客${period} ${formatCount(guest)} 次，對話不保存`);
}

/** 不限檔數的方案附上系統目前收錄的股票檔數（/stocks/info 的筆數，管理員可以新增）；還沒讀到就不寫數字 */
function favoritesCell(id: PlanId, stockCount: number | null): PlanCell {
  const limit = PLAN_LIMITS[id].favorites;
  if (limit != null) return quota(`${formatCount(limit)} 檔`);
  return quota('不限', id === 'plus' && stockCount ? `目前系統涵蓋 ${formatCount(stockCount)} 檔` : undefined);
}

const compareCell = (id: PlanId): PlanCell =>
  quota(`${formatCount(PLAN_LIMITS[id].compare)} 檔`, id === 'plus' && PLAN_LIMITS[id].compare === COMPARE_URL_MAX_SYMBOLS ? '系統上限' : undefined);

const alertRulesCell = (id: PlanId): PlanCell => (PLAN_LIMITS[id].alertRules ? quota(`${formatCount(PLAN_LIMITS[id].alertRules)} 條`) : no);

/** 方案比較表（商業模式第 4 節），依「差別屬於」分三組；stockCount 是系統目前收錄的股票檔數 */
export const comparisonGroups = (stockCount: number | null): ComparisonGroup[] => [
  {
    id: 'same',
    title: '所有方案都一樣',
    description: 'AI 判讀、行情與學習功能不放在付費牆後面',
    rows: [
      { feature: '行情、K 線、技術指標、三大法人', cells: everyPlan() },
      { feature: 'AI 投資分析：多空立場、三個區間展望、證據', cells: everyPlan(yes('完整內容，不需登入')) },
      { feature: '新聞列表與事件影響分析', cells: everyPlan() },
      { feature: 'AI 分析報告列印、存成 PDF', cells: everyPlan() },
      { feature: '模擬投資與投資回顧', cells: everyPlan() },
      { feature: '小燈「這頁怎麼看」導覽', cells: everyPlan() },
      { feature: '站內通知：每日摘要、漲跌幅、重大新聞', cells: everyPlan() },
      { feature: '匯出自己的帳號資料：模擬交易、對話紀錄', planned: true, cells: everyPlan() },
    ],
  },
  {
    id: 'quantity',
    title: '用量',
    description: '額度、檔數、保存期間；免費版以每日計，付費版以每月計',
    rows: [
      { feature: 'AI 對話與小燈提問次數', cells: perPlan(askCell) },
      { feature: '歷史對話保存', cells: { free: quota('最近 30 天'), plus: quota('不限'), pro: quota('不限') } },
      { feature: '收藏股檔數', cells: perPlan((id) => favoritesCell(id, stockCount)) },
      { feature: '多股比較同時檔數', cells: perPlan(compareCell) },
      {
        feature: '規則型歷史回測：用標準訊號設定進出場，不含 AI 判讀',
        planned: true,
        cells: { free: quota('每月 3 次'), plus: quota('每月 30 次'), pro: quota('不限') },
      },
    ],
  },
  {
    id: 'tools',
    title: '工具',
    description: '通知通道、匯出、桌面小燈',
    rows: [
      { feature: '推播：Web、Android', cells: { free: no, plus: yes(), pro: yes() } },
      { feature: '自訂提醒規則', planned: true, cells: perPlan(alertRulesCell) },
      { feature: '桌面小燈', planned: true, cells: { free: no, plus: yes(), pro: yes() } },
      { feature: 'Email、LINE 通知', planned: true, cells: { free: no, plus: no, pro: yes() } },
      { feature: '表格匯出 CSV、圖表存成圖片，附資料來源與日期', cells: { free: no, plus: no, pro: yes() } },
    ],
  },
];

/** 結帳頁不接金流（綠界留到之後的階段） */
export const PAYMENT_UNAVAILABLE = '專題展示，金流尚未串接';

/** 方案名稱後面接的展示標記：付費方案只能用「模擬開通」切換，畫面一律標示 */
export const DEMO_TAG = '展示';

/** 個股頁 AI 投資分析卡的一行說明（商業模式第 8 節 #9） */
export const AI_BRIEF_ALL_PLANS = '所有方案皆可完整檢視';

/** 表格匯出 CSV、圖表存成圖片只開放給專業版（components/common/ExportButtons.tsx） */
export const EXPORT_MIN_PLAN: PlanId = 'pro';

/** 推播（Web、Android）是進階版起的工具，後端只替付費方案註冊裝置、送推播 */
export const PUSH_MIN_PLAN: PlanId = 'plus';

/** 通知中心列出的規劃中通知功能（商業模式 F37、F38） */
export const PLANNED_NOTIFICATION_FEATURES: Array<{ id: string; title: string; description: string; minPlan: PlanId }> = [
  { id: 'alert-rules', title: '自訂提醒規則', description: '自訂價位、指標訊號、法人連續買賣的提醒。進階版 5 條、專業版 30 條。', minPlan: 'plus' },
  { id: 'channels', title: 'Email、LINE 通知', description: '收藏股摘要與提醒也送到 Email 或 LINE。', minPlan: 'pro' },
];

/** 方案頁的「桌面小燈」介紹（商業模式 F39、第 8 節 #14，錨點 /pricing#desktop）；還沒有桌面版 */
export const DESKTOP_MASCOT = {
  anchor: 'desktop',
  minPlan: 'plus' as PlanId,
  summary: '把網站右下角的站內助手小燈做成常駐在電腦桌面的版本，不用打開網頁，也能直接問小燈。',
  points: [
    '和 AI 對話頁用同一套問答，提問次數計入方案的 AI 提問額度。',
    '和站內小燈一樣，表情與動作只跟著對話狀態，不跟行情漲跌，也不提供買賣建議。',
    '目前還沒有桌面版；網站上的小燈在所有方案都能使用。',
  ],
};

/** 方案頁頂端的聲明（商業模式第 7.3 節） */
export const PRICING_DEMO_NOTICE =
  '專題展示：本頁的價格只供報告展示，金流尚未串接，不會實際收費。登入後可以「模擬開通」付費方案（不付款），額度與工具會照方案實際生效。';

/** 付費內容的範圍（商業模式第 7.1 節） */
export const PAID_SCOPE_NOTE =
  '付費方案只差在用量（額度、檔數、保存期間）和工具（通知通道、匯出、桌面小燈），不包含任何投資建議，也不提供個別股票的分析意見或推介。';
/** AI 判讀免費、付費不影響準確度（商業模式第 7.4 節） */
export const AI_FREE_NOTE = 'AI 投資分析與新聞事件影響在每個方案都完整開放。AI 可能出錯，付費不會提高 AI 的準確度。';
/**
 * 方案頁、結帳頁的免責段落。商業模式 7.1：方案頁與行銷文案不寫「投資顧問」「明牌」「勝率」「保證獲利」，
 * 服務性質的完整說明留在投資免責聲明（兩頁都有連結）
 */
export const PRICING_SCOPE_NOTES = [PAID_SCOPE_NOTE, AI_FREE_NOTE];
/** 投資免責聲明「付費方案的範圍」的最後一段：展示性質 */
export const PRICING_DEMO_DISCLAIMER =
  '方案頁與結帳頁是專題展示：金流尚未串接，不會實際收費；「模擬開通」不付款，會把帳號切換成該方案，額度與工具照方案生效，隨時可以恢復免費版。';

export interface PricingFaq {
  id: string;
  question: string;
  answer: string;
}

export const PRICING_FAQ: PricingFaq[] = [
  {
    id: 'ai-free',
    question: '為什麼 AI 投資分析全部免費？',
    answer:
      '個股的多空立場與趨勢判讀只透過 AI 投資分析與新聞事件影響提供，這兩項在每個方案都完整開放，不登入也看得到。股海明燈的定位是讓 AI 判讀可以解釋、可以檢驗，付費只買用量和工具，不賣分析內容。',
  },
  {
    id: 'accuracy',
    question: '付費會讓 AI 判讀更準嗎？',
    answer:
      '不會。所有方案用同一套資料與 AI，付費差異和 AI 判讀品質無關。AI 可能出錯，請自行查證後再做判斷。',
  },
  {
    id: 'quota',
    question: 'AI 對話的額度怎麼算？',
    answer:
      'AI 對話與小燈共用額度，以帳號計算，換裝置也一樣。免費版以每日計：訪客每日 3 次（依連線來源計算）且對話不保存，會員每日 5 次；付費版以每月計，方便集中使用。日期以台灣時間為準。想看某檔股票的 AI 判讀不用問 AI 對話，個股頁的 AI 投資分析不受額度限制。',
  },
  {
    id: 'billing',
    question: '年繳和月繳差在哪裡？',
    answer: '年繳的金額等於 10 個月的月費。上方切換到「年繳」可以看到各方案的年費與折合每月的金額。',
  },
  {
    id: 'payment',
    question: '現在可以付款升級嗎？',
    answer:
      '還不行。這是專題展示，金流尚未串接，不會收費。升級按鈕會帶你到結帳示意頁，登入後可以「模擬開通」付費方案：不付款，帳號直接切換成該方案，額度與工具立即生效，隨時可以在個人中心恢復免費版。',
  },
  {
    id: 'limits',
    question: '額度用完會怎樣？',
    answer:
      'AI 對話與小燈的額度用完後會暫停提問，免費版隔天、付費版下個月 1 日恢復；伺服器沒能完成的回答不扣次數。收藏股到上限後不能再加入新的，多股比較超過檔數要先移除幾檔才能開始比較。免費版的歷史對話只顯示最近 30 天，較舊的只是隱藏，升級後就會回來。',
  },
  {
    id: 'planned',
    question: '標「規劃中」的功能是什麼意思？',
    answer: '系統目前還沒有這項功能。列在表上是說明之後做好時會放在哪個方案，不代表現在就能使用。',
  },
  {
    id: 'ads',
    question: '會有廣告嗎？',
    answer: '所有方案都沒有廣告。',
  },
];
