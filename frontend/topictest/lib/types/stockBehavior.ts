/** openapi: Stock behavior analyze (rag → ai) */

export type { AnalyzeNewsSourceItem } from './index';
import type { AnalyzeNewsSourceItem } from './index';

export interface StockBehaviorRagRequest {
  symbols: string[];
}

export interface StockBehaviorRagResponse {
  news_sources?: AnalyzeNewsSourceItem[];
  fallback_mode?: boolean;
  raw_answer?: string;
}

export interface StockBehaviorAiRequest {
  symbol: string;
  news_sources?: AnalyzeNewsSourceItem[];
  fallback_mode?: boolean;
  raw_answer?: string;
}

export type ProjectionDirection = 'up' | 'down' | 'neutral' | 'uncertain';

export interface StockBehaviorAiProjectionPoint {
  day: number;
  relative_price?: number;
  predicted_close?: number | null;
  predicted_volume?: number | null;
  direction?: ProjectionDirection;
  reason?: string;
  evidence_ids?: string[];
}

export interface StockBehaviorAiProjection {
  horizon_days?: number;
  scenario_key?: string;
  base_close?: number | null;
  base_volume?: number | null;
  points?: StockBehaviorAiProjectionPoint[];
}

export interface StockBehaviorInventoryItem {
  id: string;
  field: string;
  value: unknown;
  date?: string | null;
  date_range?: string | null;
  streak_days?: number | null;
  reference_only?: boolean | null;
}

export interface StockBehaviorDataInventory {
  price_volume?: StockBehaviorInventoryItem[];
  chip?: StockBehaviorInventoryItem[];
  technical?: StockBehaviorInventoryItem[];
  news?: StockBehaviorInventoryItem[];
  missing_fields?: string[];
}

export interface StockBehaviorAiResponse {
  symbol: string;
  as_of_date: string;
  generated_by: string;
  /** AI 一句話總結；新版後端回傳，UI 直接呈現 */
  summary?: string;
  data_inventory?: StockBehaviorDataInventory;
  projection?: StockBehaviorAiProjection;
}

/** Used for date-range display when mapping reports (not sent to rag API). */
export const DEFAULT_STOCK_BEHAVIOR_LOOKBACK_DAYS = 365;
