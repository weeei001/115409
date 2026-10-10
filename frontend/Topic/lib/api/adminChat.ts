import apiClient, { ApiRequestError } from './client';
import { userFacingMessage } from './errorDetail';

/** Admin-only bounded snapshots; deliberately separate from the public chat response. */
export type AdminChatOutcome = 'passed' | 'repaired' | 'fallback' | 'direct' | 'error' | 'interrupted';
export type AdminChatOutcomeFilter = AdminChatOutcome | 'attention' | '';
export interface AdminChatFilters {
  days: number;
  outcome: AdminChatOutcomeFilter;
  reason: string;
  q: string;
}
export interface AdminChatTokens {
  input: number | null;
  output: number | null;
  thinking: number | null;
}
export interface AdminChatSummary {
  id: string;
  created_at: string;
  user_id: number | null;
  user_email: string | null;
  conversation_id: string | null;
  turn_id: string | null;
  outcome: AdminChatOutcome;
  reason: string | null;
  reasons: string[];
  query_preview: string;
  model: string | null;
  duration_ms: number;
  attempt_count: number;
  source_count: number;
  publication_completed: boolean;
}
export interface AdminChatList {
  items: AdminChatSummary[];
  total: number;
  retention_days: number;
}
export interface AdminChatAttempt {
  number: number;
  stage: 'initial' | 'repair';
  text: string;
  text_truncated: boolean;
  original_chars: number;
  finish_reason: string | null;
  truncated: boolean;
  validation: 'passed' | 'rejected' | 'not_checked';
  reason: string | null;
  hint: string | null;
  issue?: string | null;
  claim: string | null;
  detail: string | null;
  diagnostics_truncated: boolean;
  duration_ms: number | null;
  tokens: AdminChatTokens;
  max_tokens: number | null;
}
export interface AdminChatSource {
  citation_id: string;
  title: string;
  source: string;
  source_name: string;
  category: string;
  pub_time: string;
  url: string;
  stock_id: string;
  stock_ids: string[];
  content: string;
  content_truncated: boolean;
  original_chars: number;
  snapshot_truncated: boolean;
  [key: string]: unknown;
}
export interface AdminChatDetail extends AdminChatSummary {
  planning?: AdminChatPlanning[];
  evidence?: { requested: string[]; available: string[]; missing: string[]; blocked: boolean | null; status: string | null } | null;
  schema_version: number;
  query: string;
  query_truncated: boolean;
  query_original_chars: number;
  final_answer: string;
  final_answer_truncated: boolean;
  final_answer_original_chars: number;
  attempts: AdminChatAttempt[];
  sources: AdminChatSource[];
  sources_truncated: boolean;
  tokens: AdminChatTokens;
  request_timeout_seconds: number | null;
  repair_max_tokens: number | null;
  requires_portfolio: boolean;
  answer_detail: string;
  error_type: string | null;
  recovery?: {
    method: 'validated_partial';
    draft_stage: 'initial' | 'repair';
    validation: 'passed';
    removed: Array<{ paragraph?: number | null; reason: string; result: string; units?: number | null }>;
  } | null;
}

export interface AdminChatPlanning {
  stage: 'plan';
  status: string;
  result?: { tasks: string[]; portfolio_access: string | null; favorites_access: string | null; stocks: string[]; } | null;
  finish_reason?: string | null;
  tokens?: { prompt_tokens: number | null; completion_tokens: number | null; reasoning_tokens: number | null };
  duration_ms?: number | null;
  invalid_fields?: string[];
  issue?: string | null;
  effective_needs?: string[];
  error_type?: string | null;
}

