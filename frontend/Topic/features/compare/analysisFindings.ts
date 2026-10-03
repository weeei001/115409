import type { CompareFundamentalsData } from '@/lib/api/compareFundamentals';
import type { CategoryLeader, CompareQualityMeta, CorrelationMatrix, InstitutionalAggregate } from '@/lib/types/compare';
import { lowestCorrelationPair } from '@/lib/utils/compare';
import { buildFundamentalsComparison } from '@/lib/utils/compareFundamentals';
import { fmtInstitutionalShares } from '@/lib/utils/format';

/**
 * 「延伸分析」索引表每一列的一句發現。只挑出頁面上已算好的值（類別冠軍、各面板用的同一批彙總），
 * 不新算指標、不寫推論；挑不出真實的一句話時回傳 null，由索引表改顯示該分析的說明。
 */

const signed = (value: number, text: string) => (value > 0 && !text.startsWith('+') ? `+${text}` : text);

/** 類別冠軍的讀數：有方向（up）的補上正號，和類別冠軍表的寫法一致 */
const leaderValue = (item: CategoryLeader) => (item.tone === 'up' && !item.value.startsWith('+') ? `+${item.value}` : item.value);

function leader(leaders: CategoryLeader[], id: CategoryLeader['id']): CategoryLeader | null {
  return leaders.find((item) => item.id === id && item.symbol !== '--') ?? null;
}

/** 波動與漲跌幅分佈：類別冠軍裡的「區間漲跌幅最高」「年化波動最低」 */
export function scatterFinding(leaders: CategoryLeader[]): string | null {
  const best = leader(leaders, 'bestReturn');
  const calm = leader(leaders, 'minVolatility');
  const parts = [
    best ? `${best.symbol} 區間漲跌幅最高（${leaderValue(best)}）` : null,
    calm ? `${calm.symbol} 年化波動最低（${calm.value}）` : null,
  ].filter(Boolean);
  return parts.length ? parts.join('；') : null;
}

/** 基本面：面板用的同一個對齊結果，說明哪些項目同期間可比 */
export function fundamentalsFinding(symbols: string[], data: Record<string, CompareFundamentalsData | null>, endDate: string): string | null {
  if (!symbols.some((sym) => data[sym])) return null;
  const { aligned } = buildFundamentalsComparison(symbols, data, endDate);
  return [
    `月營收${aligned.revenue ? '同月份可比' : '月份未對齊'}`,
    `估值${aligned.valuation ? '同日期可比' : '日期未對齊'}`,
    `EPS ${aligned.eps ? '同期間口徑可比' : '期間或口徑未對齊'}`,
  ].join('、') + '；不排名';
}

/** 三大法人：面板彙總表的合計淨額，列出最高與最低的一檔 */
export function institutionalFinding(symbols: string[], aggregateMap: Record<string, InstitutionalAggregate>): string | null {
  const totals = symbols
    .map((sym) => aggregateMap[sym])
    .filter((agg): agg is InstitutionalAggregate => Boolean(agg) && agg.totalNet != null && Number.isFinite(agg.totalNet));
  if (!totals.length) return null;
  const sorted = [...totals].sort((a, b) => (b.totalNet as number) - (a.totalNet as number));
  const fmt = (agg: InstitutionalAggregate) => signed(agg.totalNet as number, fmtInstitutionalShares(agg.totalNet));
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (sorted.length === 1) return `${top.symbol} 期間法人合計淨額 ${fmt(top)}`;
  return `期間合計淨額最高 ${top.symbol}（${fmt(top)}）、最低 ${bottom.symbol}（${fmt(bottom)}）`;
}

/** 技術指標快照：類別冠軍的「均線最偏多」（MA20 對 MA60 乖離最高） */
export function technicalFinding(leaders: CategoryLeader[]): string | null {
  const strongest = leader(leaders, 'strongestMomentum');
  if (!strongest) return null;
  return `${strongest.symbol} 的 MA20 對 MA60 乖離最高（${leaderValue(strongest)}）`;
}

/**
 * 相關性：兩檔時直接寫那一組；三檔以上沿用類別冠軍的排名規則（有效配對樣本 ≥ 20 筆才排名），
 * 用同一個 lowestCorrelationPair 找最低，取負值再找一次即為最高。
 */
export function correlationFinding(
  symbols: string[],
  matrix: CorrelationMatrix,
  samples: Record<string, Record<string, number>>,
): string | null {
  if (symbols.length < 2) return null;
  if (symbols.length === 2) {
    const [a, b] = symbols;
    const rho = matrix[a]?.[b];
    if (rho == null) return null;
    return `${a} × ${b} 的 ρ ${rho.toFixed(2)}（有效配對樣本 ${samples[a]?.[b] ?? 0} 筆）`;
  }
  const ranked: CorrelationMatrix = {};
  const negated: CorrelationMatrix = {};
  for (const a of symbols) {
    ranked[a] = {};
    negated[a] = {};
    for (const b of symbols) {
      const value = (samples[a]?.[b] ?? 0) >= 20 ? matrix[a]?.[b] ?? null : null;
      ranked[a][b] = value;
      negated[a][b] = value == null ? null : -value;
    }
  }
  const lowest = lowestCorrelationPair(symbols, ranked);
  const highestNeg = lowestCorrelationPair(symbols, negated);
  if (!lowest || !highestNeg) return null;
  const high = `${highestNeg.a} × ${highestNeg.b} ρ ${(-highestNeg.value).toFixed(2)}`;
  const low = `${lowest.a} × ${lowest.b} ρ ${lowest.value.toFixed(2)}`;
  if (high === low) return `${low}（有效配對樣本 ≥ 20 筆的組合）`;
  return `最高 ${high}、最低 ${low}（只比有效配對樣本 ≥ 20 筆的組合）`;
}

/** 方法與可信度：實際比較期間、共同樣本與提醒數 */
export function methodFinding(meta: CompareQualityMeta, tradingDays: number | null): string {
  if (!meta.analysisRange) return '共同有效收盤價不足 2 天，無法建立實際比較期間';
  const days = tradingDays ? `，共 ${tradingDays} 個交易日` : '';
  const warnings = meta.qualityWarnings.length ? `；${meta.qualityWarnings.length} 項可解釋性提醒` : '';
  return `實際比較期間 ${meta.analysisRange.startDate} → ${meta.analysisRange.endDate}${days}；共同日漲跌樣本 ${meta.alignedDays} 筆${warnings}`;
}
