/**
 * `POST /analyze/stock-behavior/text-brief`（schema `text-first-v1`）的回應型別。
 *
 * evidence_catalog 的額外欄位（period、kind、yoy_pct…）在 openapi 只以 additionalProperties 允許、沒有命名，
 * 依後端 analysis/evidence.py 保留（決議 D5）。
 *
 * 後端隨時可能多回欄位，所以這裡只把畫面真正會讀到的部分寫死，
 * 其餘一律 optional，避免多一個欄位就整頁編不過。
 */

import type { NewsSourceState } from './api';

export type Direction =
  | 'positive'
  | 'negative'
  | 'mixed'
  | 'neutral'
  | 'not_applicable';

export type Stance =
  | 'bullish'
  | 'mildly_bullish'
  | 'mixed'
  | 'neutral'
  | 'mildly_bearish'
  | 'bearish'
  | 'uncertain';

export type Confidence = 'low' | 'medium' | 'high';

/** Automated validation status; this is not independent factual verification. */
export type BriefStatus = 'verified' | 'limited' | 'unavailable';

export interface NewsSupport {
  evidence_id: string;
  quote: string;
  use: 'reported_fact' | 'attributed_view' | 'retrospective' | 'price_reaction';
  event_date?: string | null;
}

/**
 * 結論的性質。畫面必須據此區分「有證據支撐的觀察」與「模型自己推的」：
 * inference→AI 推論、conflict→資料矛盾、limitation→資料限制。
 */
export type ClaimType = 'observation' | 'inference' | 'conflict' | 'limitation';

/** 一句結論。所有結論都帶 `evidence_ids`，這是 v1 可回溯的基礎 */
export interface Claim {
  id: string;
  /** 後端列舉是 ClaimType，但舊快照／未知值仍要能顯示，所以維持寬型別 */
  claim_type?: ClaimType | string;
  text: string;
  direction?: Direction;
  evidence_ids?: string[];
  importance?: string;
  news_support?: NewsSupport[];
}

/** 關鍵交易日。`move_pct` 與 `volume_ratio` 由後端依 `ref` 回填，不是模型寫的 */
export interface KeyDay {
  id: string;
  date: string;
  ref?: string;
  what: string;
  evidence_ids?: string[];
  move_pct?: number | null;
  volume_ratio?: number | null;
  news_support?: NewsSupport[];
}

export interface Risk {
  id: string;
  risk_type: string;
  description: string;
  trigger: string;
  evidence_ids?: string[];
  news_support?: NewsSupport[];
}

export interface WatchPoint {
  id: string;
  what_to_watch: string;
  why_it_matters: string;
  when: string;
  evidence_ids?: string[];
  news_support?: NewsSupport[];
}

export interface ForwardView {
  stance: Stance | string;
  validation_status?: 'rejected' | null;
  reason: string;
  invalidation: string;
  evidence_ids?: string[];
  news_support?: NewsSupport[];
}

export type ForwardViewKey = 'short_1_5' | 'swing_6_20' | 'medium_21_40';

export type ForwardViews = Partial<Record<ForwardViewKey, ForwardView>>;

export interface Brief {
  headline: string;
  key_days?: KeyDay[];
  current_status?: Claim[];
  positive_factors?: Claim[];
  negative_factors?: Claim[];
  source_divergences?: Claim[];
  risks?: Risk[];
  watch_points?: WatchPoint[];
  forward_views?: ForwardViews;
  overall_stance?: Stance | string;
  confidence?: Confidence | string;
  confidence_reason?: string;
  limitations?: string[];
}

/** 交易日證據的 value 是物件，其餘欄位的 value 是純量 */
export interface DailyEvidenceValue {
  close?: number;
  chg_pct?: number;
  vol_lots?: number;
  vol_vs_ma5_pct?: number;
  foreign_net_lots?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
}

export interface EvidenceItem {
  id: string;
  field: string;
  date?: string | null;
  value: number | string | DailyEvidenceValue | null;
  period?: string;
  kind?: string;
  title?: string;
  yoy_pct?: number;
  mom_pct?: number;
  qoq_pct?: number;
  pct_rank_1y?: number;
  sample_count?: number;
  window_start?: string | null;
  window_end?: string | null;
  available_at?: string | null;
  content_truncated?: boolean;
  retrieval_branch?: string;
  shared_fact_ids?: string[];
  article_id?: string;
  source_state?: NewsSourceState;
  source_relationships?: { symbol: string; scope: string; relationship: string; target_id: string }[];
  last4q?: [string, number][];
  yoy_last6?: [string, number][];
  /**
   * 以下三個是新聞的出處 metadata，只有 `field === 'news'` 會有，而且一律來自
   * 資料擷取階段（RAG payload），不是 LLM 寫的；分析輸入保留這些欄位以便判斷時序與來源。
   * 舊快照沒有這些欄位，所以全部 optional，缺少時畫面顯示「系統彙整資料」。
   */
  url?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  collected_at?: string | null;
  publication_basis?: string | null;
  calculation?: { formula: string; inputs: { date: string; value: number }[]; unit: string };
}

export interface Disclaimer {
  version?: string;
  text: string;
}

export interface TextBriefResponse {
  schema_version?: string;
  symbol: string;
  as_of_date: string;
  generated_by?: string;
  status: BriefStatus | string;
  brief?: Brief | null;
  evidence_catalog?: EvidenceItem[];
  disclaimer?: Disclaimer;
  limitations?: string[];
  cached?: boolean;
  analysis_mode?: 'current_analysis' | 'historical_reanalysis' | null;
  price_as_of_date?: string | null;
  news_cutoff_date?: string | null;
  verification_scope?: string;
  snapshot_id?: number | null;
  generated_at?: string | null;
  analysis_revision?: string | null;
  config_hash?: string | null;
}

export interface TextBriefRequest {
  symbol: string;
  as_of_date?: string;
  force_refresh?: boolean;
  /** 只讀快取、不呼叫 LLM；查無當日快照就退回該檔最近一次，產生交給排程 */
  cache_only?: boolean;
}
