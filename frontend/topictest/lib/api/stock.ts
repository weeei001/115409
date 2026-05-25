import apiClient from './client';
import { dedupeFetch } from '../utils/inFlight';
import { toNum } from '../utils/parseNumber';
import type {
  DailyPriceResponse,
  HistoricalPriceList,
  CandlestickWithMAResponse,
  VolumeAnalysisResponse,
  PriceChangeResponse,
  PriceStatistics,
  MultiStockResponse,
  DateRangeResponse,
  InstitutionalTradeListApiResponse,
  TechnicalIndicatorListApiResponse,
  ChipsVolumeChartResponse,
} from '../types';
import type { IntegratedChartResponse } from '../types/integratedChart';

function normalizeDailyPrice(raw: DailyPriceResponse): DailyPriceResponse {
  return {
    ...raw,
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

function normalizePriceStatistics(raw: PriceStatistics): PriceStatistics {
  return {
    ...raw,
    highest_price: toNum(raw.highest_price),
    lowest_price: toNum(raw.lowest_price),
    average_close: toNum(raw.average_close),
    total_volume: toNum(raw.total_volume),
    total_amount: toNum(raw.total_amount),
  };
}

function normalizeSymbolList(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (typeof item === 'string') return item.trim().toUpperCase();
      if (item && typeof item === 'object' && 'symbol' in item) {
        const sym = (item as { symbol?: unknown }).symbol;
        if (typeof sym === 'string') return sym.trim().toUpperCase();
      }
      return '';
    })
    .filter(Boolean);
}

export async function fetchSymbols(): Promise<string[]> {
  return dedupeFetch(
    'GET /stocks/symbols',
    async () => {
      const { data } = await apiClient.get<unknown>('/stocks/symbols');
      return normalizeSymbolList(data);
    },
    30_000,
  );
}

export async function fetchLatestPrice(symbol: string): Promise<DailyPriceResponse> {
  const { data } = await apiClient.get<DailyPriceResponse>(`/stocks/${symbol}/latest`);
  return normalizeDailyPrice(data);
}

export async function fetchDateRange(symbol: string): Promise<DateRangeResponse> {
  const { data } = await apiClient.get<DateRangeResponse>(`/stocks/${symbol}/date-range`);
  return data;
}

export async function fetchHistory(
  symbol: string,
  params?: { start_date?: string; end_date?: string; skip?: number; limit?: number }
): Promise<HistoricalPriceList> {
  const { data } = await apiClient.get<HistoricalPriceList>(`/stocks/${symbol}/history`, { params });
  return { ...data, data: (data.data ?? []).map(normalizeDailyPrice) };
}

export async function fetchCandlestickMA(
  symbol: string,
  start_date: string,
  end_date: string,
  ma_periods?: string
): Promise<CandlestickWithMAResponse> {
  const { data } = await apiClient.get<CandlestickWithMAResponse>(
    `/stocks/${symbol}/chart/candlestick-ma`,
    { params: { start_date, end_date, ma_periods } }
  );
  return data;
}

export async function fetchVolume(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<VolumeAnalysisResponse> {
  const { data } = await apiClient.get<VolumeAnalysisResponse>(
    `/stocks/${symbol}/chart/volume`,
    { params: { start_date, end_date } }
  );
  return data;
}

export async function fetchPriceChange(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<PriceChangeResponse> {
  const { data } = await apiClient.get<PriceChangeResponse>(
    `/stocks/${symbol}/chart/price-change`,
    { params: { start_date, end_date } }
  );
  return data;
}

export async function fetchStatistics(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<PriceStatistics> {
  const { data } = await apiClient.get<PriceStatistics>(
    `/stocks/${symbol}/statistics`,
    { params: { start_date, end_date } }
  );
  return normalizePriceStatistics(data);
}

export async function fetchMultipleStocks(
  symbols: string,
  start_date: string,
  end_date: string
): Promise<MultiStockResponse> {
  const { data } = await apiClient.get<MultiStockResponse>(
    '/stocks/compare/multiple',
    { params: { symbols, start_date, end_date } }
  );
  return data;
}

/** openapi: GET /stocks/{symbol}/institutional-trades */
export async function fetchInstitutionalTrades(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<InstitutionalTradeListApiResponse> {
  const { data } = await apiClient.get<InstitutionalTradeListApiResponse>(
    `/stocks/${symbol}/institutional-trades`,
    { params: { start_date, end_date } }
  );
  return data;
}

/** openapi: GET /stocks/{symbol}/volume-with-chips */
export async function fetchVolumeWithChips(
  symbol: string,
  start_date: string,
  end_date: string,
): Promise<ChipsVolumeChartResponse> {
  const { data } = await apiClient.get<ChipsVolumeChartResponse>(
    `/stocks/${symbol}/volume-with-chips`,
    { params: { start_date, end_date } },
  );
  return data;
}

/** openapi: GET /stocks/{symbol}/integrated-chart */
export async function fetchIntegratedChart(
  symbol: string,
  start_date: string,
  end_date: string,
): Promise<IntegratedChartResponse> {
  const { data } = await apiClient.get<IntegratedChartResponse>(
    `/stocks/${symbol}/integrated-chart`,
    { params: { start_date, end_date }, timeout: 60_000 },
  );
  return data;
}

/** openapi: GET /stocks/{symbol}/technical-indicators */
export async function fetchTechnicalIndicators(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<TechnicalIndicatorListApiResponse> {
  const { data } = await apiClient.get<TechnicalIndicatorListApiResponse>(
    `/stocks/${symbol}/technical-indicators`,
    { params: { start_date, end_date } }
  );
  return data;
}
