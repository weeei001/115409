import type {
  AdvisorAction,
  AdvisorReport,
  AdvisorSource,
  AITrendAnalysis,
} from '../types';
import type {
  AnalyzeNewsSourceItem,
  ProjectionDirection,
  StockBehaviorAiProjection,
  StockBehaviorAiResponse,
  StockBehaviorRagResponse,
} from '../types/stockBehavior';
import { DEFAULT_STOCK_BEHAVIOR_LOOKBACK_DAYS } from '../types/stockBehavior';

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function subtractDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveAsOfDateRange(as_of_date: string, recentLookbackDays?: number): {
  date_start: string;
  date_end: string;
} {
  const lookback = recentLookbackDays ?? DEFAULT_STOCK_BEHAVIOR_LOOKBACK_DAYS;
  return {
    date_start: subtractDaysYmd(as_of_date, lookback),
    date_end: as_of_date,
  };
}

export function trendStateToAction(state?: string): AdvisorAction {
  if (!state) return 'wait';
  if (state === 'bullish' || state === 'mildly_bullish' || state === 'up') return 'buy';
  if (state === 'bearish' || state === 'mildly_bearish' || state === 'down') return 'sell';
  return 'wait';
}

export function normalizeRecommendationFromText(text: string): AdvisorAction {
  const token = text.toLowerCase();
  if (token.includes('偏多') || token.includes('bullish') || token.includes('buy') || token.includes('看多')) {
    return 'buy';
  }
  if (token.includes('偏空') || token.includes('bearish') || token.includes('sell') || token.includes('看空')) {
    return 'sell';
  }
  return 'wait';
}

function directionToAction(direction?: ProjectionDirection): AdvisorAction {
  if (direction === 'up') return 'buy';
  if (direction === 'down') return 'sell';
  return 'wait';
}

function recommendationFromProjection(projection?: StockBehaviorAiProjection): AdvisorAction {
  const points = projection?.points ?? [];
  if (!points.length) return 'wait';
  let up = 0;
  let down = 0;
  for (const p of points) {
    if (p.direction === 'up') up += 1;
    else if (p.direction === 'down') down += 1;
  }
  if (up > down) return 'buy';
  if (down > up) return 'sell';
  return directionToAction(points[points.length - 1]?.direction);
}

export function newsSourcesToAdvisorSources(items: AnalyzeNewsSourceItem[] | undefined): AdvisorSource[] {
  if (!items?.length) return [];
  return items
    .map((item): AdvisorSource | null => {
      const title = toStringValue(item.title);
      if (!title) return null;
      return {
        title,
        url: toStringValue(item.url) ?? undefined,
        publisher: undefined,
        published_at: toStringValue(item.timestamp),
        type: 'news',
        summary: toStringValue(item.summary) ?? undefined,
      };
    })
    .filter((s): s is AdvisorSource => s !== null);
}

export function mergeRagIntoReport(base: AdvisorReport, rag: StockBehaviorRagResponse): AdvisorReport {
  const sources = newsSourcesToAdvisorSources(rag.news_sources);
  return {
    ...base,
    sources: sources.length ? sources : base.sources,
    summary: rag.raw_answer?.trim() || base.summary,
  };
}

function formatProjectionBrief(projection?: StockBehaviorAiProjection): string {
  const points = projection?.points ?? [];
  if (!points.length) return projection?.disclaimer?.trim() ?? '';
  const reasons = points
    .map((p) => p.reason?.trim())
    .filter(Boolean)
    .slice(0, 2);
  const joined = reasons.join(' ');
  const disclaimer = projection?.disclaimer?.trim();
  if (joined && disclaimer) return `${joined} ${disclaimer}`;
  return joined || disclaimer || '';
}

function inventoryToReasoning(inventory?: StockBehaviorAiResponse['data_inventory']): string {
  if (!inventory) return '';
  const lines: string[] = [];
  const pushItems = (label: string, items?: { field: string; value: unknown }[]) => {
    for (const item of items ?? []) {
      const val = item.value != null ? String(item.value) : '';
      if (val) lines.push(`${label}：${item.field} ${val}`);
    }
  };
  pushItems('價量', inventory.price_volume);
  pushItems('籌碼', inventory.chip);
  pushItems('技術', inventory.technical);
  if (inventory.missing_fields?.length) {
    lines.push(`資料缺口：${inventory.missing_fields.join('、')}`);
  }
  return lines.slice(0, 5).join('\n');
}

export function mapAiToAdvisorReport(
  ai: StockBehaviorAiResponse,
  rag: StockBehaviorRagResponse
): AdvisorReport {
  const recommendation = recommendationFromProjection(ai.projection);
  const projectionBrief = formatProjectionBrief(ai.projection);
  const rawAnswer = rag.raw_answer?.trim() ?? '';
  const inventoryReason = inventoryToReasoning(ai.data_inventory);
  const reasoning = [projectionBrief, inventoryReason, rawAnswer].filter(Boolean).join('\n') || '分析完成';

  const missing = ai.data_inventory?.missing_fields ?? [];
  const riskNotes =
    [ai.projection?.disclaimer, missing.length ? `缺少欄位：${missing.join('、')}` : null]
      .filter(Boolean)
      .join(' ') || null;

  const { date_start, date_end } = resolveAsOfDateRange(ai.as_of_date);

  const lastPoint = ai.projection?.points?.[ai.projection.points.length - 1];
  const recommendationText = lastPoint?.reason?.trim() || rawAnswer || undefined;

  return {
    symbol: ai.symbol,
    generated_at: new Date().toISOString(),
    summary: projectionBrief || rawAnswer || '分析完成',
    technical_signals: (ai.projection?.points ?? []).slice(0, 5).map((p) => ({
      name: `情境 D+${p.day}`,
      value: p.predicted_close ?? null,
      interpretation: p.reason?.trim() || p.direction || '',
    })),
    recommendation,
    recommendation_text: recommendationText,
    reasoning,
    risk_notes: riskNotes,
    sources: newsSourcesToAdvisorSources(rag.news_sources),
    date_start,
    date_end,
  };
}

export function stockBehaviorToAiTrend(
  ai: StockBehaviorAiResponse,
  rag: StockBehaviorRagResponse
): AITrendAnalysis | null {
  const points = ai.projection?.points ?? [];
  const last = points[points.length - 1];
  const direction = last?.direction;
  const conclusion =
    last?.reason?.trim() ||
    rag.raw_answer?.trim() ||
    (direction === 'up' ? '情境推演偏多' : direction === 'down' ? '情境推演偏空' : '情境推演完成');

  const sources = newsSourcesToAdvisorSources(rag.news_sources).map((s, i) => ({
    id: String(i),
    title: s.title,
    date: s.published_at ?? ai.as_of_date,
  }));

  return {
    conclusion,
    summary: [rag.raw_answer, formatProjectionBrief(ai.projection)].filter(Boolean).join(' ') || conclusion,
    sources,
  };
}
