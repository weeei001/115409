import apiClient, { ApiRequestError } from './client';
import { getToken } from '../auth/storage';
import type {
  AdvisorAction,
  AdvisorPartialDataEvent,
  AdvisorReport,
  AdvisorSource,
  AdvisorStepUpdate,
} from '../types';
import type {
  AdvisorBacktestSnapshot,
  AdvisorFullReport,
  AdvisorOverviewRequest,
  AdvisorOverviewResponse,
  AdvisorStreamEvent,
  AdvisorStreamEventName,
} from '../types/advisorV2';
import type { CoreModePriceChart } from '../types/coreMode';

const STREAM_TIMEOUT_MS = 180_000;

export interface AdvisorFetchProgress {
  pendingInstitutional: boolean;
  pendingFinal: boolean;
}

export interface AdvisorBacktestView {
  price_chart: CoreModePriceChart | null;
  overall: {
    sample_count: number | null;
    accuracy: number | null;
    f1_buy: number | null;
    precision_buy: number | null;
    recall_buy: number | null;
    tp: number | null;
    fp: number | null;
    fn: number | null;
    tn: number | null;
  };
}

interface AdvisorProgressiveCallbacks {
  onPartial?: (report: AdvisorReport) => void;
  onProgress?: (progress: AdvisorFetchProgress) => void;
  onStepUpdate?: (update: AdvisorStepUpdate) => void;
  onPartialData?: (payload: AdvisorPartialDataEvent) => void;
  onBacktest?: (payload: AdvisorBacktestView) => void;
}

interface SseEnvelope {
  event: AdvisorStreamEventName;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function toSignalValue(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function normalizeRecommendation(trendConclusion: string): AdvisorAction {
  const token = trendConclusion.toLowerCase();
  if (token.includes('偏多') || token.includes('buy')) return 'buy';
  if (token.includes('偏空') || token.includes('sell')) return 'sell';
  return 'wait';
}

function resolveAdvisorStreamUrl(requestId: string): string {
  const base = String(apiClient.defaults.baseURL ?? '').trim().replace(/\/$/, '');
  if (!base) return `/advisor/${encodeURIComponent(requestId)}/stream`;
  return `${base}/advisor/${encodeURIComponent(requestId)}/stream`;
}

function parseSseChunk(raw: string): SseEnvelope | null {
  const chunk = raw.trim();
  if (!chunk) return null;

  let eventName: AdvisorStreamEventName = 'keepalive';
  const dataLines: string[] = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() as AdvisorStreamEventName;
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!dataLines.length) return null;
  try {
    const parsed = JSON.parse(dataLines.join('\n'));
    if (!isRecord(parsed)) return null;
    return { event: eventName, data: parsed };
  } catch {
    return null;
  }
}

async function readSse(response: Response, onEvent: (event: AdvisorStreamEvent) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiRequestError('SSE 連線無資料流');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const parsed = parseSseChunk(chunk);
      if (parsed) onEvent(parsed);
    }
  }
  const last = parseSseChunk(buffer);
  if (last) onEvent(last);
}

function mapOverviewToReport(overview: AdvisorOverviewResponse): AdvisorReport {
  const trend = toStringValue(overview.trend_conclusion) ?? '尚無結論';
  const confidence = toStringValue(overview.confidence_level) ?? '未提供';
  const reasoning = (overview.reason_points ?? []).filter(Boolean).join('\n');
  const summary = (overview.rule_summary ?? []).join(' ');

  return {
    symbol: overview.symbol,
    generated_at: new Date().toISOString(),
    summary: summary || `${overview.symbol} 核心判斷為「${trend}」，信心等級 ${confidence}。`,
    technical_signals: [
      {
        name: '趨勢結論',
        value: trend,
        interpretation: `信心等級：${confidence}`,
      },
      ...(overview.condition_checks ?? []).slice(0, 5).map((item) => ({
        name: item.label ?? item.key ?? '條件檢查',
        value: toSignalValue(item.value),
        interpretation: item.passed ? '條件通過' : '條件未通過',
      })),
    ],
    institutional_flow: {
      summary: '依據最新法人快照整理',
      items: [
        { name: '外資', net_amount: toNumber(overview.institutional_snapshot?.foreign_net) },
        { name: '投信', net_amount: toNumber(overview.institutional_snapshot?.trust_net) },
        { name: '自營商', net_amount: toNumber(overview.institutional_snapshot?.dealer_net) },
        { name: '三大法人合計', net_amount: toNumber(overview.institutional_snapshot?.total_net) },
      ],
    },
    recommendation: normalizeRecommendation(trend),
    recommendation_text: `核心判斷：${trend}（信心 ${confidence}）`,
    reasoning: reasoning || summary || '尚無補充說明',
    risk_notes: null,
    sources: [],
    date_start: undefined,
    date_end: overview.as_of_date,
    sentiment_score: undefined,
    score_breakdown: undefined,
    institutional_rows: undefined,
  };
}

