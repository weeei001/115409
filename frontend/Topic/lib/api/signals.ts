import apiClient from './client';
import type { SignalCheckResponse, SignalEvidenceResponse } from '../types/api';

export interface SignalCheckParams {
  /** 空字串＝股票清單裡的全部股票 */
  symbol: string;
  start: string;
  split: string;
  end: string;
  horizon: 5 | 20;
}

/** openapi: GET /admin/signal-check（管理員） */
export async function fetchSignalCheck(params: SignalCheckParams, signal?: AbortSignal): Promise<SignalCheckResponse> {
  const { symbol, ...rest } = params;
  const query = symbol.trim() ? { ...rest, symbol: symbol.trim() } : rest;
  return (await apiClient.get<SignalCheckResponse>('/admin/signal-check', { params: query, signal })).data;
}

export interface SignalEvidenceParams {
  symbol: string;
  as_of: string;
  horizon: 5 | 20;
}

/** openapi: GET /admin/signal-evidence（管理員） */
export async function fetchSignalEvidence(params: SignalEvidenceParams, signal?: AbortSignal): Promise<SignalEvidenceResponse> {
  return (await apiClient.get<SignalEvidenceResponse>('/admin/signal-evidence', {
    params: { ...params, symbol: params.symbol.trim() }, signal,
  })).data;
}
