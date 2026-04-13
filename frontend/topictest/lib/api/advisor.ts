
import apiClient, { ApiRequestError } from './client';
import { getToken } from '../auth/storage';
import { pickDetailMessage } from './errorDetail';
import type {
  AdvisorAction,
  AdvisorPartialDataEvent,
  AdvisorReport,
  AdvisorStepKey,
  AdvisorStepStatus,
  AdvisorStepUpdate,
  AnalyzeFinalResponse,
  AnalyzeQuickInsightsResponse,
  AnalyzeRawInstitutionalResponse,
  AnalyzeReportResponse,
  AnalyzeResponse,
  AnalyzeSplitRequest,
} from '../types';

export interface FetchAdvisorReportParams {
  symbol: string;
}

export interface FetchAdvisorReportOptions {
  fallbackToMock?: boolean;
}

export interface AdvisorFetchProgress {
  pendingInstitutional: boolean;
  pendingQuick: boolean;
  pendingFinal: boolean;
}

export interface FetchAdvisorReportProgressiveOptions extends FetchAdvisorReportOptions {
  onPartial?: (report: AdvisorReport) => void;
  onProgress?: (progress: AdvisorFetchProgress) => void;
  onStepUpdate?: (step: AdvisorStepUpdate) => void;
  onPartialData?: (data: AdvisorPartialDataEvent) => void;
}

export interface MapAnalyzeOptions {
  technicalSignalLabel?: (index: number) => string;
}

const TIMEOUT_REPORT_MS = 120_000;
const STREAM_TIMEOUT_MS = 140_000;

type SseEventName = 'step_start' | 'step_done' | 'partial_data' | 'final_report' | 'error' | 'completed';

interface SseEnvelope {
  event: SseEventName;
  data: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toInstitutionalRows(v: unknown): AnalyzeRawInstitutionalResponse['institutional_data'] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      date: typeof item.date === 'string' ? item.date : '',
      foreign_net: typeof item.foreign_net === 'number' ? item.foreign_net : 0,
      trust_net: typeof item.trust_net === 'number' ? item.trust_net : 0,
      dealer_net: typeof item.dealer_net === 'number' ? item.dealer_net : 0,
      total_net: typeof item.total_net === 'number' ? item.total_net : 0,
    }))
    .filter((row) => row.date);
}

