import { API_BASE } from '../apiBase';
import { getToken } from '../auth/storage';
import type { AIBacktestResult, BacktestGroupKey, BacktestPreset } from '../types/api';
import apiClient, { ApiRequestError } from './client';
import { errorMessageFrom, parseSseEvent, streamLines } from './sse';

export interface AIBacktestParams {
  symbol: string;
  start: string;
  end: string;
  preset: BacktestPreset;
  initial_cash: number;
  /** false 只跑純規則組，不呼叫模型 */
  ai: boolean;
}

/** GET /admin/ai-backtest/stream 的 SSE 事件：openapi 沒有事件欄位，依後端 backtest/service.py 的 events()（決議 D5）；done 的 result 同 /result 的 AIBacktestResult */
export type AIBacktestEvent =
  | { type: 'init'; symbol: string; decisions: number; groups: BacktestGroupKey[]; llm_calls: number; cached: boolean }
  | { type: 'progress'; done: number; total: number; date: string }
  | { type: 'done'; result: AIBacktestResult }
  | { type: 'error'; message: string };

const query = (params: AIBacktestParams) => ({ ...params, symbol: params.symbol.trim(), ai: String(params.ai) });

/** openapi: GET /admin/ai-backtest/result（同一組條件已跑完的結果；沒有時 404，不呼叫模型） */
export async function fetchAIBacktestResult(params: AIBacktestParams, signal?: AbortSignal): Promise<AIBacktestResult> {
  return (await apiClient.get<AIBacktestResult>('/admin/ai-backtest/result', { params: query(params), signal })).data;
}

/**
 * GET /admin/ai-backtest/stream：一次判斷回報一次進度，最後回傳完整結果。
 * 用 fetch 讀串流而不是 EventSource：EventSource 帶不了登入標頭，斷線還會自動重連、重跑整段回測。
 */
export async function streamAIBacktest(
  params: AIBacktestParams,
  onEvent: (event: AIBacktestEvent) => void,
  signal?: AbortSignal,
): Promise<AIBacktestResult> {
  const token = getToken();
  const search = new URLSearchParams(query(params) as unknown as Record<string, string>);
  const res = await fetch(`${API_BASE}/admin/ai-backtest/stream?${search}`, {
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiRequestError(await errorMessageFrom(res), res.status);
  if (!res.body) throw new ApiRequestError('回測沒有回傳內容，請稍後重試。');
  for await (const line of streamLines(res.body)) {
    const event = parseSseEvent<AIBacktestEvent>(line);
    if (!event) continue;
    if (event.type === 'error') throw new ApiRequestError(event.message || '回測暫時無法完成，請稍後重試。');
    onEvent(event);
    if (event.type === 'done') return event.result;
  }
  throw new ApiRequestError('回測連線提前結束，沒有收到完整結果。');
}
