export interface RagReplySection {
  title: string;
  body: string;
}

export interface RagStructuredReply {
  sections: RagReplySection[];
}

const SECTION_HEADER_RE = /【([^】]+)】/g;
const ESCAPED_MARKDOWN_RE = /\\([\\`*_\[\]{}()#+.!>|-])/g;

/** LLM 偶爾會跳脫 Markdown 標記；先還原再交給輕量 renderer 處理。 */
export function normalizeMarkdownEscapes(text: string): string {
  return text.replace(ESCAPED_MARKDOWN_RE, '$1');
}

/** 是否為 RAG 結構化回覆（含【】區塊標題） */
export function isStructuredRagReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('【') || !trimmed.includes('】')) return false;
  const matches = trimmed.match(SECTION_HEADER_RE);
  return (matches?.length ?? 0) >= 1;
}

export function parseRagStructuredReply(text: string): RagStructuredReply | null {
  const trimmed = normalizeMarkdownEscapes(text)
    .replace(/^ {0,3}#{1,6}[\t ]+(【[^】]+】)(?:[\t ]+#+)?[\t ]*$/gm, '$1')
    .trim();
  if (!trimmed.includes('【')) return null;

  const headers = [...trimmed.matchAll(SECTION_HEADER_RE)];
  if (headers.length === 0) return null;

  const introduction = trimmed.slice(0, headers[0].index ?? 0).trim();
  const sections: RagReplySection[] = introduction ? [{ title: '重點', body: introduction }] : [];

  for (let i = 0; i < headers.length; i++) {
    const title = headers[i][1].trim();
    const start = (headers[i].index ?? 0) + headers[i][0].length;
    const end = i + 1 < headers.length ? (headers[i + 1].index ?? trimmed.length) : trimmed.length;
    const body = trimmed.slice(start, end).trim();
    sections.push({ title, body });
  }

  return { sections };
}

const SECTION_ICONS: Record<string, string> = {
  綜合摘要: 'summary',
  市場情緒: 'sentiment',
  關鍵事件: 'events',
  投資提示: 'tips',
  引用來源: 'sources',
};

export function sectionKind(title: string): string {
  for (const [key, kind] of Object.entries(SECTION_ICONS)) {
    if (title.includes(key)) return kind;
  }
  return 'default';
}
