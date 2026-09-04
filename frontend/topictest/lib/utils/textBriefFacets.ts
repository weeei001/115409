import type { Brief, EvidenceItem } from '../types/textBrief';
import { fmtNum, fmtPercent } from './format';

/**
 * 五個分析面向的分級。
 *
 * 刻意不讓 LLM 產生分數：每一格都是「拿證據目錄裡的某個數字，套一條寫死的門檻」，
 * 門檻與依據數字都直接顯示在畫面上（`rule` / `basis`），可以自己對帳。
 * 拿不到對應的數字就顯示「資料不足」，不猜、不補。
 */

export type FacetKey = 'fundamental' | 'valuation' | 'momentum' | 'chips' | 'risk';

/** 只表達語意，畫面另外配文字標籤，不靠顏色單獨傳達 */
export type FacetTone = 'good' | 'neutral' | 'caution' | 'unknown' | 'info';

export interface Facet {
  key: FacetKey;
  label: string;
  tone: FacetTone;
  /** 強／普通／弱、偏高／中性／偏低、買超／賣超…… */
  levelLabel: string;
  /** 分級所依據的原始數字 */
  basis: string;
  /** 分級規則，畫面上要看得到 */
  rule: string;
  evidenceIds: string[];
}

/** 分級門檻。改這裡就等於改畫面上的規則說明。 */
export const FACET_RULES = {
  /** 每股盈餘（或月營收）年增率 */
  fundamentalStrongYoyPct: 15,
  fundamentalWeakYoyPct: 0,
  /** 本益比（或股價淨值比）在近一年的百分位 */
  valuationHighRank: 70,
  valuationLowRank: 30,
  /** 收盤價相對季線的偏離幅度 */
  momentumStrongPct: 3,
  momentumWeakPct: -3,
} as const;

const UNKNOWN_BASIS = '證據目錄裡沒有這一項可用的數字';

function pick(items: EvidenceItem[], field: string): EvidenceItem | undefined {
  return items.find((item) => item.field === field);
}

function unknown(key: FacetKey, label: string, rule: string): Facet {
  return { key, label, tone: 'unknown', levelLabel: '資料不足', basis: UNKNOWN_BASIS, rule, evidenceIds: [] };
}

function fundamentalFacet(items: EvidenceItem[]): Facet {
  const rule = `每股盈餘年增 ≥ ${FACET_RULES.fundamentalStrongYoyPct}% 為強，年增為負為弱，其餘普通；沒有 EPS 時改看單月營收年增。`;
  const eps = pick(items, 'eps');
  const revenue = pick(items, 'revenue_monthly');
  const source = eps?.yoy_pct != null ? eps : revenue?.yoy_pct != null ? revenue : null;
  if (!source || source.yoy_pct == null) return unknown('fundamental', '基本面', rule);

  const yoy = source.yoy_pct;
  const name = source.field === 'eps' ? '每股盈餘' : '單月營收';
  const streak = pick(items, 'revenue_yoy_positive_streak');
  const evidenceIds = [source.id, ...(streak ? [streak.id] : [])];
  const basisParts = [
    `${source.period ?? source.date ?? ''} ${name}年增 ${fmtPercent(yoy, { sign: true, decimals: 1 })}`,
  ];
  if (typeof streak?.value === 'number') basisParts.push(`營收年增連續 ${streak.value} 個月為正`);

  const tone: FacetTone =
    yoy >= FACET_RULES.fundamentalStrongYoyPct
      ? 'good'
      : yoy < FACET_RULES.fundamentalWeakYoyPct
        ? 'caution'
        : 'neutral';
  return {
    key: 'fundamental',
    label: '基本面',
    tone,
    levelLabel: tone === 'good' ? '強' : tone === 'caution' ? '弱' : '普通',
    basis: basisParts.join('、'),
    rule,
    evidenceIds,
  };
}

function valuationFacet(items: EvidenceItem[]): Facet {
  const rule = `本益比在近一年的百分位 ≥ ${FACET_RULES.valuationHighRank} 為偏高，≤ ${FACET_RULES.valuationLowRank} 為偏低，其餘中性；沒有本益比時改看股價淨值比。`;
  const per = pick(items, 'per');
  const pbr = pick(items, 'pbr');
  const source = per?.pct_rank_1y != null ? per : pbr?.pct_rank_1y != null ? pbr : null;
  if (!source || source.pct_rank_1y == null) return unknown('valuation', '評價', rule);

  const rank = source.pct_rank_1y;
  const name = source.field === 'per' ? '本益比' : '股價淨值比';
  const tone: FacetTone =
    rank >= FACET_RULES.valuationHighRank
      ? 'caution'
      : rank <= FACET_RULES.valuationLowRank
        ? 'good'
        : 'neutral';
  return {
    key: 'valuation',
    label: '評價',
    tone,
    levelLabel: tone === 'caution' ? '偏高' : tone === 'good' ? '偏低' : '中性',
    basis: `${name} ${source.value}，位於近一年第 ${rank} 百分位`,
    rule,
    evidenceIds: [source.id],
  };
}

