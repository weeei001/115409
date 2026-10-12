import apiClient from './client';
import { dedupeFetch } from '../utils/inFlight';
import type {
  CandlestickWithMAResponse,
  ChipsVolumeChartResponse,
  DailyPriceResponse,
  DateRangeResponse,
  DividendResultResponse,
  FinancialStatementKind,
  FinancialStatementRowResponse,
  ForeignShareholdingResponse,
  HistoricalPriceList,
  HoldingShareLevelResponse,
  InstitutionalTradeListResponse,
  MarginTradeResponse,
  MonthlyRevenueResponse,
  MultiStockResponse,
  PriceChangeResponse,
  PriceStatistics,
  StockInfo,
  StockListResponse,
  StockValuationResponse,
  TechnicalIndicatorListResponse,
  VolumeAnalysisResponse,
} from '../types/api';

// 這裡只擋會弄壞 URL 路徑的字元（英數 1–10 碼），比 isTaiwanStockCode 寬：API 層不判斷是不是台股代號
function stockPathSegment(symbol: string): string {
  if (typeof symbol !== 'string' || !/^[A-Za-z0-9]{1,10}$/.test(symbol)) {
    throw new Error('Invalid stock symbol');
  }
  return encodeURIComponent(symbol);
}

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

/** openapi: GET /stocks/{symbol}/latest */
export async function fetchLatestPrice(symbol: string, options?: { signal?: AbortSignal }) {
  const { data } = await apiClient.get<DailyPriceResponse>(`/stocks/${stockPathSegment(symbol)}/latest`, { signal: options?.signal });
  return data;
}

/** openapi: GET /stocks/{symbol}/date-range */
export async function fetchDateRange(symbol: string) {
  const { data } = await apiClient.get<DateRangeResponse>(`/stocks/${stockPathSegment(symbol)}/date-range`);
  return data;
}

/** openapi: GET /stocks/{symbol}/history */
export async function fetchHistory(
  symbol: string,
  params?: { start_date?: string; end_date?: string; skip?: number; limit?: number },
  options?: { signal?: AbortSignal },
) {
  const { data } = await apiClient.get<HistoricalPriceList>(`/stocks/${stockPathSegment(symbol)}/history`, { params, signal: options?.signal });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/candlestick-ma */
export async function fetchCandlestickMA(symbol: string, start_date: string, end_date: string, ma_periods?: string) {
  const { data } = await apiClient.get<CandlestickWithMAResponse>(`/stocks/${stockPathSegment(symbol)}/chart/candlestick-ma`, {
    params: { start_date, end_date, ma_periods },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/volume */
export async function fetchVolume(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<VolumeAnalysisResponse>(`/stocks/${stockPathSegment(symbol)}/chart/volume`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/chart/price-change */
export async function fetchPriceChange(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<PriceChangeResponse>(`/stocks/${stockPathSegment(symbol)}/chart/price-change`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/statistics */
export async function fetchStatistics(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<PriceStatistics>(`/stocks/${stockPathSegment(symbol)}/statistics`, {
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
  const { data } = await apiClient.get<InstitutionalTradeListResponse>(`/stocks/${stockPathSegment(symbol)}/institutional-trades`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/technical-indicators */
export async function fetchTechnicalIndicators(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<TechnicalIndicatorListResponse>(`/stocks/${stockPathSegment(symbol)}/technical-indicators`, {
    params: { start_date, end_date },
  });
  return data;
}

/** openapi: GET /stocks/{symbol}/volume-with-chips */
export async function fetchVolumeWithChips(symbol: string, start_date: string, end_date: string) {
  const { data } = await apiClient.get<ChipsVolumeChartResponse>(`/stocks/${stockPathSegment(symbol)}/volume-with-chips`, {
    params: { start_date, end_date },
  });
  return data;
}

async function fetchStockList<T>(symbol: string, path: string, params: Record<string, string>): Promise<T[]> {
  const { data } = await apiClient.get<StockListResponse<T>>(`/stocks/${stockPathSegment(symbol)}/${path}`, { params });
  if (!Array.isArray(data?.data)) throw new Error('Invalid list response');
  return data.data;
}

/** openapi: GET /stocks/{symbol}/fundamentals/monthly-revenues */
export const fetchMonthlyRevenues = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<MonthlyRevenueResponse>(symbol, 'fundamentals/monthly-revenues', { start_date, end_date });

/** openapi: GET /stocks/{symbol}/fundamentals/valuations */
export const fetchValuations = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<StockValuationResponse>(symbol, 'fundamentals/valuations', { start_date, end_date });

/** openapi: GET /stocks/{symbol}/fundamentals/financial-statements */
export const fetchFinancialStatements = (symbol: string, statement: FinancialStatementKind, start_date: string, end_date: string) =>
  fetchStockList<FinancialStatementRowResponse>(symbol, 'fundamentals/financial-statements', { statement, start_date, end_date });

/** openapi: GET /stocks/{symbol}/fundamentals/dividend-results */
export const fetchDividendResults = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<DividendResultResponse>(symbol, 'fundamentals/dividend-results', { start_date, end_date });

/** openapi: GET /stocks/{symbol}/chips/margin-trades */
export const fetchMarginTrades = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<MarginTradeResponse>(symbol, 'chips/margin-trades', { start_date, end_date });

/** openapi: GET /stocks/{symbol}/chips/foreign-shareholding */
export const fetchForeignShareholding = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<ForeignShareholdingResponse>(symbol, 'chips/foreign-shareholding', { start_date, end_date });

/** openapi: GET /stocks/{symbol}/chips/holding-share-levels */
export const fetchHoldingShareLevels = (symbol: string, start_date: string, end_date: string) =>
  fetchStockList<HoldingShareLevelResponse>(symbol, 'chips/holding-share-levels', { start_date, end_date });
