import type { SignalEvidenceItem, SignalPeriodStats, SignalReading, SignalStats } from '../types/api';
import { gapText, rateText, signedText } from '../utils/format';

/** 少於這麼多次事件就不下判讀：幾十次以內的平均很容易被一兩次大漲跌左右 */
export const MIN_SIGNAL_EVENTS = 30;

export const READING_LABEL: Record<SignalReading, string> = { bullish: '偏多', bearish: '偏空' };

/** 和同一期間「任一天進場」的平均漲跌差距（百分點），四捨五入到 0.01；任一方缺值為 null */
export function edgeVsBaseline(stats: SignalPeriodStats, baseline: SignalPeriodStats): number | null {
  if (stats.avg_return_pct == null || baseline.avg_return_pct == null) return null;
  return Math.round((stats.avg_return_pct - baseline.avg_return_pct) * 100) / 100;
}

/** 「比任一天進場高 0.42 個百分點」；缺值時寫「無法比較」 */
export const edgeText = (edge: number | null): string => gapText(edge, '任一天進場', '無法和任一天進場比較');

/** 這一期的結果和一般解讀是否一致：偏多訊號之後比任一天進場好，偏空訊號之後比任一天進場差 */
function agrees(reading: SignalReading, edge: number | null): boolean | null {
  if (edge == null) return null;
  return reading === 'bullish' ? edge > 0 : edge < 0;
}

type SignalVerdict ='thin' | 'both' | 'discovery_only' | 'validation_only' | 'neither';

export const VERDICT_LABEL: Record<SignalVerdict, string> = {
  thin: '樣本不足，先不判讀',
  both: '兩段都和一般解讀一致',
  discovery_only: '只有挑選期一致，可能是運氣',
  validation_only: '只有驗證期一致',
  neither: '兩段都和一般解讀不一致',
};

/**
 * 判讀只看兩段各自和任一天進場的差距正負，門檻寫在畫面上；不是統計檢定，也不是分數。
 * 任一段事件數不到 MIN_SIGNAL_EVENTS 就不判讀。
 */
export function signalVerdict(signal: SignalStats, baseline: SignalStats): SignalVerdict {
  if (signal.discovery.events < MIN_SIGNAL_EVENTS || signal.validation.events < MIN_SIGNAL_EVENTS) return 'thin';
  const early = agrees(signal.reading, edgeVsBaseline(signal.discovery, baseline.discovery));
  const late = agrees(signal.reading, edgeVsBaseline(signal.validation, baseline.validation));
  if (early == null || late == null) return 'thin';
  if (early && late) return 'both';
  if (early) return 'discovery_only';
  return late ? 'validation_only' : 'neither';
}

/** 證據的成立時間：「判斷日當天成立」或「3 個交易日前成立（2025-06-05）」 */
export function firedText(item: Pick<SignalEvidenceItem, 'trading_days_ago' | 'fired_on'>): string {
  return item.trading_days_ago === 0 ? '判斷日當天成立' : `${item.trading_days_ago} 個交易日前成立（${item.fired_on}）`;
}

/** 截至判斷日的歷史一句話：次數、平均漲跌、上漲與贏大盤比例；沒有已到期的事件時直接說 */
export function historyText(stats: SignalPeriodStats, horizon: number): string {
  if (!stats.events) return '還沒有已到期的紀錄';
  return `${stats.events} 次，之後第 ${horizon} 個交易日平均 ${signedText(stats.avg_return_pct, 2, '%')}，上漲 ${rateText(stats.up_rate)}、贏大盤 ${rateText(stats.beat_market_rate)}`;
}

/** 分割日的前一天，用來寫「挑選期 2021-01-01 ~ 2024-12-31」 */
export function dayBefore(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
