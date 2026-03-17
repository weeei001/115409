import apiClient from './client';
import type {
  DailyPriceResponse,
  HistoricalPriceList,
  CandlestickResponse,
  CandlestickWithMAResponse,
  VolumeAnalysisResponse,
  PriceChangeResponse,
  PriceStatistics,
  MultiStockResponse,
  DateRangeResponse,
} from '../types';

export async function fetchSymbols(): Promise<string[]> {
  const { data } = await apiClient.get<string[]>('/stocks/symbols');
  return data;
}

export async function fetchLatestPrice(symbol: string): Promise<DailyPriceResponse> {
  const { data } = await apiClient.get<DailyPriceResponse>(`/stocks/${symbol}/latest`);
  return data;
}

export async function fetchPriceByDate(symbol: string, date: string): Promise<DailyPriceResponse> {
  const { data } = await apiClient.get<DailyPriceResponse>(`/stocks/${symbol}/price/${date}`);
  return data;
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
  return data;
}

export async function fetchCandlestick(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<CandlestickResponse> {
  const { data } = await apiClient.get<CandlestickResponse>(`/stocks/${symbol}/candlestick`, {
    params: { start_date, end_date },
  });
  return data;
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

export async function fetchOHLC(
  symbol: string,
  start_date: string,
  end_date: string
): Promise<(string | number)[][]> {
  const { data } = await apiClient.get<(string | number)[][]>(
    `/stocks/${symbol}/chart/ohlc`,
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
  return data;
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
