import type { Brief, EvidenceItem } from '../types/textBrief';
import { fmtPercent, lotsToShares, signedShares } from '../utils/format';

/**
 * 五個分析面向的分級。
 *
 * 刻意不讓 LLM 產生分數：每一格都是「拿證據目錄裡的某個數字，套一條寫死的門檻」，
 * 門檻與依據數字都直接顯示在畫面上（`rule` / `basis`），可以自己對帳。
 * 拿不到對應的數字就顯示「資料不足」，並寫出缺的是哪個數字，不猜、不補。
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

function pick(items: EvidenceItem[], field: string): EvidenceItem | undefined {
  return items.find((item) => item.field === field);
}

/** `basis` 寫出缺的是哪個數字；畫面上不提「證據目錄」這種內部名稱 */
function unknown(key: FacetKey, label: string, rule: string, basis: string): Facet {
  return { key, label, tone: 'unknown', levelLabel: '資料不足', basis, rule, evidenceIds: [] };
}

function fundamentalFacet(items: EvidenceItem[]): Facet {
  const rule = `每股盈餘年增 ≥ ${FACET_RULES.fundamentalStrongYoyPct}% 為強，年增為負為弱，其餘普通；沒有 EPS 時改看單月營收年增。`;
  const eps = pick(items, 'eps');
  const revenue = pick(items, 'revenue_monthly');
  const source = eps?.yoy_pct != null ? eps : revenue?.yoy_pct != null ? revenue : null;
  if (!source || source.yoy_pct == null) {
    return unknown('fundamental', '基本面', rule, '缺少每股盈餘或單月營收的年增率，無法分級');
  }

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
  if (!source || source.pct_rank_1y == null) {
    // 有本益比、沒有百分位時，同一張卡的其他段落可能寫著本益比，這裡要講清楚缺的是百分位
    const basis = per || pbr ? '缺少近一年百分位，無法分級' : '缺少本益比與股價淨值比，無法分級';
    return unknown('valuation', '評價', rule, basis);
  }

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

function momentumFacet(items: EvidenceItem[]): Facet {
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

  return unknown('momentum', '技術動能', rule, '缺少收盤價相對季線的幅度，無法分級');
}

function chipsFacet(items: EvidenceItem[]): Facet {
  const rule = '近十日外資累計買賣超為正記為買超、為負記為賣超，只看方向不做強弱分級。';
  const chips = pick(items, 'foreign_net_10d_lots');
  if (typeof chips?.value !== 'number') {
    return unknown('chips', '法人籌碼', rule, '缺少近十日外資累計買賣超，無法分級');
  }

  const value = chips.value;
  const tone: FacetTone = value > 0 ? 'good' : value < 0 ? 'caution' : 'neutral';
  return {
    key: 'chips',
    label: '法人籌碼',
    tone,
    levelLabel: value > 0 ? '買超' : value < 0 ? '賣超' : '中性',
    basis: `近十日外資累計 ${signedShares(lotsToShares(value))}`,
    rule,
    evidenceIds: [chips.id],
  };
}

/**
 * 情境風險＝`brief.risks`（附觸發條件的風險），和「負面因素」（`negative_factors`）是兩回事。
 * 空的時候可能是 AI 沒列，也可能是後端檢查把它刪了，所以不能寫成「沒有風險」。
 */
function riskFacet(brief: Brief | null | undefined): Facet {
  const rule = '這一格是 AI 列出的情境風險項數，不是量化評分。';
  const risks = brief?.risks ?? [];
  if (!risks.length) {
    return {
      key: 'risk',
      label: '情境風險',
      tone: 'unknown',
      levelLabel: '未列出',
      basis: '本次未列出或未通過檢查（不代表沒有風險）',
      rule,
      evidenceIds: [],
    };
  }
  return {
    key: 'risk',
    label: '情境風險',
    tone: 'info',
    levelLabel: `AI 列出 ${risks.length} 項`,
    basis: risks.map((risk) => risk.risk_type).filter(Boolean).join('、') || '見完整分析的「情境與風險」',
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
  const { brief, asOfDate } = options;
  const items = (catalog ?? []).filter((item) => !(asOfDate && item.date && item.date > asOfDate));
  return [
    fundamentalFacet(items),
    valuationFacet(items),
    momentumFacet(items),
    chipsFacet(items),
    riskFacet(brief),
  ];
}
