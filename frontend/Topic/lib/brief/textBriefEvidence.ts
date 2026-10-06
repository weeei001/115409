import type { DailyEvidenceValue, EvidenceItem } from '../types/textBrief';
import { fmtAmount, fmtNum, fmtPercent } from '../utils/format';
import { safeHttpUrl } from '../utils/url';

/**
 * 證據目錄的顯示層：把 `d_40`、`fd_01`、`nw_11` 這種內部 id 轉成人看得懂的名稱。
 *
 * 原始 id 不會消失（反查與稽核都要用），只是降級成證據詳情裡的小字。
 * 這裡只做「同一份資料換個說法」，不做任何數值加工——顯示的數字必須跟
 * evidence_catalog 一模一樣，換算單位時（元→億元）原始數字也一併保留。
 */

/** 來源分類。搭配文字標籤與圖示，不靠顏色區分。 */
export type EvidenceCategory = 'filing' | 'market' | 'guidance' | 'news';

export interface EvidenceCategoryMeta {
  label: string;
  /** 這類資料怎麼來的，證據詳情用一句話交代 */
  origin: string;
}

export const EVIDENCE_CATEGORY: Record<EvidenceCategory, EvidenceCategoryMeta> = {
  filing: {
    label: '官方財報',
    origin: '公司申報的財務報表與月營收數字，由本站資料庫彙整。',
  },
  market: {
    label: '證交所／市場資料',
    origin: '集中市場每日收盤、成交量、三大法人買賣超與評價指標。',
  },
  guidance: {
    label: '法說／財測媒體轉述',
    origin: '媒體轉述的公司財測或法說內容，屬於未來展望，不是公司實際公布的財務結果。',
  },
  news: {
    label: '財經新聞',
    origin: '財經媒體報導，內容包含媒體與市場人士的觀點。',
  },
};

/** 證據來源分頁的分組，順序即畫面順序 */
export type EvidenceGroupKey = 'daily' | 'chips' | 'longTerm' | 'fundamental' | 'news';

export const EVIDENCE_GROUPS: [EvidenceGroupKey, string][] = [
  ['daily', '交易資料'],
  ['chips', '法人籌碼'],
  ['longTerm', '長期位階'],
  ['fundamental', '基本面'],
  ['news', '新聞'],
];

export interface EvidenceMetric {
  name: string;
  /** 已含單位；數值與 evidence_catalog 一致 */
  value: string;
}

export interface ResolvedEvidence {
  id: string;
  /** 可讀名稱，例如「09/03 交易資料」「2026Q2 每股盈餘」 */
  label: string;
  group: EvidenceGroupKey;
  category: EvidenceCategory;
  /** 這個數字是由原始資料再算一次得到的，不是機構直接發布的值 */
  computed: boolean;
  calculation?: EvidenceItem["calculation"];
  publishedAt?: string | null;
  collectedAt?: string | null;
  publicationBasis?: string | null;
  /** 日期或財務期間，原樣顯示 */
  dateText: string | null;
  publisher: string | null;
  /** 一行摘要，列表與 aria-label 用 */
  summary: string;
  metrics: EvidenceMetric[];
  title: string | null;
  excerpt: string | null;
  url: string | null;
  /** Immutable local article revision, separate from the publisher's mutable page. */
  savedVersionUrl: string | null;
  /** 新聞性質；guidance 要另外標示「非實際數字」 */
  kind: string | null;
  /** 日期晚於 as_of_date：資料有問題，不可當成可點擊來源 */
  futureDated: boolean;
}

interface FieldMeta {
  name: string;
  group: EvidenceGroupKey;
  category: EvidenceCategory;
  computed: boolean;
  /** 純量欄位的單位；百分比欄位交給 fmtPercent，不放這裡 */
  unit?: string;
  percent?: boolean;
  /** 標籤要不要冠上日期／期間 */
  prefix?: 'date' | 'period' | 'none';
}

