/**
 * AI 內容的免責句，全站共用一份字串。
 * 目前用在新聞（影響標籤）與 AI 對話；AI 分析、比較頁、觀測台、頁尾在各自的修正批次改用這裡的常數。
 */
export const AI_RESEARCH_ONLY = '僅供研究參考，不是投資建議。';

/** 新聞事件影響標籤：放在新聞區塊的標題層，不放在預設收合的內容裡 */
export const NEWS_IMPACT_DISCLAIMER = `影響標籤由 AI 判讀，${AI_RESEARCH_ONLY}`;

/** AI 對話：輸入框下方與每則 AI 回覆底部固定顯示，不依賴後端是否附加免責句 */
export const AI_CHAT_DISCLAIMER = `AI 回覆${AI_RESEARCH_ONLY}`;
