import type { SimDayEvent } from './types';

export type TradeSide = 'buy' | 'sell';

/**
 * 依持股變化判斷每天是買點還是賣點（持股增加＝買、減少＝賣、不變＝無）。
 * action 目前只實測過 "buy"，所以不拿 action 字串判斷方向。第一天和 0 股比較。
 */
export function tradeSides(days: SimDayEvent[]): Array<TradeSide | null> {
  let previous = 0;
  return days.map((day) => {
    const side: TradeSide | null = day.shares_after > previous ? 'buy' : day.shares_after < previous ? 'sell' : null;
    previous = day.shares_after;
    return side;
  });
}

/** 前端從 day 事件自己算的指標；百分比都是百分點（-1.08 代表 -1.08%） */
export interface DerivedMetrics {
  /** 最後一天的 portfolio_value */
  finalValue: number;
  /** 期末資產 ÷ 初始資金 − 1 */
  cumulativeReturnPct: number;
  /** 資產淨值從前高回落的最大幅度（正數）；起點是初始資金 */
  maxDrawdownPct: number;
  /** executed_shares 不為 0 的交易日數 */
  tradeCount: number;
  /** 買進持有：末日 close_price ÷ 首日 close_price − 1；首日收盤不合理時為 null */
  buyAndHoldReturnPct: number | null;
  /** 累積報酬率 − 買進持有報酬率（百分點） */
  excessReturnPct: number | null;
}

export function deriveMetrics(initialCash: number, days: SimDayEvent[]): DerivedMetrics | null {
  if (!days.length || !(initialCash > 0)) return null;
  const first = days[0];
  const last = days[days.length - 1];

  let peak = initialCash;
  let maxDrawdown = 0;
  for (const day of days) {
    peak = Math.max(peak, day.portfolio_value);
    maxDrawdown = Math.max(maxDrawdown, (peak - day.portfolio_value) / peak);
  }

  const cumulativeReturnPct = (last.portfolio_value / initialCash - 1) * 100;
  const buyAndHoldReturnPct = first.close_price > 0 ? (last.close_price / first.close_price - 1) * 100 : null;
  return {
    finalValue: last.portfolio_value,
    cumulativeReturnPct,
    maxDrawdownPct: maxDrawdown * 100,
    tradeCount: days.filter((day) => day.executed_shares !== 0).length,
    buyAndHoldReturnPct,
    excessReturnPct: buyAndHoldReturnPct === null ? null : cumulativeReturnPct - buyAndHoldReturnPct,
  };
}
