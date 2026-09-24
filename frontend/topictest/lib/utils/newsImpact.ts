import type { News, NewsImpact, NewsImpactDirection, NewsImpactScope } from '../types';

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

export const DIRECTION_CLASSES: Record<NewsImpactDirection, string> = {
  positive: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  negative: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  neutral: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
  mixed: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  uncertain: 'text-zinc-400 bg-zinc-500/15 border-zinc-500/30',
};

export function impactTarget(impact: NewsImpact): string {
  return impact.target_name || SCOPE_LABELS[impact.target_type];
}

export function visibleImpacts(
  news: News,
  stock?: string,
  relation: 'direct' | 'market_context' | 'industry_context' = 'direct',
): NewsImpact[] {
  const impacts = news.event_analysis?.status === 'success' ? news.event_analysis.impacts : [];
  if (!stock) return impacts;
  if (relation === 'market_context') return impacts.filter((impact) => impact.target_type === 'market');
  if (relation === 'industry_context') return impacts.filter((impact) => impact.target_type === 'industry');
  return impacts.filter((impact) => impact.target_type === 'company' && impact.target_id === stock);
}