function resolveStreamUrl(): string {
  const base = String(apiClient.defaults.baseURL ?? '').trim();
  if (!base) return '/analyze/stream';
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/$/, '')}/analyze/stream`;
  }
  return `${base.replace(/\/$/, '')}/analyze/stream`;
}

function deriveProgressFromSteps(stepStatuses: Record<AdvisorStepKey, AdvisorStepStatus>): AdvisorFetchProgress {
  return {
    pendingInstitutional: !['done', 'error'].includes(stepStatuses.institutional),
    pendingQuick: !['done', 'error'].includes(stepStatuses.cross_check),
    pendingFinal: !['done', 'error'].includes(stepStatuses.final),
  };
}

function mapRecommendationToAction(
  sentiment: number | undefined,
  recommendationText: string | undefined
): AdvisorAction {
  if (typeof sentiment === 'number' && !Number.isNaN(sentiment)) {
    if (sentiment >= 0.25) return 'buy';
    if (sentiment <= -0.25) return 'sell';
  }
  const t = (recommendationText ?? '').toLowerCase();
  if (t.includes('sell') || t.includes('賣')) return 'sell';
  if (t.includes('buy') || t.includes('買')) return 'buy';
  return 'wait';
}

export function mapAnalyzeResponseToAdvisorReport(
  res: AnalyzeResponse,
  options?: MapAnalyzeOptions
): AdvisorReport {
  const symbol = (res.symbol ?? '').trim().toUpperCase() || '--';
  const dateEnd = res.date_end?.trim();
  const dateStart = res.date_start?.trim();
  const generated_at = dateEnd
    ? new Date(`${dateEnd}T12:00:00+08:00`).toISOString()
    : new Date().toISOString();

  const labelFn = options?.technicalSignalLabel ?? ((i: number) => `Signal ${i + 1}`);
  const technical_signals = (res.technical_highlights ?? []).map((text, i) => ({
    name: labelFn(i),
    interpretation: text,
  }));

  const rows = [...(res.institutional_data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.length ? rows[rows.length - 1] : null;

  const institutional_flow = latest
    ? {
        summary: `Latest institutional snapshot (${latest.date})`,
        items: [
          { name: 'Foreign', net_amount: latest.foreign_net ?? null, trend: null },
          { name: 'Trust', net_amount: latest.trust_net ?? null, trend: null },
          { name: 'Dealer', net_amount: latest.dealer_net ?? null, trend: null },
        ],
      }
    : {
        summary: 'No institutional data available',
        items: [],
      };

  const basis = (res.recommendation_basis ?? []).filter(Boolean);
  const reasoning =
    basis.length > 0 ? basis.map((line) => `• ${line}`).join('\n') : (res.recommendation ?? '').trim() || '--';

  const sources = (res.news_sources ?? []).map((n) => ({
    title: n.title,
    url: n.url ?? null,
    publisher: 'News',
    published_at: n.timestamp?.trim() || null,
    type: 'news',
    summary: n.summary?.trim() ? n.summary : null,
  }));

  const recRaw = (res.recommendation ?? '').trim();
  const recommendation_text = basis.length > 0 ? recRaw || undefined : undefined;

  return {
    symbol,
    generated_at,
    summary: res.summary ?? '',
    technical_signals,
    institutional_flow,
    recommendation: mapRecommendationToAction(res.sentiment_score, res.recommendation),
    reasoning,
    risk_notes: null,
    sources,
    date_start: dateStart,
    date_end: dateEnd,
    sentiment_score: res.sentiment_score,
    recommendation_text,
    score_breakdown: res.score_breakdown,
    institutional_rows: rows.length ? rows : undefined,
  };
}

export function mapSplitAnalyzeToAdvisorReport(
  final: AnalyzeFinalResponse | undefined,
  quick: AnalyzeQuickInsightsResponse | undefined,
  institutional: AnalyzeRawInstitutionalResponse | undefined
): AdvisorReport {
  const synthetic = {
    symbol: final?.symbol,
    date_start: final?.date_start ?? quick?.date_start ?? institutional?.date_start,
    date_end: final?.date_end ?? quick?.date_end ?? institutional?.date_end,
    summary: final?.summary,
    sentiment_score: final?.sentiment_score,
    recommendation: final?.recommendation,
    recommendation_basis: final?.recommendation_basis,
    score_breakdown: final?.score_breakdown,
    news_sources: final?.news_sources,
    technical_highlights: quick?.points ?? [],
    institutional_data: institutional?.institutional_data ?? [],
  } as AnalyzeResponse;

  return mapAnalyzeResponseToAdvisorReport(synthetic, {
    technicalSignalLabel: (i) => `Point ${i + 1}`,
  });
}

export function mapAnalyzeReportToAdvisorReport(report: AnalyzeReportResponse): AdvisorReport {
  const synthetic = {
    symbol: report.symbol,
    date_start: report.date_start,
    date_end: report.date_end,
    summary: report.summary,
    sentiment_score: report.sentiment_score,
    recommendation: report.recommendation,
    recommendation_basis: report.recommendation_basis,
    score_breakdown: report.score_breakdown,
    news_sources: report.news_sources,
    technical_highlights: report.quick_points ?? [],
    institutional_data: report.institutional_data ?? [],
  } as AnalyzeResponse;

  return mapAnalyzeResponseToAdvisorReport(synthetic, {
    technicalSignalLabel: (i) => `Point ${i + 1}`,
  });
}

function buildMockReport(symbol: string): AdvisorReport {
  const normalized = symbol.trim().toUpperCase();
  return {
    symbol: normalized,
    generated_at: new Date().toISOString(),
    summary: 'Mock advisor report (development fallback).',
    technical_signals: [
      { name: 'Signal 1', value: 'N/A', interpretation: 'Mock technical interpretation' },
    ],
    institutional_flow: {
      summary: 'Mock institutional summary',
      items: [],
    },
    recommendation: 'wait',
    reasoning: 'Mock reasoning',
    risk_notes: null,
    sources: [],
  };
}

async function fetchAdvisorReportFallbackReport(
  symbol: string,
  options: FetchAdvisorReportProgressiveOptions
): Promise<AdvisorReport> {
  const { fallbackToMock = process.env.NODE_ENV === 'development', onPartial, onProgress } = options;
  const upper = symbol.toUpperCase();
  const body: AnalyzeSplitRequest = { symbols: [upper] };

  onProgress?.({
    pendingInstitutional: true,
    pendingQuick: true,
    pendingFinal: true,
  });

  try {
    const response = await apiClient.post('/analyze/report', body, { timeout: TIMEOUT_REPORT_MS });
    const mapped = mapAnalyzeReportToAdvisorReport(response.data as AnalyzeReportResponse);
    onPartial?.(mapped);
    onProgress?.({
      pendingInstitutional: false,
      pendingQuick: false,
      pendingFinal: false,
    });
    return mapped;
  } catch (error) {
    onProgress?.({
      pendingInstitutional: false,
      pendingQuick: false,
      pendingFinal: false,
    });
    if (fallbackToMock) return buildMockReport(symbol);
    throw error;
  }
}

function parseSseBlock(block: string): SseEnvelope | null {
  const trimmed = block.trim();
  if (!trimmed) return null;

  let event: SseEventName = 'partial_data';
  const dataLines: string[] = [];
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() as SseEventName;
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;

  try {
    const data = JSON.parse(dataLines.join('\n'));
    if (!isRecord(data)) return null;
    return { event, data };
  } catch {
    return null;
  }
}

async function readSseResponse(
  response: Response,
  onEvent: (event: SseEnvelope) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiRequestError('Streaming response body is not readable');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const parsed = parseSseBlock(chunk);
      if (parsed) onEvent(parsed);
    }
  }

  const tail = parseSseBlock(buffer);
  if (tail) onEvent(tail);
}

async function fetchAdvisorReportViaStream(
  symbol: string,
  options: FetchAdvisorReportProgressiveOptions
): Promise<AdvisorReport> {
  const { onPartial, onProgress, onStepUpdate, onPartialData } = options;
  const upper = symbol.toUpperCase();
  const body: AnalyzeSplitRequest = { symbols: [upper] };

  let partialFinal: AnalyzeFinalResponse | undefined;
  let partialQuick: AnalyzeQuickInsightsResponse | undefined;
  let partialInstitutional: AnalyzeRawInstitutionalResponse | undefined;
  let streamCompleted = false;
  let finalOk = true;

  const stepStatuses: Record<AdvisorStepKey, AdvisorStepStatus> = {
    institutional: 'pending',
    news: 'pending',
    cross_check: 'pending',
    final: 'pending',
  };

  const emitProgress = () => {
    onProgress?.(deriveProgressFromSteps(stepStatuses));
  };
  const emitPartial = () => {
    onPartial?.(mapSplitAnalyzeToAdvisorReport(partialFinal, partialQuick, partialInstitutional));
  };
  const setStep = (next: AdvisorStepUpdate) => {
    stepStatuses[next.step_key] = next.status;
    onStepUpdate?.(next);
    emitProgress();
  };

  emitProgress();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  try {
    const token = getToken();
    const response = await fetch(resolveStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `Streaming request failed (${response.status})`;
      try {
        const data = await response.json();
        if (isRecord(data)) {
          message = pickDetailMessage(data, response.status);
        }
      } catch {
        // ignore parse errors
      }
      throw new ApiRequestError(message, response.status);
    }

    await readSseResponse(response, ({ event, data }) => {
      if (event === 'step_start' || event === 'step_done') {
        const stepKey = data.step_key;
        if (typeof stepKey === 'string' && ['institutional', 'news', 'cross_check', 'final'].includes(stepKey)) {
          const stepStatusRaw = data.status;
          const status: AdvisorStepStatus =
            stepStatusRaw === 'running' || stepStatusRaw === 'done' || stepStatusRaw === 'error'
              ? stepStatusRaw
              : event === 'step_start'
                ? 'running'
                : 'done';
          setStep({
            request_id: String(data.request_id ?? ''),
            step_key: stepKey as AdvisorStepKey,
            step_label: typeof data.step_label === 'string' ? data.step_label : undefined,
            status,
            message: typeof data.message === 'string' ? data.message : undefined,
          });
        }
        return;
      }

      if (event === 'error') {
        const stepKey = data.step_key;
        if (typeof stepKey === 'string' && ['institutional', 'news', 'cross_check', 'final'].includes(stepKey)) {
          setStep({
            request_id: String(data.request_id ?? ''),
            step_key: stepKey as AdvisorStepKey,
            status: 'error',
            message: typeof data.message === 'string' ? data.message : 'Step failed',
          });
        }
        return;
      }

      if (event === 'partial_data') {
        const stepKey = data.step_key;
        const dataset = data.dataset;
        if (
          typeof stepKey === 'string' &&
          typeof dataset === 'string' &&
          ['institutional', 'news', 'cross_check', 'final'].includes(stepKey)
        ) {
          const payload: AdvisorPartialDataEvent = {
            request_id: String(data.request_id ?? ''),
            step_key: stepKey as AdvisorStepKey,
            dataset: dataset as AdvisorPartialDataEvent['dataset'],
            summary: isRecord(data.summary) ? data.summary : undefined,
            preview: Array.isArray(data.preview)
              ? data.preview.filter((x): x is Record<string, unknown> => isRecord(x))
              : undefined,
          };
          onPartialData?.(payload);

          if (payload.dataset === 'institutional') {
            partialInstitutional = {
              status: 'institutional_ready',
              symbol: upper,
              date_start: String(payload.summary?.date_start ?? ''),
              date_end: String(payload.summary?.date_end ?? ''),
              institutional_data: toInstitutionalRows(payload.preview ?? []),
            };
            emitPartial();
          }

          if (payload.dataset === 'quick_insights') {
            const pointsRaw = payload.summary?.points;
            const points = Array.isArray(pointsRaw) ? pointsRaw.map((x) => String(x)).filter(Boolean) : [];
            partialQuick = {
              symbol: upper,
              date_start: partialFinal?.date_start,
              date_end: partialFinal?.date_end,
              points,
              fallback_mode: Boolean(payload.summary?.fallback_mode),
            };
            emitPartial();
          }
        }
        return;
      }

      if (event === 'final_report') {
        const reportRaw = data.report;
        if (isRecord(reportRaw)) {
          partialFinal = reportRaw as AnalyzeFinalResponse;
        }
        const quickRaw = data.quick_insights;
        if (isRecord(quickRaw)) {
          partialQuick = quickRaw as AnalyzeQuickInsightsResponse;
        }
        const instRaw = data.institutional;
        if (isRecord(instRaw)) {
          partialInstitutional = {
            status: 'institutional_ready',
            symbol:
              typeof instRaw.symbol === 'string' && instRaw.symbol.trim()
                ? instRaw.symbol
                : upper,
            date_start: typeof instRaw.date_start === 'string' ? instRaw.date_start : '',
            date_end: typeof instRaw.date_end === 'string' ? instRaw.date_end : '',
            institutional_data: toInstitutionalRows(instRaw.institutional_data),
          };
        }
        emitPartial();
        return;
      }

      if (event === 'completed') {
        streamCompleted = true;
        finalOk = data.ok !== false;
      }
    });
  } finally {
    clearTimeout(timer);
  }

  if (!streamCompleted || !finalOk || !partialFinal) {
    throw new ApiRequestError('Streaming completed without a final report');
  }
  return mapSplitAnalyzeToAdvisorReport(partialFinal, partialQuick, partialInstitutional);
}

export async function fetchAdvisorReportProgressive(
  params: FetchAdvisorReportParams,
  options: FetchAdvisorReportProgressiveOptions = {}
): Promise<AdvisorReport> {
  const symbol = params.symbol.trim();
  if (!symbol) {
    throw new ApiRequestError('Please provide a stock symbol');
  }

  try {
    return await fetchAdvisorReportViaStream(symbol, options);
  } catch (streamError) {
    console.warn('[advisor] stream path failed, fallback to /analyze/report', streamError);
    return fetchAdvisorReportFallbackReport(symbol, options);
  }
}

export async function fetchAdvisorReport(
  params: FetchAdvisorReportParams,
  options: FetchAdvisorReportOptions = {}
): Promise<AdvisorReport> {
  return fetchAdvisorReportProgressive(params, options);
}
