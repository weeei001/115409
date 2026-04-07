import apiClient, { ApiRequestError } from './client';
import type {
  AdvisorAction,
  AdvisorReport,
  AnalyzeFinalResponse,
  AnalyzeQuickInsightsResponse,
  AnalyzeRawInstitutionalResponse,
  AnalyzeResponse,
  AnalyzeSplitRequest,
} from '../types';

export interface FetchAdvisorReportParams {
  symbol: string;
}

export interface FetchAdvisorReportOptions {
  fallbackToMock?: boolean;
}

/** 各區塊是否仍在等待 API 回應（完成或失敗後為 false） */
export interface AdvisorFetchProgress {
  pendingInstitutional: boolean;
  pendingQuick: boolean;
  pendingFinal: boolean;
}

export interface FetchAdvisorReportProgressiveOptions extends FetchAdvisorReportOptions {
  onPartial?: (report: AdvisorReport) => void;
  onProgress?: (progress: AdvisorFetchProgress) => void;
}

export interface MapAnalyzeOptions {
  /** 預設「技術面重點 n」；拆分 API 用「觀察 n」 */
  technicalSignalLabel?: (index: number) => string;
}

const TIMEOUT_RAW_MS = 45_000;
const TIMEOUT_QUICK_MS = 90_000;
const TIMEOUT_FINAL_MS = 120_000;

function mapRecommendationToAction(
  sentiment: number | undefined,
  recommendationText: string | undefined
): AdvisorAction {
  if (typeof sentiment === 'number' && !Number.isNaN(sentiment)) {
    if (sentiment >= 0.25) return 'buy';
    if (sentiment <= -0.25) return 'sell';
  }
  const t = (recommendationText ?? '').trim();
  if (/賣出|放空|減碼/.test(t)) return 'sell';
  if (/買進|做多|加碼/.test(t)) return 'buy';
  if (/觀望|中性|區間/.test(t)) return 'wait';
  return 'wait';
}

