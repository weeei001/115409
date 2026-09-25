import apiClient from './client';

export interface BenchmarkHistoryResponse {
  id: 'TAIEX';
  name: string;
  basis: 'price_index_excluding_dividends';
  source: 'TWSE';
  source_url: string;
  start_date: string;
  end_date: string;
  total: number;
  data: Array<{ date: string; close: number }>;
}

export async function fetchBenchmarkHistory(startDate: string, endDate: string): Promise<BenchmarkHistoryResponse> {
  const { data } = await apiClient.get<BenchmarkHistoryResponse>('/stocks/benchmark/history', {
    params: { start_date: startDate, end_date: endDate },
  });
  return data;
}
