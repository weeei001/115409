import ragClient from './ragClient';
import { ApiRequestError } from './client';

/** 與線上 /api/ask（stream=false）實際回應對齊；其餘欄位選填以利容錯 */
export interface RagAskResponse {
  answer?: string;
  detected_stocks?: string[];
  time_range?: unknown;
  sources?: unknown[];
  tokens?: { input?: number; output?: number; thinking?: unknown };
  duration_ms?: number;
  current_time?: string;
  [key: string]: unknown;
}

function isProxyMode(): boolean {
  const v = process.env.NEXT_PUBLIC_RAG_API_USE_PROXY;
  return v === 'true' || v === '1';
}

/** 同源代理時為 /api/rag-proxy/api/ask；否則為完整 URL */
export function getRagAskUrl(): string {
  if (isProxyMode()) {
    return '/api/rag-proxy/api/ask';
  }
  const base = (process.env.NEXT_PUBLIC_RAG_API_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return '';
  return `${base}/api/ask`;
}

/** 是否可呼叫 RAG（代理模式或已設定基底 URL） */
export function isRagConfigured(): boolean {
  return isProxyMode() || !!process.env.NEXT_PUBLIC_RAG_API_BASE_URL?.trim();
}

function extractAnswer(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return String(data);

  const o = data as Record<string, unknown>;
  const candidates = ['answer', 'text', 'response', 'content', 'message', 'raw_answer'];
  for (const key of candidates) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export interface RagAskParams {
  query: string;
  stock_id?: string | null;
}

/**
 * 財經新聞 RAG：POST /api/ask，非串流 JSON。
 */
export async function ragAsk(params: RagAskParams): Promise<{ text: string; raw: RagAskResponse }> {
  const url = getRagAskUrl();
  if (!url) {
    throw new ApiRequestError('未設定 RAG API：請設定 NEXT_PUBLIC_RAG_API_BASE_URL，或將 NEXT_PUBLIC_RAG_API_USE_PROXY 設為 true');
  }

  const body = {
    query: params.query,
    stock_id: params.stock_id ?? null,
    stream: false as const,
  };

  const { data } = await ragClient.post<RagAskResponse>(url, body);
  const text = extractAnswer(data).trim() || '（無回覆內容）';
  return { text, raw: typeof data === 'object' && data !== null ? data : {} };
}
