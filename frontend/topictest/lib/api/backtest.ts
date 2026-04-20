import apiClient from './client';
import type { BacktestRunRequest, BacktestRunResult } from '../types';

export async function runBacktest(req: BacktestRunRequest): Promise<BacktestRunResult> {
  const { data } = await apiClient.post<BacktestRunResult>('/backtest/run', req, {
    timeout: 180000,
  });
  return data;
}

export async function getBacktestResult(runId: string): Promise<BacktestRunResult> {
  const { data } = await apiClient.get<BacktestRunResult>(`/backtest/${encodeURIComponent(runId)}`);
  return data;
}