const FIELD_META: Record<string, FieldMeta> = {
  daily_timeline: { name: '交易資料', group: 'daily', category: 'market', computed: false, prefix: 'date' },
  foreign_net_10d_lots: {
    name: '近十日外資統計',
    group: 'chips',
    category: 'market',
    computed: true,
    unit: '張',
  },
  high_1y: { name: '近一年最高收盤', group: 'longTerm', category: 'market', computed: true, unit: '元' },
  low_1y: { name: '近一年最低收盤', group: 'longTerm', category: 'market', computed: true, unit: '元' },
  close_pos_in_1y_pct: {
    name: '近一年區間位置',
    group: 'longTerm',
    category: 'market',
    computed: true,
    percent: true,
  },
  vs_ma60_pct: { name: '相對季線位置', group: 'longTerm', category: 'market', computed: true, percent: true },
  vs_ma240_pct: { name: '相對年線位置', group: 'longTerm', category: 'market', computed: true, percent: true },
  eps: { name: '每股盈餘', group: 'fundamental', category: 'filing', computed: false, unit: '元', prefix: 'period' },
  gross_margin_pct: {
    name: '毛利率',
    group: 'fundamental',
    category: 'filing',
    computed: true,
    percent: true,
    prefix: 'period',
  },
  operating_margin_pct: {
    name: '營業利益率',
    group: 'fundamental',
    category: 'filing',
    computed: true,
    percent: true,
    prefix: 'period',
  },
  revenue_monthly: {
    name: '單月營收',
    group: 'fundamental',
    category: 'filing',
    computed: false,
    prefix: 'period',
  },
  revenue_yoy_positive_streak: {
    name: '月營收年增連續月數',
    group: 'fundamental',
    category: 'filing',
    computed: true,
    unit: '個月',
  },
  per: { name: '本益比', group: 'fundamental', category: 'market', computed: false, unit: '倍' },
  pbr: { name: '股價淨值比', group: 'fundamental', category: 'market', computed: false, unit: '倍' },
  dividend_yield: { name: '現金殖利率', group: 'fundamental', category: 'market', computed: false, percent: true },
  news: { name: '新聞', group: 'news', category: 'news', computed: false, prefix: 'date' },
};

const UNKNOWN_FIELD: FieldMeta = {
  name: '其他資料',
  group: 'longTerm',
  category: 'market',
  computed: false,
};

/** `2026-09-03` → `09/03`；不是 ISO 日期就原樣回傳 */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return matched ? `${matched[2]}/${matched[3]}` : value;
}

function dailyMetrics(value: DailyEvidenceValue): EvidenceMetric[] {
  const metrics: EvidenceMetric[] = [];
  if (value.close != null) metrics.push({ name: '收盤價', value: `${value.close} 元` });
  if (value.chg_pct != null) {
    metrics.push({ name: '漲跌幅', value: fmtPercent(value.chg_pct, { sign: true }) });
  }
  if (value.vol_lots != null) {
    metrics.push({ name: '成交量', value: `${fmtNum(value.vol_lots)} 張` });
  }
  if (value.vol_vs_ma5_pct != null) {
    metrics.push({
      name: '量能較五日均量',
      value: fmtPercent(value.vol_vs_ma5_pct, { sign: true, decimals: 0 }),
    });
  }
  if (value.foreign_net_lots != null) {
    metrics.push({
      name: '外資買賣超',
      value: `${value.foreign_net_lots > 0 ? '+' : ''}${fmtNum(value.foreign_net_lots)} 張`,
    });
  }
  for (const [field, name] of [['macd', 'MACD'], ['macd_signal', 'MACD 訊號線'], ['macd_hist', 'MACD 柱']] as const) {
    if (value[field] != null) metrics.push({ name, value: String(value[field]) });
  }
  return metrics;
}

function scalarMetrics(item: EvidenceItem, meta: FieldMeta): EvidenceMetric[] {
  const metrics: EvidenceMetric[] = [];
  const raw = item.value;

  if (typeof raw === 'number') {
    if (meta.percent) {
      metrics.push({ name: meta.name, value: fmtPercent(raw, { decimals: 1 }) });
    } else if (item.field === 'revenue_monthly') {
      // 單位換算後保留原始數字，避免「顯示數字與證據不一致」
      metrics.push({ name: meta.name, value: `${fmtAmount(raw)}（${fmtNum(raw)} 元）` });
    } else {
      const signed = meta.unit === '張' && raw > 0 ? '+' : '';
      metrics.push({ name: meta.name, value: `${signed}${fmtNum(raw)}${meta.unit ? ` ${meta.unit}` : ''}` });
    }
  } else if (raw != null && typeof raw !== 'object') {
    metrics.push({ name: meta.name, value: String(raw) });
  }

  if (item.qoq_pct != null) metrics.push({ name: '季增', value: fmtPercent(item.qoq_pct, { sign: true, decimals: 1 }) });
  if (item.yoy_pct != null) metrics.push({ name: '年增', value: fmtPercent(item.yoy_pct, { sign: true, decimals: 1 }) });
  if (item.mom_pct != null) metrics.push({ name: '月增', value: fmtPercent(item.mom_pct, { sign: true, decimals: 1 }) });
  if (item.pct_rank_1y != null) {
    metrics.push({ name: '近一年位階', value: `第 ${item.pct_rank_1y} 百分位` });
  }
  if (item.sample_count != null) {
    metrics.push({ name: '估值樣本', value: `${item.sample_count} 筆（${item.window_start ?? '未知'} → ${item.window_end ?? '未知'}）` });
  }
  if (item.available_at) metrics.push({ name: '保守可用日', value: item.available_at });
  if (item.last4q?.length) {
    metrics.push({
      name: '近四季',
      value: item.last4q.map(([period, number]) => `${period} ${number}`).join('、'),
    });
  }
  if (item.yoy_last6?.length) {
    metrics.push({
      name: '近六月年增',
      value: item.yoy_last6.map(([period, number]) => `${period} ${number}%`).join('、'),
    });
  }
  return metrics;
}

