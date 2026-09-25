/** 多股比較頁的畫面型別（由 openapi 原始回應計算而來，不是 API 欄位） */

import type { ValueTone } from '../utils/tone';

export type CompareChartMode = 'price' | 'index100' | 'cumulativeReturn';

export interface CompareMetricsRow {
  symbol: string;
  totalReturnPct: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  winRatePct: number | null;
  maxDailyGainPct: number | null;
  maxDailyLossPct: number | null;
  avgVolume: number | null;
  avgAmount: number | null;
}

export interface CompareQualityMeta {
  requestedRange: { startDate: string; endDate: string };
  analysisRange: { startDate: string; endDate: string } | null;
  alignedDays: number;
  samplesBySymbol: Record<string, number>;
  missingRatioBySymbol: Record<string, number>;
  generatedAt: string;
  qualityWarnings: string[];
}

export type CorrelationMatrix = Record<string, Record<string, number | null>>;

export interface CompareViewModel {
  metricsRows: CompareMetricsRow[];
  correlationMatrix: CorrelationMatrix;
  correlationSamples: Record<string, Record<string, number>>;
  qualityMeta: CompareQualityMeta;
}

/** 期間三大法人合計、最大單日合計買超、期末連續買超天數 */
export interface InstitutionalAggregate {
  symbol: string;
  foreignNet: number | null;
  investmentTrustNet: number | null;
  dealerNet: number | null;
  totalNet: number | null;
  maxDailyTotalNet: number | null;
  maxDailyTotalNetDate: string | null;
  consecutiveBuyDays: number;
}

export interface CategoryLeader {
  id: 'bestReturn' | 'minVolatility' | 'institutionalFavorite' | 'strongestMomentum' | 'lowestCorrelationPair';
  title: string;
  /** 主要股代號；組合（最低相關性）為「A × B」；沒有資料為「--」 */
  symbol: string;
  value: string;
  /** 報酬、法人買賣超、均線多空依正負給 up／down；沒有方向的指標（波動、相關性）與缺值是 neutral（決議 D13） */
  tone: ValueTone;
  reason: string;
}