function toBacktestView(snapshot: AdvisorBacktestSnapshot | null, fallbackPriceChart?: CoreModePriceChart): AdvisorBacktestView {
  const credibility = snapshot?.credibility_summary;
  return {
    price_chart: snapshot?.price_chart ?? fallbackPriceChart ?? null,
    overall: {
      sample_count: null,
      accuracy: credibility?.ac ?? null,
      f1_buy: null,
      precision_buy: null,
      recall_buy: null,
      tp: null,
      fp: null,
      fn: null,
      tn: null,
    },
  };
}

function emitBootstrapPartialData(
  overview: AdvisorOverviewResponse,
  onPartialData?: (payload: AdvisorPartialDataEvent) => void
): void {
  if (!onPartialData) return;
  const requestId = overview.request_id;

  const institutionalPreview = (overview.institutional_history ?? []).slice(-30).map((row) => ({
    date: toStringValue(row.date) ?? overview.as_of_date,
    foreign_net: toNumber(row.foreign_net),
    trust_net: toNumber(row.trust_net),
    dealer_net: toNumber(row.dealer_net),
    total_net: toNumber(row.total_net),
  }));
  const latestInstitutional = institutionalPreview[institutionalPreview.length - 1];
  onPartialData({
    request_id: requestId,
    step_key: 'institutional',
    dataset: 'institutional',
    summary: {
      rows: institutionalPreview.length,
      latest_date: latestInstitutional?.date ?? overview.as_of_date,
      latest_total_net: latestInstitutional?.total_net ?? null,
    },
    preview: institutionalPreview,
  });

  const indicatorsPreview = (overview.technical_history ?? []).slice(-30).map((row) => ({
    date: toStringValue(row.date) ?? overview.as_of_date,
    ma5: toNumber(row.ma5),
    ma20: toNumber(row.ma20),
    rsi14: toNumber(row.rsi14),
    macd_hist: toNumber(row.macd_hist),
  }));
  const latestIndicator = indicatorsPreview[indicatorsPreview.length - 1];
  onPartialData({
    request_id: requestId,
    step_key: 'cross_check',
    dataset: 'indicators',
    summary: {
      rows: indicatorsPreview.length,
      latest_date: latestIndicator?.date ?? overview.as_of_date,
      latest_rsi14: latestIndicator?.rsi14 ?? null,
      latest_macd_hist: latestIndicator?.macd_hist ?? null,
    },
    preview: indicatorsPreview,
  });

  const candles = overview.price_chart?.candles ?? [];
  if (!candles.length) return;
  const volumeMap = new Map((overview.price_chart?.volume ?? []).map((v) => [v.time, v.value]));
  const preview = candles.slice(-30).map((candle, index, arr) => {
    const prev = index > 0 ? arr[index - 1] : null;
    const change = prev ? Number((candle.close - prev.close).toFixed(2)) : null;
    return {
      date: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      change,
      volume: volumeMap.get(candle.time) ?? null,
    };
  });
  const last = preview[preview.length - 1];
  onPartialData({
    request_id: requestId,
    step_key: 'cross_check',
    dataset: 'prices',
    summary: {
      rows: preview.length,
      latest_date: last?.date ?? overview.as_of_date,
      latest_close: last?.close ?? null,
      latest_change: last?.change ?? null,
    },
    preview,
  });
}

function parseFullReportSource(item: unknown): AdvisorSource | null {
  if (!isRecord(item)) return null;
  const title = toStringValue(item.title);
  if (!title) return null;
  return {
    title,
    url: toStringValue(item.url),
    publisher: null,
    published_at: null,
    type: null,
    summary: toStringValue(item.summary),
  };
}

function mergeFullReport(base: AdvisorReport, payload: AdvisorFullReport): AdvisorReport {
  const reasonLines = (payload.recommendation_basis ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0);
  const riskLines = (payload.risk_points ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0);

  return {
    ...base,
    generated_at: new Date().toISOString(),
    summary: toStringValue(payload.final_summary) ?? base.summary,
    recommendation: normalizeRecommendation(payload.trend_conclusion),
    recommendation_text: `核心判斷：${payload.trend_conclusion}（信心 ${payload.confidence_level}）`,
    reasoning: reasonLines.join('\n') || base.reasoning,
    risk_notes: riskLines.length ? riskLines.join('；') : base.risk_notes,
    date_end: toStringValue(payload.as_of_date) ?? base.date_end,
    sources: (payload.source_highlights ?? [])
      .map(parseFullReportSource)
      .filter((item): item is AdvisorSource => Boolean(item)),
  };
}

