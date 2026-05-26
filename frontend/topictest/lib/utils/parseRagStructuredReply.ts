export interface RagReplySection {
  title: string;
  body: string;
}

export interface RagStructuredReply {
  sections: RagReplySection[];
}

export type RagSentiment = 'bullish' | 'bearish' | 'neutral';

export interface RagSourceItem {
  index?: string;
  title: string;
  url: string;
}

const SECTION_HEADER_RE = /【([^】]+)】/g;

/** 是否為 RAG 結構化回覆（含【】區塊標題） */
export function isStructuredRagReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('【') || !trimmed.includes('】')) return false;
  const matches = trimmed.match(SECTION_HEADER_RE);
  return (matches?.length ?? 0) >= 1;
}

export function parseRagStructuredReply(text: string): RagStructuredReply | null {
  const trimmed = text.trim();
  if (!trimmed.includes('【')) return null;

  const headers = [...trimmed.matchAll(SECTION_HEADER_RE)];
  if (headers.length === 0) return null;

  const sections: RagReplySection[] = [];

  for (let i = 0; i < headers.length; i++) {
    const title = headers[i][1].trim();
    const start = (headers[i].index ?? 0) + headers[i][0].length;
    const end = i + 1 < headers.length ? (headers[i + 1].index ?? trimmed.length) : trimmed.length;
    const body = trimmed.slice(start, end).trim();
    sections.push({ title, body });
  }

  return { sections };
}

export function detectSentiment(body: string): RagSentiment {
  const head = body.slice(0, 120);
  if (/看跌|📉|偏空|悲觀|看空|利空/.test(head)) return 'bearish';
  if (/看漲|📈|偏多|樂觀|看多|利多/.test(head)) return 'bullish';
  return 'neutral';
}

export function parseBulletList(body: string): string[] {
  const items = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-•·]\s/.test(line))
    .map((line) => line.replace(/^[-•·]\s+/, '').trim())
    .filter(Boolean);

  if (items.length > 0) return items;
  return body.trim() ? [body.trim()] : [];
}

export function parseSourceItems(body: string): RagSourceItem[] {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: RagSourceItem[] = [];

  for (const line of lines) {
    const urlMatch = line.match(/(https?:\/\/\S+)/);
    if (!urlMatch) continue;

    const url = urlMatch[1].replace(/[.,;)\]]+$/, '');
    let rest = line.replace(url, '').replace(/^-\s*/, '').trim();

    const indexMatch = rest.match(/片段\s*(\d+)/i);
    const titleFromLabel = rest.match(/標題[：:]\s*(.+?)(?:\s*-\s*)?$/i);
    const title = titleFromLabel
      ? titleFromLabel[1].trim()
      : rest.replace(/片段\s*\d+\s*[：:]\s*/i, '').replace(/\s*-\s*$/, '').trim() || url;

    items.push({
      index: indexMatch?.[1],
      title,
      url,
    });
  }

  return items;
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