export function mapAnalyzeResponseToAdvisorReport(
  res: AnalyzeResponse,
  options?: MapAnalyzeOptions
): AdvisorReport {
  const symbol = (res.symbol ?? '').trim().toUpperCase() || '—';
  const dateEnd = res.date_end?.trim();
  const dateStart = res.date_start?.trim();
  const generated_at = dateEnd
    ? new Date(`${dateEnd}T12:00:00+08:00`).toISOString()
    : new Date().toISOString();

  const labelFn = options?.technicalSignalLabel ?? ((i: number) => `技術面重點 ${i + 1}`);
  const technical_signals = (res.technical_highlights ?? []).map((text, i) => ({
    name: labelFn(i),
    interpretation: text,
  }));

  const rows = [...(res.institutional_data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.length ? rows[rows.length - 1] : null;

  const institutional_flow = latest
    ? {
        summary: (() => {
          let s = `以下為最新交易日（${latest.date}）三大法人買賣超；資料區間為 ${dateStart ?? '—'} 至 ${dateEnd ?? '—'}。`;
          if (typeof latest.total_net === 'number') {
            s += ` 合計淨買賣：${latest.total_net.toLocaleString('zh-TW')} 股。`;
          }
          return s;
        })(),
        items: [
          { name: '外資', net_amount: latest.foreign_net ?? null, trend: null },
          { name: '投信', net_amount: latest.trust_net ?? null, trend: null },
          { name: '自營商', net_amount: latest.dealer_net ?? null, trend: null },
        ],
      }
    : {
        summary: '暫無法人交易日資料。',
        items: [],
      };

  const basis = (res.recommendation_basis ?? []).filter(Boolean);
  const reasoning =
    basis.length > 0 ? basis.map((line) => `• ${line}`).join('\n') : (res.recommendation ?? '').trim() || '—';

  const sources = (res.news_sources ?? []).map((n) => ({
    title: n.title,
    url: n.url ?? null,
    publisher: '新聞',
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
    institutional_rows: rows.length ? rows : undefined,
  };
}

/**
 * 合併 POST /analyze/final、/analyze/quick-insights、/analyze/raw/institutional 為單一 AdvisorReport。
 */
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
    news_sources: final?.news_sources,
    technical_highlights: quick?.points ?? [],
    institutional_data: institutional?.institutional_data ?? [],
  } as AnalyzeResponse;

  return mapAnalyzeResponseToAdvisorReport(synthetic, {
    technicalSignalLabel: (i) => `觀察 ${i + 1}`,
  });
}

function buildMockReport(symbol: string): AdvisorReport {
  const normalized = symbol.trim().toUpperCase();
  return {
    symbol: normalized,
    generated_at: new Date().toISOString(),
    summary:
      '近期新聞偏中性偏多，股價短線震盪但量能未明顯失控。法人動向以區間調節為主，整體仍需搭配風險控管。',
    technical_signals: [
      {
        name: 'MA20/MA60',
        value: 'MA20 > MA60',
        interpretation: '短中期均線維持多頭排列，趨勢尚未破壞。',
      },
      {
        name: 'RSI(14)',
        value: 57.2,
        interpretation: '位於中性偏強區間，尚未進入過熱區。',
      },
      {
        name: 'MACD',
        value: 'DIF > DEA',
        interpretation: '動能略偏多，但柱狀體收斂，追價需謹慎。',
      },
    ],
    institutional_flow: {
      summary: '三大法人近 5 日合計小幅買超，但未形成明確連續性趨勢。',
      items: [
        { name: '外資', net_amount: 1250000000, trend: '近 3 日轉為買超' },
        { name: '投信', net_amount: 380000000, trend: '維持小幅買超' },
        { name: '自營商', net_amount: -120000000, trend: '偏向短線調節' },
      ],
    },
    recommendation: 'wait',
    reasoning:
      '綜合新聞情緒、法人籌碼與技術面，短線雖有轉強跡象，但訊號一致性不足。建議等待突破關鍵壓力且量能放大後再評估進場。',
    risk_notes:
      '若跌破近期支撐並伴隨放量，應優先執行停損；若受國際市場波動影響，波動率可能擴大。',
    sources: [
      {
        title: '證交所每日交易資訊',
        url: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
        publisher: '臺灣證券交易所',
        type: 'official',
        published_at: null,
      },
      {
        title: '近期財經新聞彙整（示意）',
        url: null,
        publisher: 'RAG Aggregator',
        type: 'news',
        published_at: new Date().toISOString(),
      },
    ],
  };
}

/**
 * 並行呼叫拆分 API；任一回應就合併並觸發 `onPartial`，全部結束後回傳與舊版 `fetchAdvisorReport` 相同語意之結果。
 */
export async function fetchAdvisorReportProgressive(
  params: FetchAdvisorReportParams,
  options: FetchAdvisorReportProgressiveOptions = {}
): Promise<AdvisorReport> {
  const symbol = params.symbol.trim();
  if (!symbol) {
    throw new ApiRequestError('請輸入股票代號');
  }

  const { fallbackToMock = process.env.NODE_ENV === 'development', onPartial, onProgress } = options;
  const upper = symbol.toUpperCase();
  const body: AnalyzeSplitRequest = { symbols: [upper] };

  let partialFinal: AnalyzeFinalResponse | undefined;
  let partialQuick: AnalyzeQuickInsightsResponse | undefined;
  let partialInstitutional: AnalyzeRawInstitutionalResponse | undefined;
  let finalRequestError: unknown;

  let pendingInstitutional = true;
  let pendingQuick = true;
  let pendingFinal = true;

  const emitProgress = () => {
    onProgress?.({
      pendingInstitutional,
      pendingQuick,
      pendingFinal,
    });
  };

  const emitPartial = () => {
    const report = mapSplitAnalyzeToAdvisorReport(partialFinal, partialQuick, partialInstitutional);
    onPartial?.(report);
  };

  emitProgress();

  const runInstitutional = apiClient
    .post('/analyze/raw/institutional', body, { timeout: TIMEOUT_RAW_MS })
    .then((res) => {
      partialInstitutional = res.data as AnalyzeRawInstitutionalResponse;
    })
    .catch(() => {
      /* 略過，合併時以空陣列處理 */
    })
    .finally(() => {
      pendingInstitutional = false;
      emitPartial();
      emitProgress();
    });

  const runQuick = apiClient
    .post('/analyze/quick-insights', body, { timeout: TIMEOUT_QUICK_MS })
    .then((res) => {
      partialQuick = res.data as AnalyzeQuickInsightsResponse;
    })
    .catch(() => {})
    .finally(() => {
      pendingQuick = false;
      emitPartial();
      emitProgress();
    });

  const runFinal = apiClient
    .post('/analyze/final', body, { timeout: TIMEOUT_FINAL_MS })
    .then((res) => {
      partialFinal = res.data as AnalyzeFinalResponse;
    })
    .catch((err) => {
      finalRequestError = err;
    })
    .finally(() => {
      pendingFinal = false;
      emitPartial();
      emitProgress();
    });

  const runPrices = apiClient
    .post('/analyze/raw/prices', body, { timeout: TIMEOUT_RAW_MS })
    .catch(() => undefined);

  const runIndicators = apiClient
    .post('/analyze/raw/indicators', body, { timeout: TIMEOUT_RAW_MS })
    .catch(() => undefined);

  try {
    await Promise.all([runInstitutional, runQuick, runFinal, runPrices, runIndicators]);

    if (!partialFinal) {
      if (fallbackToMock) {
        return buildMockReport(symbol);
      }
      if (finalRequestError instanceof Error) {
        throw finalRequestError;
      }
      throw new ApiRequestError('分析失敗');
    }

    return mapSplitAnalyzeToAdvisorReport(partialFinal, partialQuick, partialInstitutional);
  } catch (error) {
    if (fallbackToMock) {
      return buildMockReport(symbol);
    }
    throw error;
  }
}

export async function fetchAdvisorReport(
  params: FetchAdvisorReportParams,
  options: FetchAdvisorReportOptions = {}
): Promise<AdvisorReport> {
  return fetchAdvisorReportProgressive(params, options);
}