export async function fetchAdvisorOverview(req: AdvisorOverviewRequest): Promise<AdvisorOverviewResponse> {
  const symbol = req.symbol.trim().toUpperCase();
  if (!symbol) throw new ApiRequestError('請輸入股票代號');

  const payload: AdvisorOverviewRequest = {
    use_active_preset: true,
    window_spec: '1y',
    validation_mode: 'rolling_walk_forward',
    ...req,
    symbol,
  };
  const { data } = await apiClient.post<AdvisorOverviewResponse>('/advisor/overview', payload, {
    timeout: 12_000,
  });
  return data;
}

export async function streamAdvisorUpdates(
  requestId: string,
  onEvent: (event: AdvisorStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', forwardAbort);
  }

  try {
    const response = await fetch(resolveAdvisorStreamUrl(requestId), {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiRequestError(`Advisor 串流請求失敗 (${response.status})`, response.status);
    }
    await readSse(response, onEvent);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchAdvisorReportProgressive(
  req: { symbol: string },
  callbacks: AdvisorProgressiveCallbacks = {}
): Promise<AdvisorReport> {
  let progress: AdvisorFetchProgress = {
    pendingInstitutional: true,
    pendingFinal: true,
  };
  callbacks.onProgress?.(progress);
  callbacks.onStepUpdate?.({
    request_id: '',
    step_key: 'institutional',
    status: 'running',
    message: '載入首屏核心資料',
  });

  const overview = await fetchAdvisorOverview({ symbol: req.symbol });
  const requestId = overview.request_id;
  let currentReport = mapOverviewToReport(overview);
  callbacks.onPartial?.(currentReport);

  emitBootstrapPartialData(overview, callbacks.onPartialData);
  callbacks.onBacktest?.(toBacktestView(null, overview.price_chart));

  progress = { ...progress, pendingInstitutional: false };
  callbacks.onProgress?.(progress);
  callbacks.onStepUpdate?.({
    request_id: requestId,
    step_key: 'institutional',
    status: 'done',
    message: '首屏資料已就緒',
  });
  callbacks.onStepUpdate?.({
    request_id: requestId,
    step_key: 'cross_check',
    status: 'done',
    message: '技術與籌碼快照已就緒',
  });
  callbacks.onStepUpdate?.({
    request_id: requestId,
    step_key: 'news',
    status: 'running',
    message: '背景整理新聞脈絡中',
  });
  callbacks.onStepUpdate?.({
    request_id: requestId,
    step_key: 'final',
    status: 'running',
    message: '背景生成完整報告中',
  });

  let streamFailed: string | null = null;
  await streamAdvisorUpdates(requestId, (event) => {
    if (event.event === 'keepalive') return;

    if (event.event === 'core_backtest_ready') {
      const snapshot = isRecord(event.data.snapshot) ? (event.data.snapshot as unknown as AdvisorBacktestSnapshot) : null;
      callbacks.onBacktest?.(toBacktestView(snapshot, overview.price_chart));
      return;
    }

    if (event.event === 'news_ready') {
      const news = isRecord(event.data.news) ? event.data.news : null;
      const preview = Array.isArray(news?.preview) ? news?.preview : [];
      if (preview.length) {
        currentReport = {
          ...currentReport,
          sources: preview.map(parseFullReportSource).filter((item): item is AdvisorSource => Boolean(item)),
        };
        callbacks.onPartial?.(currentReport);
      }
      callbacks.onStepUpdate?.({
        request_id: requestId,
        step_key: 'news',
        status: 'done',
        message: '新聞脈絡已就緒',
      });
      return;
    }

    if (event.event === 'advisor_full_report_ready') {
      const full = isRecord(event.data.full_report) ? (event.data.full_report as unknown as AdvisorFullReport) : null;
      if (full) {
        currentReport = mergeFullReport(currentReport, full);
        callbacks.onPartial?.(currentReport);
      }
      progress = { ...progress, pendingFinal: false };
      callbacks.onProgress?.(progress);
      callbacks.onStepUpdate?.({
        request_id: requestId,
        step_key: 'final',
        status: 'done',
        message: '完整報告已完成',
      });
      return;
    }

    if (event.event === 'failed') {
      streamFailed = toStringValue(event.data.message) ?? 'Advisor 背景流程失敗';
      callbacks.onStepUpdate?.({
        request_id: requestId,
        step_key: 'final',
        status: 'error',
        message: streamFailed,
      });
    }
  });

  if (streamFailed) throw new ApiRequestError(streamFailed);
  return currentReport;
}
