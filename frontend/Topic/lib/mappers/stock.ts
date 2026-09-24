import { toNum } from '../utils/parseNumber';
import type {
  CandlestickWithMAResponse,
  DailyPriceResponse,
  InstitutionalTradeListResponse,
  PriceStatistics,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorResponse,
} from '../types/api';
import type {
  ChartCandle,
  DailyQuote,
  InstitutionalDay,
  MaKey,
  PriceChartData,
  PriceStats,
  TechnicalDay,
} from '../types/view';
import { MA_KEYS } from '../types/view';

export function toDailyQuote(raw: DailyPriceResponse): DailyQuote {
  return {
    date: raw.date,
    symbol: raw.symbol,
    open: toNum(raw.open),
    high: toNum(raw.high),
    low: toNum(raw.low),
    close: toNum(raw.close),
    change: toNum(raw.change),
    volume_shares: toNum(raw.volume_shares),
    amount: toNum(raw.amount),
    trades: toNum(raw.trades),
  };
}

export function toPriceStats(raw: PriceStatistics): PriceStats {
  return {
    start_date: raw.start_date,
    end_date: raw.end_date,
    highest_price: toNum(raw.highest_price),
    lowest_price: toNum(raw.lowest_price),
    average_close: toNum(raw.average_close),
    total_volume: toNum(raw.total_volume),
    total_amount: toNum(raw.total_amount),
    trading_days: raw.trading_days,
  };
}

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

/** 法人買賣超：依日期由舊到新 */
export function mapInstitutionalTrades(api: InstitutionalTradeListResponse): InstitutionalDay[] {
  return (api.data ?? [])
    .map((row) => ({
      date: String(row.date),
      foreign_buy: toNum(row.foreign_buy),
      foreign_sell: toNum(row.foreign_sell),
      foreign_net: toNum(row.foreign_net),
      investment_trust_buy: toNum(row.investment_trust_buy),
      investment_trust_sell: toNum(row.investment_trust_sell),
      investment_trust_net: toNum(row.investment_trust_net),
      dealer_buy: toNum(row.dealer_buy),
      dealer_sell: toNum(row.dealer_sell),
      dealer_net: toNum(row.dealer_net),
      total_institutional_buy: toNum(row.total_institutional_buy),
      total_institutional_sell: toNum(row.total_institutional_sell),
      total_institutional_net: toNum(row.total_institutional_net),
    }))
    .sort(byDate);
}

const TECHNICAL_FIELDS = [
  'close', 'ma5', 'ma10', 'ma20', 'ma60', 'ma120', 'ma240', 'rsi5', 'rsi10', 'rsv9',
  'kd_k9', 'kd_d9', 'kd_j9', 'ema12', 'ema26', 'macd_dif', 'macd_dea', 'macd_signal',
  'macd_hist', 'boll_mid20', 'boll_upper20', 'boll_lower20', 'volume_ma5',
] as const satisfies ReadonlyArray<keyof TechnicalIndicatorResponse & keyof TechnicalDay>;

/** 技術指標：openapi 以字串回傳 Decimal，轉成數字並依日期由舊到新 */
export function mapTechnicalIndicators(api: TechnicalIndicatorListResponse): TechnicalDay[] {
  return (api.data ?? [])
    .filter((row) => Boolean(row.date))
    .map((row) => {
      const day = { date: String(row.date) } as TechnicalDay;
      for (const field of TECHNICAL_FIELDS) day[field] = toNum(row[field]);
      return day;
    })
    .sort(byDate);
}

export function lastItem<T>(rows: T[] | null | undefined): T | null {
  return rows && rows.length ? rows[rows.length - 1] : null;
}

/** candlestick-ma → K 線、成交量與 MA overlay（MA 鍵為 `MA{period}`） */
export function candlestickMaToPriceChart(data: CandlestickWithMAResponse): PriceChartData | null {
  if (!data.candlestick?.length) return null;
  const candles: ChartCandle[] = data.candlestick.map((row) => ({
    time: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }));
  const volume = data.candlestick.map((row) => ({ time: row.date, value: row.volume }));
  const ma = data.moving_averages ?? {};
  const dates = data.dates?.length ? data.dates : data.candlestick.map((c) => c.date);
  const toOverlay = (key: MaKey) =>
    dates.map((date, i) => {
      const value = ma[key]?.[i] ?? null;
      return { time: date, value: value != null && Number.isFinite(Number(value)) ? Number(value) : null };
    });
  const overlays = Object.fromEntries(MA_KEYS.map((key) => [key, toOverlay(key)])) as PriceChartData['overlays'];
  return { candles, volume, overlays };
}
