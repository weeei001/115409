import type {
  InstitutionalTradeApiRow,
  InstitutionalTradeListApiResponse,
  TechnicalIndicatorListApiResponse,
} from '../types';
import { normalizeTechnicalIndicatorRow } from './technicalIndicatorRowMapper';
import type {
  InstitutionalDayRow,
  InstitutionalTradeListResponse,
  InstitutionalTradeResponse,
  TechnicalIndicatorDayRow,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorResponse,
} from '../types/stockDashboard';
import { toNum } from './parseNumber';

function mapInstitutionalRow(row: InstitutionalTradeApiRow): InstitutionalDayRow {
  return {
    date: String(row.date),
    foreign_buy: toNum(row.foreign_buy),
    foreign_sell: toNum(row.foreign_sell),
    foreign_excl_dealer_net: toNum(row.foreign_net),
    investment_trust_buy: toNum(row.investment_trust_buy),
    investment_trust_sell: toNum(row.investment_trust_sell),
    investment_trust_net: toNum(row.investment_trust_net),
    dealer_buy: toNum(row.dealer_buy),
    dealer_sell: toNum(row.dealer_sell),
    dealer_net_total: toNum(row.dealer_net),
    total_institutional_buy: toNum(row.total_institutional_buy),
    total_institutional_sell: toNum(row.total_institutional_sell),
    total_net: toNum(row.total_institutional_net),
  };
}

export function mapInstitutionalTradesApi(
  symbol: string,
  api: InstitutionalTradeListApiResponse
): InstitutionalTradeListResponse {
  const data = (api.data ?? []).map(mapInstitutionalRow).sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol: api.symbol ?? symbol,
    start_date: api.start_date,
    end_date: api.end_date,
    data,
  };
}

export function mapInstitutionalLatestFromList(
  symbol: string,
  list: InstitutionalTradeListResponse | null
): InstitutionalTradeResponse | null {
  const last = list?.data?.[list.data.length - 1];
  if (!last) return null;
  return {
    symbol,
    date: last.date,
    foreign_buy: last.foreign_buy,
    foreign_sell: last.foreign_sell,
    foreign_excl_dealer_net: last.foreign_excl_dealer_net,
    investment_trust_buy: last.investment_trust_buy,
    investment_trust_sell: last.investment_trust_sell,
    investment_trust_net: last.investment_trust_net,
    dealer_buy: last.dealer_buy,
    dealer_sell: last.dealer_sell,
    dealer_net_total: last.dealer_net_total,
    total_institutional_buy: last.total_institutional_buy,
    total_institutional_sell: last.total_institutional_sell,
    total_net: last.total_net,
  };
}

function mapTechnicalRow(row: ReturnType<typeof normalizeTechnicalIndicatorRow>): TechnicalIndicatorDayRow {
  if (!row) {
    throw new Error('mapTechnicalRow: empty row');
  }
  return {
    date: String(row.date),
    ma5: toNum(row.ma5),
    ma10: toNum(row.ma10),
    ma20: toNum(row.ma20),
    ma60: toNum(row.ma60),
    ma120: toNum(row.ma120),
    ma240: toNum(row.ma240),
    rsi5: toNum(row.rsi5),
    rsi10: toNum(row.rsi10),
    rsv9: toNum(row.rsv9),
    kd_k9: toNum(row.kd_k9),
    kd_d9: toNum(row.kd_d9),
    kd_j9: toNum(row.kd_j9),
    ema12: toNum(row.ema12),
    ema26: toNum(row.ema26),
    macd_dif: toNum(row.macd_dif),
    macd_dea: toNum(row.macd_dea),
    macd_signal: toNum(row.macd_signal),
    macd_hist: toNum(row.macd_hist),
    boll_mid20: toNum(row.boll_mid20),
    boll_upper20: toNum(row.boll_upper20),
    boll_lower20: toNum(row.boll_lower20),
    volume_ma5: toNum(row.volume_ma5),
  };
}

export function mapTechnicalIndicatorsApi(
  symbol: string,
  api: TechnicalIndicatorListApiResponse
): TechnicalIndicatorListResponse {
  const data = (api.data ?? [])
    .map((row) => normalizeTechnicalIndicatorRow(row as unknown as Record<string, unknown>, symbol))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map(mapTechnicalRow)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol: api.symbol ?? symbol,
    start_date: api.start_date,
    end_date: api.end_date,
    data,
  };
}

export function mapTechnicalLatestFromList(
  symbol: string,
  list: TechnicalIndicatorListResponse | null
): TechnicalIndicatorResponse | null {
  const last = list?.data?.[list.data.length - 1];
  if (!last) return null;
  return {
    symbol,
    date: last.date,
    rsi5: last.rsi5,
    rsi10: last.rsi10,
    macd_hist: last.macd_hist,
  };
}
