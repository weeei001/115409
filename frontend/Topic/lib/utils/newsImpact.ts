import type { News, NewsImpact, NewsImpactDirection, NewsImpactScope } from '../types';
import { toneBadge, type BadgeTone } from './tone';

export const DIRECTION_LABELS: Record<NewsImpactDirection, string> = {
  positive: '正向', negative: '負向', neutral: '中性', mixed: '正負並存', uncertain: '方向未明',
};

export const SCOPE_LABELS: Record<NewsImpactScope, string> = {
  market: '台股大盤', industry: '產業', company: '公司',
};

export const IMPORTANCE_LABELS: Record<NewsImpact['importance'], string> = {
  high: '高重要性', medium: '中重要性', low: '低重要性',
};

export const STATEMENT_LABELS = {
  fact: '已發生事實', plan: '計畫', forecast: '預測', opinion: '觀點',
} as const;

export const TOPIC_LABELS: Record<string, string> = {
  interest_rates: '利率', inflation: '通膨', exchange_rates: '匯率',
  trade_tariffs: '關稅貿易', geopolitics: '地緣政治', energy_materials: '能源原物料',
  regulation: '監管政策', ai: 'AI', technology_demand: '科技需求',
  company_operations: '企業營運', capital_markets: '資本市場',
};

/** 正向用漲色、負向用跌色，其餘中性（DESIGN.md 第 7 節、決議 D8） */
export const DIRECTION_TONE: Record<NewsImpactDirection, BadgeTone> = {
  positive: 'up',
  negative: 'down',
  neutral: 'neutral',
  mixed: 'neutral',
  uncertain: 'neutral',
};

/** 同上的徽章 class（ImpactDirectionTag 用 DIRECTION_TONE 傳給 Badge，結果相同） */
export const DIRECTION_CLASSES = Object.fromEntries(
  Object.entries(DIRECTION_TONE).map(([direction, tone]) => [direction, toneBadge(tone, { emphasis: true })]),
) as Record<NewsImpactDirection, string>;

export function impactTarget(impact: NewsImpact): string {
  return impact.target_name || (impact.target_type === 'company' ? impact.target_id : SCOPE_LABELS[impact.target_type]);
}

export function visibleImpacts(
  news: News,
  stock?: string,
  relation: 'direct' | 'market_context' | 'industry_context' = 'direct',
): NewsImpact[] {
  const impacts = news.event_analysis?.status === 'success' ? news.event_analysis.impacts : [];
  if (!stock) return impacts;
  if (relation === 'market_context') return impacts.filter((impact) => impact.target_type === 'market');
  if (relation === 'industry_context') return impacts.filter((impact) => impact.target_type === 'industry'
    && news.target_industries?.includes(impact.target_id));
  return impacts.filter((impact) => impact.target_type === 'company' && impact.target_id === stock);
}
