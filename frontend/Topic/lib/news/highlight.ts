import { stripHtml } from './sentiment';

export interface HighlightSegment {
  text: string;
  /** 是否為 AI 引用的原文句子 */
  quote: boolean;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 新聞內文：去 HTML、依換行分段，並標出 AI 情緒分析引用的句子。
 * 引用句必須完整出現在內文中、長度大於 2；長句優先比對，避免被短句拆開。
 */
export function splitHighlightedParagraphs(content: string | null | undefined, quotes: string[]): HighlightSegment[][] {
  if (!content) return [];
  const clean = stripHtml(content).trim();
  const valid = quotes.map((q) => q.trim()).filter((q) => q.length > 2 && clean.includes(q));

  if (valid.length === 0) {
    return clean
      .split('\n')
      .map((para) => para.trim())
      .filter(Boolean)
      .map((text) => [{ text, quote: false }]);
  }

  const sorted = [...valid].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRegExp).join('|')})`, 'g');
  return clean
    .split('\n')
    .filter((para) => para.trim())
    .map((para) =>
      para
        .split(pattern)
        .filter((part) => part !== '')
        .map((part) => ({ text: part, quote: sorted.includes(part) })),
    );
}
