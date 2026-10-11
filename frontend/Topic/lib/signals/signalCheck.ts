import type { SignalEvidenceItem, SignalPeriodStats, SignalReading, SignalStats } from '../types/api';
import { gapText, rateText, signedText } from '../utils/format';

/** 少於這麼多次事件就不下判讀：幾十次以內的平均很容易被一兩次大漲跌左右 */
export const MIN_SIGNAL_EVENTS = 30;
/** 事件分布少於這麼多個月份也不判讀：誤差範圍以月份為單位估計，月份太少時範圍本身就不可靠 */
export const MIN_SIGNAL_MONTHS = 6;

export const READING_LABEL: Record<SignalReading, string> = { bullish: '偏多', bearish: '偏空' };

/** 樣本不足的原因：「不到 30 次」「不到 6 個月」；夠的話是 null */
export function thinReason(stats: SignalPeriodStats): string | null {
  if (stats.events < MIN_SIGNAL_EVENTS) return `不到 ${MIN_SIGNAL_EVENTS} 次`;
  if ((stats.months ?? 0) < MIN_SIGNAL_MONTHS) return `不到 ${MIN_SIGNAL_MONTHS} 個月`;
  return null;
}

/** 「比同期其他股票高 0.11 個百分點」；沒有其他股票可比時直接說 */
export const peersGapText = (stats: SignalPeriodStats): string =>
  gapText(stats.vs_peers_pct ?? null, '同期其他股票', '沒有同期其他股票可以比較');

/** 「（誤差 ±0.48）」；沒有差距或不到 2 個月時是空字串 */
export const marginText = (stats: SignalPeriodStats): string =>
  stats.vs_peers_pct != null && stats.vs_peers_margin_pct != null ? `（誤差 ±${stats.vs_peers_margin_pct.toFixed(2)}）` : '';

/** 「比同期其他股票高 0.11 個百分點（誤差 ±0.48）」 */
export const peersText = (stats: SignalPeriodStats): string => peersGapText(stats) + marginText(stats);

type PeriodReading = 'agrees' | 'opposes' | 'unclear';

/**
 * 一段期間和一般解讀的關係：誤差範圍整段落在一般解讀那一側（偏多訊號高於其他股票、偏空訊號低於）才算一致，
 * 整段在另一側算相反，跨過 0 就是分不出差別。樣本不足或缺值時為 null。
 */
export function periodReading(stats: SignalPeriodStats, reading: SignalReading): PeriodReading | null {
  const gap = stats.vs_peers_pct, margin = stats.vs_peers_margin_pct;
  if (thinReason(stats) || gap == null || margin == null) return null;
  const side = gap - margin > 0 ? 1 : gap + margin < 0 ? -1 : 0;
  if (!side) return 'unclear';
  return (side > 0) === (reading === 'bullish') ? 'agrees' : 'opposes';
}

type SignalVerdict = 'thin' | 'both' | 'discovery_only' | 'validation_only' | 'mixed' | 'opposes' | 'both_oppose' | 'unclear';

export const VERDICT_LABEL: Record<SignalVerdict, string> = {
  thin: '樣本不足，先不判讀',
  both: '兩段都明顯和一般解讀一致',
  discovery_only: '只有挑選期明顯一致，可能是運氣',
  validation_only: '只有驗證期明顯一致',
  mixed: '兩段結果相反',
  opposes: '有一段明顯和一般解讀相反',
  both_oppose: '兩段都明顯和一般解讀相反',
  unclear: '兩段都和其他股票分不出差別',
};

/**
 * 判讀看兩段各自比同期其他股票高或低多少，以及它的 95% 誤差範圍；門檻寫在畫面上，不是分數。
 * 任一段不到 MIN_SIGNAL_EVENTS 次或 MIN_SIGNAL_MONTHS 個月就不判讀。
 */
export function signalVerdict(signal: SignalStats): SignalVerdict {
  const early = periodReading(signal.discovery, signal.reading);
  const late = periodReading(signal.validation, signal.reading);
  if (!early || !late) return 'thin';
  const periods = [early, late];
  if (periods.includes('opposes')) {
    if (periods.includes('agrees')) return 'mixed';
    return early === late ? 'both_oppose' : 'opposes';
  }
  if (early === 'agrees') return late === 'agrees' ? 'both' : 'discovery_only';
  return late === 'agrees' ? 'validation_only' : 'unclear';
}

/** 證據的成立時間：「判斷日當天成立」或「3 個交易日前成立（2025-06-05）」 */
export function firedText(item: Pick<SignalEvidenceItem, 'trading_days_ago' | 'fired_on'>): string {
  return item.trading_days_ago === 0 ? '判斷日當天成立' : `${item.trading_days_ago} 個交易日前成立（${item.fired_on}）`;
}

/** 截至判斷日的歷史一句話：次數、平均漲跌、上漲比例；沒有已到期的事件時直接說 */
export function historyText(stats: SignalPeriodStats, horizon: number): string {
  if (!stats.events) return '還沒有已到期的紀錄';
  return `${stats.events} 次，之後第 ${horizon} 個交易日平均 ${signedText(stats.avg_return_pct, 2, '%')}，上漲 ${rateText(stats.up_rate)}`;
}

/** 分割日的前一天，用來寫「挑選期 2021-01-01 ~ 2024-12-31」 */
export function dayBefore(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
