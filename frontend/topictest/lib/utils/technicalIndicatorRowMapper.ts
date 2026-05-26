import type { TechnicalIndicatorApiRow } from '../types';

function pickStr(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === '') continue;
    return String(value);
  }
  return null;
}

/** 將 API / integrated-chart 列統一為前端技術指標列（容錯多種欄位名） */
export function normalizeTechnicalIndicatorRow(
  row: Record<string, unknown>,
  symbol: string
): TechnicalIndicatorApiRow | null {
  const date = pickStr(row, 'date');
  if (!date) return null;

  const macdDif = pickStr(row, 'macd_dif', 'macd');
  const macdDea = pickStr(row, 'macd_dea', 'macd_signal');
  const macdHist =
    pickStr(row, 'macd_hist', 'macd_histogram') ??
    (() => {
      if (macdDif == null || macdDea == null) return null;
      const h = Number(macdDif) - Number(macdDea);
      return Number.isFinite(h) ? String(h) : null;
    })();

  return {
    date,
    symbol: pickStr(row, 'symbol') ?? symbol,
    close: pickStr(row, 'close'),
    ma5: pickStr(row, 'ma5'),
    ma10: pickStr(row, 'ma10'),
    ma20: pickStr(row, 'ma20'),
    ma60: pickStr(row, 'ma60'),
    ma120: pickStr(row, 'ma120'),
    ma240: pickStr(row, 'ma240'),
    rsi5: pickStr(row, 'rsi5'),
    rsi10: pickStr(row, 'rsi10', 'rsi14', 'rsi_14'),
    rsv9: pickStr(row, 'rsv9'),
    kd_k9: pickStr(row, 'kd_k9', 'k'),
    kd_d9: pickStr(row, 'kd_d9', 'd'),
    kd_j9: pickStr(row, 'kd_j9', 'j'),
    ema12: pickStr(row, 'ema12'),
    ema26: pickStr(row, 'ema26'),
    macd_dif: macdDif,
    macd_dea: macdDea,
    macd_signal: pickStr(row, 'macd_signal', 'macd_dea'),
    macd_hist: macdHist,
    boll_mid20: pickStr(row, 'boll_mid20', 'boll_mid_20'),
    boll_upper20: pickStr(row, 'boll_upper20', 'boll_upper_20'),
    boll_lower20: pickStr(row, 'boll_lower20', 'boll_lower_20'),
    volume_ma5: pickStr(row, 'volume_ma5'),
  };
}
