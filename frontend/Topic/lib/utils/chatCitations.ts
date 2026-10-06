import type { ChatSource } from '../types/chat';

export const CHAT_CITATION_PATTERN = '(?:[Ss][0-9][0-9A-Za-z_-]*|S[-_][0-9]+|S[a-z])';
export const CHAT_CITATION_RE = new RegExp(`\\[\\*{0,3}(${CHAT_CITATION_PATTERN})\\*{0,3}\\]`, 'g');

/**
 * 後端在推薦類問題的回覆尾端附加的免責句（backend chat/prompts.py INVESTMENT_DISCLAIMER）。
 * 這句自稱「投資建議」，和全站「不是投資建議」矛盾，也只有部分回覆才有；畫面改用前端固定的 AI_CHAT_DISCLAIMER。
 * 舊對話已經存了這句，後端改字後新舊兩版都要列在這裡，才剝得乾淨。只比對完整字串，不猜相近的句子。
 */
export const BACKEND_CHAT_DISCLAIMERS: readonly string[] = [
  '投資建議僅供參考，不保證獲利；請依自身財務狀況與風險承受能力審慎評估，投資有賺有賠。',
  // P0-8 批改字後的版本：放在【引用來源】之前（【資料限制】之後）
  '以上為資料整理，不是投資建議；投資前請依自身狀況評估風險。',
  // 讀到模擬帳戶資料的那一輪改用這句（backend chat/prompts.py PAPER_PORTFOLIO_DISCLAIMER），位置相同
  '以上為模擬帳戶的練習安排，不是投資建議；模擬結果不代表真實報酬。',
];

/** 回覆結尾一整段等於後端免責句時剝掉（沒有【引用來源】的回覆，它直接接在正文後面） */
function stripBackendDisclaimer(text: string): string {
  let body = text.trimEnd();
  for (const sentence of BACKEND_CHAT_DISCLAIMERS) {
    if (body === sentence) return '';
    if (body.endsWith(`\n${sentence}`)) body = body.slice(0, -sentence.length).trimEnd();
  }
  return body;
}

/** The backend appends a source tail (and sometimes its own disclaimer); neither may be parsed as prose. */
export function chatAnswerBody(content: string): string {
  const header = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?【引用來源】/.exec(content);
  return stripBackendDisclaimer(header ? content.slice(0, header.index) : content);
}

/**
 * 畫面上的引用編號：正文裡出現過的來源依第一次出現的順序編 1、2、3…，其餘來源與資料面板用到的編號接在後面。
 * 後端的 S1、S2、S5 會因為篩選跳號，使用者會以為漏了引用；內部 id（錨點、比對）仍用原本的 citation_id。
 * 不在來源清單、也不在 extraIds 裡的 id 不編號（畫面照原樣標「來源無法使用」），編號是純數字，不會和原始的 S 編號混淆。
 */
export function citationLabels(body: string, sources: readonly ChatSource[], extraIds: readonly string[] = []): Map<string, string> {
  // 正文的順序只看來源清單裡有的 id：ChatMessage（不傳 extraIds）與資料面板（傳 extraIds）才會編出同一組號碼
  const known = new Set(sources.map((source) => source.citation_id));
  const order = [
    ...[...body.matchAll(CHAT_CITATION_RE)].map((match) => match[1]).filter((id) => known.has(id)),
    ...sources.map((source) => source.citation_id),
    ...extraIds,
  ];
  const labels = new Map<string, string>();
  for (const id of order) if (!labels.has(id)) labels.set(id, String(labels.size + 1));
  return labels;
}

/** 純文字（複製用）：引用標記換成畫面上的編號 */
export function relabelCitations(text: string, labels: ReadonlyMap<string, string>): string {
  return text.replace(CHAT_CITATION_RE, (marker, id: string) => {
    const label = labels.get(id);
    return label ? `[${label}]` : marker;
  });
}

/** 複製回覆：畫面上看得到的正文（引用重新編號）、引用的來源標題，最後固定附上免責句 */
export function chatCopyText(content: string, sources: readonly ChatSource[], disclaimer: string): string {
  const body = chatAnswerBody(content);
  const labels = citationLabels(body, sources);
  const titles = new Map(sources.map((source) => [source.citation_id, source.title]));
  const cited = [...new Set([...body.matchAll(CHAT_CITATION_RE)].map((match) => match[1]))].filter((id) => titles.has(id));
  const sourceLines = cited.map((id) => `[${labels.get(id)}] ${titles.get(id)}`);
  return [relabelCitations(body, labels), sourceLines.length ? `引用來源\n${sourceLines.join('\n')}` : '', disclaimer]
    .filter(Boolean).join('\n\n');
}

/** Only a structured article ID can identify an internal news article. */
export function newsCitationPath(source: ChatSource): string | null {
  const id = source.article_id;
  if (source.category && source.category !== 'news') return null;
  if (typeof id !== 'string' || !id.trim() || id.length > 64 || id === '.' || id === '..' || /[\u0000-\u001f\u007f]/.test(id)) return null;
  try { return `/news/${encodeURIComponent(id)}`; } catch { return null; }
}
