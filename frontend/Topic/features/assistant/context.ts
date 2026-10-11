import { isTaiwanStockCode } from '@/lib/utils/stockValidation';
import type { AssistantTopic } from './topic';

/** 小燈面板裡「可以這樣問」的依據：目前在哪一頁。問題都是 AI 對話已經支援的能力，不新增 */
export interface AssistantContext {
  /** 個股頁（含 AI 分析報告）的股票；有它時面板提供「回答只看這檔」（送 AskRequest.stock_id） */
  stock: { code: string; label: string } | null;
  /** 面板開頭的「你正在看…」；沒有就不寫 */
  viewing: string | null;
  questions: string[];
}

const GENERAL = ['這個網站可以幫我做什麼？', '最近有哪些影響台股的新聞？', '整理台積電的走勢、法人與營收重點'];

const BY_PAGE: Record<string, string[]> = {
  '/compare': ['多股比較的報酬、波動和相關性要怎麼看？', '比較台積電、聯發科與鴻海的報酬和風險'],
  '/order': ['模擬投資要怎麼開始？', '模擬委託什麼時候會成交？'],
  '/favorites': ['整理我收藏的股票最近的走勢和法人動向', '這個網站可以幫我做什麼？'],
  '/news/[id]': ['最近有哪些影響台股的新聞？', '這個網站可以幫我做什麼？'],
};

/** 問題裡引用的標題、選取的文字最多這麼長，超過用「…」截斷 */
const QUOTE_MAX = 80;
const SELECTION_MAX = 200;

function quote(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * pathname 是 Next 的路由樣板（/stock/[id]），id 是網址上的代號；topic 是頁面自己提供的主題（新聞標題）。
 * 個股的問題直接寫出代號與名稱：取消「回答只看這檔」或之後回頭看對話紀錄，問題本身還是看得懂。
 */
export function assistantContext(pathname: string, id: unknown, stockName?: string | null, topic: AssistantTopic = null): AssistantContext {
  if (pathname.startsWith('/stock/[id]') && typeof id === 'string' && isTaiwanStockCode(id)) {
    const name = stockName?.trim();
    const label = name ? `${id} ${name}` : id;
    return {
      stock: { code: id, label },
      viewing: label,
      questions: [`整理 ${label} 的走勢、法人與營收重點`, `用 KD 和量價分析 ${label} 目前的走勢`, `${label} 最近有哪些相關新聞？`],
    };
  }
  if (pathname === '/news/[id]' && topic?.kind === 'news' && topic.title.trim()) {
    const title = quote(topic.title, QUOTE_MAX);
    return {
      stock: null,
      viewing: `「${title}」這則新聞`,
      questions: [`整理這則新聞的重點：「${title}」`, `「${title}」這則新聞可能影響哪些股票？`, '最近有哪些影響台股的新聞？'],
    };
  }
  return { stock: null, viewing: null, questions: BY_PAGE[pathname] ?? GENERAL };
}

/** 在頁面上選取文字後按「問小燈」送出的問題；太短（少於 2 個字）不問 */
export function selectionQuestion(text: string): string | null {
  const clean = quote(text, SELECTION_MAX);
  return clean.length >= 2 ? `用白話解釋「${clean}」` : null;
}
