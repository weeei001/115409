import type { AIBacktestResult, BacktestGroupKey, BacktestPreset, BacktestStance } from '../types/api';
import { gapText } from '../utils/format';

export const STANCE_LABEL: Record<BacktestStance, string> = {
  bullish: '偏多', mildly_bullish: '溫和偏多', neutral: '中性', mildly_bearish: '溫和偏空', bearish: '偏空',
};
export const STANCES: BacktestStance[] = ['bullish', 'mildly_bullish', 'neutral', 'mildly_bearish', 'bearish'];

/** 持股規則：和後端 engine.PRESETS 同一組數字（null＝中性不調整） */
export const PRESET_RULES: Record<BacktestPreset, { label: string; targets: Record<BacktestStance, number | null> }> = {
  conservative: { label: '保守', targets: { bullish: 0.6, mildly_bullish: 0.4, neutral: null, mildly_bearish: 0.2, bearish: 0 } },
  standard: { label: '標準', targets: { bullish: 1, mildly_bullish: 0.7, neutral: null, mildly_bearish: 0.3, bearish: 0 } },
  aggressive: { label: '積極', targets: { bullish: 1, mildly_bullish: 1, neutral: null, mildly_bearish: 0.5, bearish: 0 } },
};

export function presetText(preset: BacktestPreset): string {
  const { targets } = PRESET_RULES[preset];
  return STANCES.map((stance) => `${STANCE_LABEL[stance]} ${targets[stance] == null ? '不調整' : `${Math.round(targets[stance]! * 100)}%`}`).join('、');
}

export const GROUP_ORDER: BacktestGroupKey[] = ['rule', 'ai_plain', 'ai_signals'];

/** 兩個報酬率的差（百分點）：「比買進持有高 2.10 個百分點」 */
export function returnGapText(value: number, baseline: number | null, name: string): string {
  return gapText(baseline == null ? null : Math.round((value - baseline) * 100) / 100, name, `沒有${name}可比較`);
}

/** 曲線最後一天相對起始資金的報酬（%）；沒有資料為 null */
export function curveReturn(curve: number[], initial: number): number | null {
  return curve.length && initial ? Math.round((curve[curve.length - 1] / initial - 1) * 10000) / 100 : null;
}

export function baselineReturns(result: AIBacktestResult) {
  return { buyAndHold: curveReturn(result.buy_and_hold, result.initial_cash), market: curveReturn(result.market_index, result.initial_cash) };
}

/** 一次判斷的持股變化：「目標持股 70%，2025-01-03 開盤買進 120 股」；和目標差不到 5 個百分點時「不用成交」 */
export function tradeText(target: number | null | undefined, shares: number | undefined, executionDate?: string | null): string {
  if (!executionDate) return '期間最後一次判斷，沒有隔日可以成交';
  const goal = target == null ? '不調整持股' : `目標持股 ${Math.round(target * 100)}%`;
  if (!shares) return target == null ? goal : `${goal}，不用成交`;
  return `${goal}，${executionDate} 開盤${shares > 0 ? '買進' : '賣出'} ${Math.abs(shares).toLocaleString('zh-TW')} 股`;
}
