export interface DashboardBlock {
  title: string;
  description: string;
  source_ids: string[];
}

export interface DashboardMetrics extends DashboardBlock {
  kind: 'metrics';
  items: Array<{ label: string; value: number | null; unit: string; date: string | null }>;
}

export interface DashboardChart extends DashboardBlock {
  kind: 'chart';
  dates: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  unit: string;
}

export interface DashboardTable extends DashboardBlock {
  kind: 'table';
  columns: string[];
  rows: string[][];
}

export interface DashboardNews extends DashboardBlock {
  kind: 'news';
  items: Array<{ title: string; publisher: string; published_at: string; url: string; source_id: string }>;
}

export type ChatDashboardBlock = DashboardMetrics | DashboardChart | DashboardTable | DashboardNews;

export interface ChatDashboard {
  title: string;
  blocks: ChatDashboardBlock[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000;
const number = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const strings = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value) && value.length <= limit && value.every(text);
const sourceId = (value: unknown): value is string => typeof value === 'string' && /^S[1-9][0-9]*$/.test(value);

export function safeDashboardUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password &&
      !/[\s<>]/.test(value) ? value : '';
  } catch {
    return '';
  }
}

function isBlock(value: unknown): value is ChatDashboardBlock {
  if (!record(value) || !text(value.title) || !text(value.description) ||
      !strings(value.source_ids, 60) || !value.source_ids.every(sourceId)) return false;
  switch (value.kind) {
    case 'metrics':
      return Array.isArray(value.items) && value.items.length <= 24 && value.items.every((item) =>
        record(item) && text(item.label) && number(item.value) && text(item.unit) &&
        (item.date === null || text(item.date)));
    case 'chart':
      return strings(value.dates, 40) && text(value.unit) && Array.isArray(value.series) &&
        value.series.length <= 12 && value.series.every((series) =>
          record(series) && text(series.name) && Array.isArray(series.values) &&
          series.values.length === (value.dates as string[]).length && series.values.every(number));
    case 'table':
      return strings(value.columns, 12) && value.columns.length > 0 && Array.isArray(value.rows) &&
        value.rows.length <= 40 && value.rows.every((row) => strings(row, 12) &&
          row.length === (value.columns as string[]).length);
    case 'news':
      return Array.isArray(value.items) && value.items.length <= 12 && value.items.every((item) =>
        record(item) && text(item.title) && text(item.publisher) && text(item.published_at) &&
        text(item.url) && sourceId(item.source_id));
    default:
      return false;
  }
}

/** Unknown/malformed blocks never become executable UI or fabricated numeric values. */
export function parseChatDashboard(value: unknown): ChatDashboard | undefined {
  if (!record(value) || !text(value.title) || !Array.isArray(value.blocks) || value.blocks.length > 60) return;
  const blocks = value.blocks.filter(isBlock).map((block) => block.kind === 'news'
    ? { ...block, items: block.items.map((item) => ({ ...item, url: safeDashboardUrl(item.url) })) }
    : block);
  return blocks.length ? { title: value.title, blocks } : undefined;
}
