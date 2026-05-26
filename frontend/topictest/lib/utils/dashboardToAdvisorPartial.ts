import type { AdvisorPartialDataEvent, AdvisorReport } from '../types';
import type { UseStockDashboardResult } from '../hooks/useStockDashboard';
import type { InstitutionalDayRow, TechnicalIndicatorDayRow } from '../types/stockDashboard';
import { DEFAULT_STOCK_BEHAVIOR_LOOKBACK_DAYS } from '../types/stockBehavior';
import { resolveAsOfDateRange } from './stockBehaviorMappers';

type DisplayDataset = 'institutional' | 'prices' | 'indicators';

const PREVIEW_LIMIT = 8;

function buildInstitutionalPreview(rows: InstitutionalDayRow[]): Record<string, unknown>[] {
  return rows.slice(-PREVIEW_LIMIT).map((row) => ({
    date: row.date,
    foreign_net: row.foreign_excl_dealer_net,
    trust_net: row.investment_trust_net,
    dealer_net: row.dealer_net_total,
    total_net: row.total_net,
  }));
}

function buildIndicatorPreview(rows: TechnicalIndicatorDayRow[]): Record<string, unknown>[] {
  return rows.slice(-PREVIEW_LIMIT).map((row) => ({
    date: row.date,
    ma5: row.ma5,
    ma20: row.ma20,
    rsi10: row.rsi10,
    macd_hist: row.macd_hist,
  }));
}

function buildPricePreview(
  dashboard: Pick<UseStockDashboardResult, 'priceChart' | 'endDate'>
): Record<string, unknown>[] {
  const candles = dashboard.priceChart?.candles ?? [];
  const volume = dashboard.priceChart?.volume ?? [];
  const slice = candles.slice(-PREVIEW_LIMIT);
  return slice.map((candle, index) => {
    const globalIndex = candles.length - slice.length + index;
    const prevClose = globalIndex > 0 ? candles[globalIndex - 1]?.close : null;
    const change =
      prevClose !== null && Number.isFinite(prevClose)
        ? Number((candle.close - prevClose).toFixed(2))
        : null;
    const vol = volume.find((v) => v.time === candle.time);
    return {
      date: candle.time,
      close: candle.close,
      change,
      volume: vol?.value ?? null,
    };
  });
}

export function mapDashboardToPartialCards(
  dashboard: Pick<
    UseStockDashboardResult,
    'institutionalRange' | 'indicatorsRange' | 'priceChart' | 'endDate'
  >,
  requestId: string,
  asOfDate: string
): Record<DisplayDataset, AdvisorPartialDataEvent | null> {
  const instRows = dashboard.institutionalRange?.data ?? [];
  const instPreview = buildInstitutionalPreview(instRows);
  const latestInst = instPreview[instPreview.length - 1];

  const techRows = dashboard.indicatorsRange?.data ?? [];
  const techPreview = buildIndicatorPreview(techRows);
  const latestTech = techPreview[techPreview.length - 1];

  const pricePreview = buildPricePreview(dashboard);
  const latestPrice = pricePreview[pricePreview.length - 1];

  return {
    institutional: {
      request_id: requestId,
      step_key: 'institutional',
      dataset: 'institutional',
      summary: {
        rows: instPreview.length,
        latest_date: (latestInst?.date as string) ?? asOfDate,
        latest_total_net: latestInst?.total_net ?? null,
      },
      preview: instPreview,
    },
    prices: pricePreview.length
      ? {
          request_id: requestId,
          step_key: 'cross_check',
          dataset: 'prices',
          summary: {
            rows: pricePreview.length,
            latest_date: (latestPrice?.date as string) ?? asOfDate,
            latest_close: latestPrice?.close ?? null,
            latest_change: latestPrice?.change ?? null,
          },
          preview: pricePreview,
        }
      : null,
    indicators: {
      request_id: requestId,
      step_key: 'cross_check',
      dataset: 'indicators',
      summary: {
        rows: techPreview.length,
        latest_date: (latestTech?.date as string) ?? asOfDate,
        latest_rsi10: latestTech?.rsi10 ?? null,
        latest_macd_hist: latestTech?.macd_hist ?? null,
      },
      preview: techPreview,
    },
  };
}

export function createInitialAdvisorReport(symbol: string, asOfDate: string): AdvisorReport {
  const { date_start, date_end } = resolveAsOfDateRange(asOfDate, DEFAULT_STOCK_BEHAVIOR_LOOKBACK_DAYS);
  return {
    symbol,
    generated_at: new Date().toISOString(),
    summary: '正在整理市場證據與新聞脈絡…',
    technical_signals: [],
    recommendation: 'wait' as const,
    reasoning: '',
    risk_notes: null,
    sources: [],
    date_start,
    date_end,
  };
}
