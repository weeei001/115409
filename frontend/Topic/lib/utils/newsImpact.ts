import type { News, NewsImpact, NewsImpactDirection, NewsImpactScope } from '../types';
import type { BadgeTone } from './tone';

export const DIRECTION_LABELS: Record<NewsImpactDirection, string> = {
  positive: '正向', negative: '負向', neutral: '中性', mixed: '正負並存', uncertain: '方向未明',
};

export const SCOPE_LABELS: Record<NewsImpactScope, string> = {
  market: '大盤', industry: '產業', company: '個股',
};

export const IMPORTANCE_LABELS: Record<NewsImpact['importance'], string> = {
  high: '高重要性', medium: '中重要性', low: '低重要性',
};

export const STATEMENT_LABELS = {
  fact: '已發生事實', plan: '計畫', forecast: '預測', opinion: '觀點',
} as const;

export const BASIS_LABELS: Record<NewsImpact['basis'], string> = {
  reported: '原文提到', inferred: 'AI 推論',
};

/**
 * 標籤的判定說明，依後端影響分析提示詞（`backend/app/features/news/impact.py` 的 SYSTEM_PROMPT）改寫成白話。
 * 方向是對營運面的判讀，不是股價預測。
 */
export const LABEL_HINTS = {
  direction: [
    ['正向／負向', '對該對象可能有利／可能不利'],
    ['中性', '看不出明顯的有利或不利'],
    ['正負並存', '有利與不利的因素都有'],
    ['方向未明', '目前還無法判斷方向'],
  ],
  importance: [
    ['高重要性', '涉及重大的政策、營運或資金變化'],
    ['中重要性', '有意義，但影響範圍有限'],
    ['低重要性', '例行或輕微的消息'],
  ],
  basis: [
    ['原文提到', '新聞明確寫出對該對象的影響'],
    ['AI 推論', '新聞沒有直接寫，由 AI 依事件推論，理由裡會寫出推論過程'],
  ],
  statement: [
    ['已發生事實／計畫', '已經發生的事／宣布要做的事'],
    ['預測／觀點', '對未來的估計／個人或機構的看法'],
  ],
} as const;

/** 個股相關新聞的三種關聯（後端 `retrieval/service.py` 的 related_news 篩選） */
export const RELATION_HINTS: Record<'direct' | 'industry_context' | 'market_context', string> = {
  direct: '新聞提到這檔股票，或 AI 判讀對它有影響。',
  industry_context: 'AI 判讀新聞影響這檔股票所屬的產業，不代表直接影響這家公司。',
  market_context: 'AI 判讀新聞影響整體台股，不代表直接影響這家公司。',
};

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
