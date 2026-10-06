import { safeHttpUrl } from '../utils/url';

/** AI 對話回覆的資料面板（openapi: ChatDashboard 與各 Dashboard* schema）；不合格的區塊一律丟掉 */
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
  items: Array<{ title: string; publisher: string; published_at: string; url: string; source_id: string; article_id?: string | null }>;
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
const articleId = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || (typeof value === 'string' && value.length <= 64);

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
        text(item.url) && sourceId(item.source_id) && articleId(item.article_id));
    default:
      return false;
  }
}

/**
 * openapi 把 description、source_ids、unit、metric.date 列為選填（後端有預設值）；舊紀錄可能沒有這些欄位。
 * 缺的補上 openapi 的預設值再驗證，型別不對的照樣丟掉。
 */
function withDefaults(value: unknown): unknown {
  if (!record(value)) return value;
  const block: Record<string, unknown> = { description: '', source_ids: [], ...value };
  if (value.kind === 'chart' && block.unit === undefined) block.unit = '';
  if (value.kind === 'metrics' && Array.isArray(value.items)) {
    block.items = value.items.map((item) => record(item) ? { unit: '', date: null, ...item } : item);
  }
  return block;
}

/** Unknown/malformed blocks never become executable UI or fabricated numeric values. */
export function parseChatDashboard(value: unknown): ChatDashboard | undefined {
  if (!record(value) || !text(value.title) || !Array.isArray(value.blocks) || value.blocks.length > 60) return;
  const blocks = value.blocks.map(withDefaults).filter(isBlock).map((block) => block.kind === 'news'
    ? { ...block, items: block.items.map((item) => ({ ...item, url: safeHttpUrl(item.url) ?? '' })) }
    : block);
  return blocks.length ? { title: value.title, blocks } : undefined;
}
