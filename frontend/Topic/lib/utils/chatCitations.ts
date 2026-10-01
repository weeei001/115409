import type { ChatSource } from '../types/chat';

export const CHAT_CITATION_PATTERN = '(?:[Ss][0-9][0-9A-Za-z_-]*|S[-_][0-9]+|S[a-z])';
export const CHAT_CITATION_RE = new RegExp(`\\[\\*{0,3}(${CHAT_CITATION_PATTERN})\\*{0,3}\\]`, 'g');

/** The backend appends a source tail; titles in it must never be parsed as prose. */
export function chatAnswerBody(content: string): string {
  const header = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?【引用來源】/.exec(content);
  return header ? content.slice(0, header.index).trimEnd() : content;
}

/** Only a structured article ID can identify an internal news article. */
export function newsCitationPath(source: ChatSource): string | null {
  const id = source.article_id;
  if (source.category && source.category !== 'news') return null;
  if (typeof id !== 'string' || !id.trim() || id.length > 64 || id === '.' || id === '..' || /[\u0000-\u001f\u007f]/.test(id)) return null;
  try { return `/news/${encodeURIComponent(id)}`; } catch { return null; }
}
