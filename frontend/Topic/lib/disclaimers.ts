/**
 * AI 內容的免責句，全站共用一份字串。
 * 新聞的 AI 影響標籤共用這段文字。
 */
export const AI_RESEARCH_ONLY = '僅供研究參考，不是投資建議。';

/** AI 分析（完整分析、可列印報告）的後端沒給免責文字時的預設句 */
export const AI_BRIEF_DISCLAIMER = `AI 依公開資料整理，${AI_RESEARCH_ONLY}投資前請自行評估風險。`;

/** 新聞事件影響標籤：放在新聞區塊的標題層，不放在預設收合的內容裡 */
export const NEWS_IMPACT_DISCLAIMER = `影響標籤由 AI 判讀，${AI_RESEARCH_ONLY}`;

/** 投資免責聲明全文的頁面 */
export const DISCLAIMER_PATH = '/disclaimer';

/** 全站投資風險提示：首次造訪提示與頁尾共用 */
export const INVESTMENT_RISK_NOTICE = '投資有風險，本站資料與 AI 分析僅供研究參考，不構成投資建議；投資前請自行判斷，並自行承擔投資損益。';

/** AI 對話輸入框下方固定一行（手機版頁尾隱藏時也看得到） */
export const AI_CHAT_NOTICE = `AI 回覆${AI_RESEARCH_ONLY}投資有風險，請自行判斷。`;

/** 模擬投資頁：虛擬資金與歷史表現的限制 */
export const PAPER_TRADING_NOTICE = '模擬投資使用虛擬資金，不涉及真實交易；過去走勢與模擬結果不代表未來的真實報酬。';