export function resolveEvidenceItem(item: EvidenceItem, asOfDate?: string | null): ResolvedEvidence {
  const meta = FIELD_META[item.field] ?? UNKNOWN_FIELD;
  const isNews = item.field === 'news';
  const kind = typeof item.kind === 'string' ? item.kind : null;
  const category: EvidenceCategory = isNews && kind === 'guidance' ? 'guidance' : meta.category;
  const publisher = item.publisher?.trim() || null;
  const dateText = item.period ?? item.date ?? null;

  let label = meta.name;
  if (meta.prefix === 'date' && item.date) {
    label = isNews
      ? `${shortDate(item.date)} ${publisher ? `${publisher}報導` : '財經新聞'}`
      : `${shortDate(item.date)} ${meta.name}`;
  } else if (meta.prefix === 'period' && item.period) {
    label = `${item.period} ${meta.name}`;
  }

  const excerpt = isNews && typeof item.value === 'string' ? item.value : null;
  const metrics =
    item.value && typeof item.value === 'object'
      ? dailyMetrics(item.value as DailyEvidenceValue)
      : isNews
        ? []
        : scalarMetrics(item, meta);

  const summary = isNews
    ? (item.title ?? excerpt ?? label)
    : metrics.map((metric) => `${metric.name} ${metric.value}`).join('　') || label;

  return {
    id: item.id,
    label,
    group: meta.group,
    category,
    computed: meta.computed,
    calculation: item.calculation,
    publishedAt: item.published_at,
    collectedAt: item.collected_at,
    publicationBasis: [
      item.publication_basis,
      item.content_truncated ? '僅使用部分內文，可能漏掉其他段落' : null,
      item.shared_fact_ids?.length ? '與其他報導包含相同事實，不代表多份獨立證據' : null,
      item.source_state?.limitation ? '依新聞發布時間回顧，使用目前有效原文版本' : null,
      item.source_relationships?.some((relation) => relation.relationship === 'industry_context')
        ? '產業背景，不代表這家公司已發生相同事件或股價影響' : null,
    ].filter(Boolean).join('；') || null,
    dateText,
    publisher,
    summary,
    metrics,
    title: isNews ? (item.title ?? null) : null,
    excerpt,
    url: safeHttpUrl(item.url),
    savedVersionUrl: isNews && /^[A-Za-z0-9_-]{1,64}$/.test(item.article_id ?? '')
      && /^[0-9a-f]{64}$/.test(item.source_state?.revision_id ?? '')
      ? `/news/${encodeURIComponent(item.article_id!)}?revision_id=${item.source_state!.revision_id}` : null,
    kind,
    futureDated: Boolean(asOfDate && item.date && item.date > asOfDate),
  };
}

export interface EvidenceGroup {
  key: EvidenceGroupKey;
  label: string;
  items: ResolvedEvidence[];
}

export interface EvidenceIndex {
  /** 目錄裡真的存在的證據 */
  byId: Map<string, ResolvedEvidence>;
  groups: EvidenceGroup[];
  total: number;
  /** 日期晚於基準日的證據 id；這些不當成可用來源 */
  futureDatedIds: string[];
  undatedIds: string[];
  /** 存在且日期合理，才可以顯示成可點擊的來源 */
  usable(id: string): boolean;
  resolve(id: string): ResolvedEvidence | null;
  /** 從一組引用中挑出目錄裡查不到的 id */
  unresolved(ids?: string[]): string[];
}

/**
 * 建立證據索引，同時做資料驗證：
 *   - 目錄查不到的 id → `unresolved()`，前端不得顯示成可點擊來源
 *   - 日期晚於 as_of_date → `futureDatedIds`，同樣不可用（拿未來資料解釋過去）
 */
export function buildEvidenceIndex(
  catalog: EvidenceItem[] | null | undefined,
  asOfDate?: string | null
): EvidenceIndex {
  const byId = new Map<string, ResolvedEvidence>();
  for (const item of catalog ?? []) {
    if (!item?.id || byId.has(item.id)) continue;
    byId.set(item.id, resolveEvidenceItem(item, asOfDate));
  }

  const futureDatedIds = [...byId.values()].filter((it) => it.futureDated).map((it) => it.id);
  const groups: EvidenceGroup[] = EVIDENCE_GROUPS.map(([key, label]) => ({
    key,
    label,
    items: [...byId.values()].filter((item) => item.group === key),
  })).filter((group) => group.items.length > 0);

  return {
    byId,
    groups,
    total: byId.size,
    futureDatedIds,
    undatedIds: (catalog ?? []).filter((item) => !item.date).map((item) => item.id),
    usable: (id) => {
      const found = byId.get(id);
      return Boolean(found && !found.futureDated);
    },
    resolve: (id) => byId.get(id) ?? null,
    unresolved: (ids) => (ids ?? []).filter((id) => !byId.get(id)),
  };
}
