/**
 * `POST /analyze/stock-behavior/text-brief`（schema `text-first-v2`）的回應型別。
 *
 * 後端隨時可能多回欄位，所以這裡只把畫面真正會讀到的部分寫死，
 * 其餘一律 optional，避免多一個欄位就整頁編不過。
 */

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

/** 後端稽核後的整體狀態；`verified` 代表模型輸出一個字都沒被動過 */
export type BriefStatus = 'verified' | 'limited' | 'unavailable';

/** 一句結論。所有結論都帶 `evidence_ids`，這是 v2 可回溯的基礎 */
export interface Claim {
  id: string;
  claim_type?: string;
  text: string;
  direction?: Direction;
  evidence_ids?: string[];
  importance?: string;
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
}

export interface Risk {
  id: string;
  risk_type: string;
  description: string;
  trigger: string;
  evidence_ids?: string[];
}

export interface WatchPoint {
  id: string;
  what_to_watch: string;
  why_it_matters: string;
  when: string;
  evidence_ids?: string[];
}

export interface ForwardView {
  stance: Stance | string;
  reason: string;
  invalidation: string;
  evidence_ids?: string[];
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
  last4q?: [string, number][];
  yoy_last6?: [string, number][];
}

/** 後端稽核紀錄：十個欄位全空才是 `verified` */
export interface Verification {
  filtered_evidence_ids?: string[];
  removed_item_ids?: string[];
  compliance_violations?: string[];
  soft_compliance_hits?: string[];
  unverified_numbers?: string[];
  future_dated_items?: string[];
  undercount_sections?: string[];
  truncated_sections?: string[];
  simplified_chars?: string[];
  jargon_hits?: string[];
}

export type VerificationKey = keyof Verification;

export interface TimelineDay {
  id: string;
  date: string;
  close?: number;
  chg_pct?: number;
  vol_lots?: number;
  vol_vs_ma5_pct?: number;
  foreign_net_lots?: number;
  trust_net_lots?: number;
  dealer_net_lots?: number;
  rsi5?: number;
  kd_k?: number;
  macd_hist?: number;
  vs_ma20_pct?: number;
  /** 後端在 build_daily_timeline 依日期掛上來的新聞 id */
  news?: string[];
}

export interface PacketNewsItem {
  id: string;
  field?: string;
  date: string;
  kind?: string;
  title?: string;
  /** RAG 回傳的切塊全文，不截斷；模型看到的就是這一段 */
  value: string;
}

/** 真正送進 LLM 的 task packet；模型看不到這裡沒有的任何資料 */
export interface TaskPacket {
  task?: {
    type?: string;
    symbol: string;
    as_of_date: string;
    timeline_trading_days?: number;
    analysis_language?: string;
  };
  daily_timeline?: TimelineDay[];
  long_term_anchor?: EvidenceItem[];
  fundamental?: EvidenceItem[];
  news?: PacketNewsItem[];
  missing_fields?: string[];
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
  verification?: Verification;
  disclaimer?: Disclaimer;
  limitations?: string[];
  cached?: boolean;
  /** 只在請求帶 `include_payload: true` 時附上，不會寫進快取 */
  task_packet?: TaskPacket | null;
}

/** `GET /analyze/stock-behavior/text-brief/history` 的一列（來自 llm_responses） */
export interface HistoryItem {
  id: number;
  created_at?: string;
  symbol: string;
  as_of_date: string;
  model_name?: string;
  status?: string;
  latency_ms?: number | null;
  news_count?: number | null;
  config_hash?: string | null;
  summary?: string | null;
}

export interface TextBriefRequest {
  symbol: string;
  as_of_date?: string;
  force_refresh?: boolean;
  /** 帶 true 時回應會附上送進模型的 task packet（只有 DEMO 頁需要） */
  include_payload?: boolean;
  /** 只讀快取、不呼叫 LLM；查無當日快照就退回該檔最近一次，產生交給排程 */
  cache_only?: boolean;
}
