import apiClient from './client';
import { dedupeFetch } from '../utils/inFlight';
import type {
  CandlestickWithMAResponse,
  ChipsVolumeChartResponse,
  DailyPriceResponse,
  DateRangeResponse,
  HistoricalPriceList,
  InstitutionalTradeListResponse,
  MultiStockResponse,
  PriceChangeResponse,
  PriceStatistics,
  StockInfo,
  TechnicalIndicatorListResponse,
  VolumeAnalysisResponse,
} from '../types/api';

function normalizeStockInfoList(data: unknown): StockInfo[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as { symbol?: unknown; name?: unknown; industry?: unknown };
    if (typeof value.symbol !== 'string' || typeof value.name !== 'string') return [];
    const symbol = value.symbol.trim().toUpperCase();
    const name = value.name.trim();
    return symbol && name
      ? [{ symbol, name, industry: typeof value.industry === 'string' ? value.industry : null }]
      : [];
  });
}

export async function fetchStockInfos(): Promise<StockInfo[]> {
  return dedupeFetch(
    'GET /stocks/info',
    async () => {
      const { data } = await apiClient.get<unknown>('/stocks/info');
      return normalizeStockInfoList(data);
    },
    30_000,
  );
}

/** openapi: GET /stocks/symbols → string[]（30 秒快取） */
export async function fetchSymbols(): Promise<string[]> {
  return dedupeFetch(
    'GET /stocks/symbols',
    async () => {
      const { data } = await apiClient.get<string[]>('/stocks/symbols');
      return Array.isArray(data)
        ? data.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toUpperCase()).filter(Boolean)
        : [];
    },
    30_000,
  );
}

/** openapi: GET /stocks/{symbol}/latest */
export async function fetchLatestPrice(symbol: string, options?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get<DailyPriceResponse>(`/stocks/${symbol}/latest`, { signal: options?.signal });
  return data;
}

/** openapi: GET /stocks/{symbol}/date-range */
export async function fetchDateRange(symbol: string) {
  const { data } = await apiClient.get<DateRangeResponse>(`/stocks/${symbol}/date-range`);
  return data;
}

/** openapi: GET /stocks/{symbol}/history */
export async function fetchHistory(
  symbol: string,
  params?: { start_date?: string; end_date?: string; skip?: number; limit?: number },
  options?: { signal?: AbortSignal },
) {
  const { data } = await apiClient.get<HistoricalPriceList>(`/stocks/${symbol}/history`, { params, signal: options?.signal });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/candlestick-ma */
export async function fetchCandlestickMA(symbol: string, start_date: string, end_date: string, ma_periods?: string) {
  const { data } = await apiClient.get<CandlestickWithMAResponse>(`/stocks/${symbol}/chart/candlestick-ma`, {
    params: { start_date, end_date, ma_periods },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/volume */
export async function fetchVolume(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<VolumeAnalysisResponse>(`/stocks/${symbol}/chart/volume`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/price-change */
export async function fetchPriceChange(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<PriceChangeResponse>(`/stocks/${symbol}/chart/price-change`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/statistics */
export async function fetchStatistics(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<PriceStatistics>(`/stocks/${symbol}/statistics`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/compare/multiple */
export async function fetchMultipleStocks(symbols: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<MultiStockResponse>('/stocks/compare/multiple', {
    params: { symbols, start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/institutional-trades */
export async function fetchInstitutionalTrades(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<InstitutionalTradeListResponse>(`/stocks/${symbol}/institutional-trades`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/technical-indicators */
export async function fetchTechnicalIndicators(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<TechnicalIndicatorListResponse>(`/stocks/${symbol}/technical-indicators`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/volume-with-chips */
export async function fetchVolumeWithChips(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<ChipsVolumeChartResponse>(`/stocks/${symbol}/volume-with-chips`, {
    params: { start_date, end_date },
  });
  return data;
}