export const ADMIN_CHAT_PAGE_SIZE = 20;
export const INITIAL_ADMIN_CHAT_FILTERS: AdminChatFilters = { days: 14, outcome: 'attention', reason: '', q: '' };
export const ADMIN_CHAT_OUTCOMES: Array<{ value: AdminChatOutcomeFilter; label: string }> = [
  { value: 'attention', label: '需處理（安全回覆／失敗／中斷）' },
  { value: '', label: '全部結果' },
  { value: 'fallback', label: '安全回覆' },
  { value: 'error', label: '生成失敗' },
  { value: 'interrupted', label: '中斷' },
  { value: 'repaired', label: '修復後通過' },
  { value: 'passed', label: '初次通過' },
  { value: 'direct', label: '直接回覆' },
];

export function adminChatOutcomeLabel(outcome: string): string {
  return ADMIN_CHAT_OUTCOMES.find((item) => item.value === outcome)?.label ?? outcome;
}

/** These are rule names, not a claim that the rejected draft was necessarily false. */
export const ADMIN_CHAT_REASON_LABELS: Record<string, string> = {
  citations: '引用未通過', numbers: '數值未通過', grounding: '來源支持不足',
  compliance: '建議或交易限制未通過', empty: '空白回覆', length: '回答不完整',
  invalid_answer: '回答未通過',
};

export function adminChatReasonLabel(reason: string): string {
  return ADMIN_CHAT_REASON_LABELS[reason] ?? '其他檢核原因';
}

export function adminChatIssueLabel(issue: string): string {
  const labels: Record<string, string> = {
    unparsed: '句型解析失敗（尚未確認對錯）', unsupported: '來源缺漏或未支持主張',
    contradicted: '數值與來源矛盾', invalid_evidence: '來源格式無法讀取',
    conclusion_unsupported: '結論缺乏依據', unsupported_conclusion: '結論缺乏依據',
    account_limit: '超出資金或可賣庫存', truncated: '回答截斷', length: '回答不完整',
    dependent_or_non_substantive: '相依結論或非實質內容', dependent_period: '依賴未保留的日期',
    dependent_subject: '依賴未保留的公司主詞',
    partial_recovery: '保留內容重新核對通過', insufficient_remaining_content: '剩餘內容不足',
    recovery_limit: '超過局部修復上限',
  };
  return labels[issue] ?? '其他檢核細節';
}

/** Keep filters in query parameters; an identifier can never change the request route. */
export function adminChatParams(filters: AdminChatFilters, offset = 0): Record<string, string | number> {
  if (!Number.isInteger(filters.days) || filters.days < 1 || filters.days > 14) throw new Error('Invalid chat review date range');
  if (!ADMIN_CHAT_OUTCOMES.some((item) => item.value === filters.outcome)) throw new Error('Invalid chat review outcome');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid chat review offset');
  const q = filters.q.trim();
  const reason = filters.reason.trim();
  if (q.length > 120 || reason.length > 64) throw new Error('Invalid chat review filter length');
  return {
    days: filters.days, limit: ADMIN_CHAT_PAGE_SIZE, offset,
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(reason ? { reason } : {}), ...(q ? { q } : {}),
  };
}

export async function fetchAdminChats(filters: AdminChatFilters, offset = 0, signal?: AbortSignal): Promise<AdminChatList> {
  const { data } = await apiClient.get<AdminChatList>('/admin/ai-conversations', { params: adminChatParams(filters, offset), signal });
  return data;
}

export async function fetchAdminChat(id: unknown, signal?: AbortSignal): Promise<AdminChatDetail> {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid chat review identifier');
  }
  const { data } = await apiClient.get<AdminChatDetail>(`/admin/ai-conversations/${id}`, { signal });
  return data;
}

export function adminChatErrorMessage(error: unknown, detail = false): string {
  if (error instanceof ApiRequestError && detail && error.status === 404) {
    return '找不到這筆檢核紀錄，可能已過保存期限或原對話已刪除。請重新整理清單。';
  }
  const message = userFacingMessage(error, detail ? '無法載入這筆檢核詳情，請重試。' : '無法載入 AI 對話檢核紀錄，請重試。');
  // HTTP status is useful in this admin debugging screen; do not render a raw server trace.
  return error instanceof ApiRequestError && error.status ? `${message}（HTTP ${error.status}）` : message;
}