function momentumFacet(items: EvidenceItem[], maStructureLabel?: string): Facet {
  const rule = `收盤價相對季線 ≥ +${FACET_RULES.momentumStrongPct}% 為強，≤ ${FACET_RULES.momentumWeakPct}% 為弱，其餘普通。`;
  const vsMa60 = pick(items, 'vs_ma60_pct');
  const position = pick(items, 'close_pos_in_1y_pct');

  if (typeof vsMa60?.value === 'number') {
    const value = vsMa60.value;
    const tone: FacetTone =
      value >= FACET_RULES.momentumStrongPct
        ? 'good'
        : value <= FACET_RULES.momentumWeakPct
          ? 'caution'
          : 'neutral';
    const basisParts = [`相對季線 ${fmtPercent(value, { sign: true, decimals: 1 })}`];
    if (typeof position?.value === 'number') {
      basisParts.push(`位於近一年區間 ${fmtPercent(position.value, { decimals: 1 })}`);
    }
    return {
      key: 'momentum',
      label: '技術動能',
      tone,
      levelLabel: tone === 'good' ? '強' : tone === 'caution' ? '弱' : '普通',
      basis: basisParts.join('、'),
      rule,
      evidenceIds: [vsMa60.id, ...(position ? [position.id] : [])],
    };
  }

  // 證據目錄沒有均線資料時，退回儀表板價量資料自己算的均線結構（同樣不是 AI 產生的）
  if (maStructureLabel && maStructureLabel !== '無資料') {
    const tone: FacetTone =
      maStructureLabel === '偏多' ? 'good' : maStructureLabel === '偏空' ? 'caution' : 'neutral';
    return {
      key: 'momentum',
      label: '技術動能',
      tone,
      levelLabel: tone === 'good' ? '強' : tone === 'caution' ? '弱' : '普通',
      basis: `收盤價相對 20／60 日均線：${maStructureLabel}`,
      rule: '證據目錄沒有均線數字，改用本頁價量資料計算收盤價與 20／60 日均線的相對位置。',
      evidenceIds: [],
    };
  }
  return unknown('momentum', '技術動能', rule);
}

function chipsFacet(items: EvidenceItem[]): Facet {
  const rule = '近十日外資累計買賣超為正記為買超、為負記為賣超，只看方向不做強弱分級。';
  const chips = pick(items, 'foreign_net_10d_lots');
  if (typeof chips?.value !== 'number') return unknown('chips', '法人籌碼', rule);

  const value = chips.value;
  const tone: FacetTone = value > 0 ? 'good' : value < 0 ? 'caution' : 'neutral';
  return {
    key: 'chips',
    label: '法人籌碼',
    tone,
    levelLabel: value > 0 ? '買超' : value < 0 ? '賣超' : '中性',
    basis: `近十日外資累計 ${value > 0 ? '+' : ''}${fmtNum(value)} 張`,
    rule,
    evidenceIds: [chips.id],
  };
}

function riskFacet(brief: Brief | null | undefined): Facet {
  const rule = '這一格是 AI 列出的風險項數，不是量化評分。';
  const risks = brief?.risks ?? [];
  if (!risks.length) {
    return {
      key: 'risk',
      label: '風險',
      tone: 'unknown',
      levelLabel: '未列出',
      basis: '這次分析沒有列出風險項目',
      rule,
      evidenceIds: [],
    };
  }
  return {
    key: 'risk',
    label: '風險',
    tone: 'info',
    levelLabel: `AI 列出 ${risks.length} 項`,
    basis: risks.map((risk) => risk.risk_type).filter(Boolean).join('、') || '見情境與風險',
    rule,
    evidenceIds: risks.flatMap((risk) => risk.evidence_ids ?? []),
  };
}

/**
 * 產生五個面向。`asOfDate` 用來排除日期晚於基準日的證據，
 * `maStructureLabel` 是技術動能在證據不足時的備援（本站價量計算，非 AI）。
 */
export function buildFacets(
  catalog: EvidenceItem[] | null | undefined,
  options: { brief?: Brief | null; asOfDate?: string | null; maStructureLabel?: string } = {}
): Facet[] {
  const { brief, asOfDate, maStructureLabel } = options;
  const items = (catalog ?? []).filter((item) => !(asOfDate && item.date && item.date > asOfDate));
  return [
    fundamentalFacet(items),
    valuationFacet(items),
    momentumFacet(items, maStructureLabel),
    chipsFacet(items),
    riskFacet(brief),
  ];
}
