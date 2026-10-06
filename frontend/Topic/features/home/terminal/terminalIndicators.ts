import { signedText } from '@/components/common/LightEntry';
import { fmtIndicator, INDICATOR_LABELS, kdSignal, MACD_DECIMALS, macdSignal, rsiSignal } from '@/lib/utils/indicatorSignals';

/** 技術指標三列：名稱帶參數、RSI／KD 1 位、MACD 柱 3 位，和個股頁的指標卡同一組格式（P2-091、04-U7） */
export function terminalIndicatorRows(d: { rsi10: number | null; kd_k9: number | null; kd_d9: number | null; macd_hist: number | null }) {
  const one = (v: number | null) => (v != null && Number.isFinite(v) ? fmtIndicator(v) : '--');
  return [
    { label: INDICATOR_LABELS.rsi, value: one(d.rsi10), signal: rsiSignal(d.rsi10) },
    { label: INDICATOR_LABELS.kd, value: d.kd_k9 != null && d.kd_d9 != null ? `K ${one(d.kd_k9)} / D ${one(d.kd_d9)}` : '--', signal: kdSignal(d.kd_k9, d.kd_d9) },
    { label: INDICATOR_LABELS.macdHist, value: d.macd_hist != null ? signedText(d.macd_hist, MACD_DECIMALS) : '--', signal: macdSignal(d.macd_hist) },
  ];
}
