import type { AIFeatureUsage, AIUsageSummary } from '../types/api';
import { fmtNum, fmtPercent } from '../utils/format';

/** 平均 token 的兩個欄位：AI 摘要是「每份」，各功能的模型呼叫是「每次請求」 */
type TokenAverages = Pick<AIUsageSummary, 'avg_prompt_tokens' | 'avg_completion_tokens'>;

/** 美元金額：一份摘要只有幾毫美分，不到 1 美元時留 4 位小數，不然都會顯示成 0.00 */
export function usdText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return `US$${value.toFixed(value < 1 ? 4 : 2)}`;
}

/** 平均 token（輸入＋輸出）；兩個平均都有才算 */
export function avgTokensText(usage: TokenAverages): string {
  if (usage.avg_prompt_tokens == null || usage.avg_completion_tokens == null) return '--';
  return fmtNum(Math.round(usage.avg_prompt_tokens + usage.avg_completion_tokens));
}

export function tokenSplitText(usage: TokenAverages): string {
  if (usage.avg_prompt_tokens == null || usage.avg_completion_tokens == null) return '還沒有 token 紀錄';
  return `輸入 ${fmtNum(Math.round(usage.avg_prompt_tokens))} · 輸出 ${fmtNum(Math.round(usage.avg_completion_tokens))}`;
}

export function latencyText(usage: AIUsageSummary): string {
  return usage.avg_latency_seconds == null ? '--' : `${usage.avg_latency_seconds.toFixed(1)} 秒`;
}

export function retryText(usage: AIUsageSummary): string {
  return usage.retry_rate == null ? '沒有重試紀錄' : `需要第二次呼叫 ${fmtPercent(usage.retry_rate, { fromRatio: true, decimals: 1 })}`;
}

/** 每百萬 token 單價：一般寫到分（0.20），更細的單價（0.075）不四捨五入掉 */
function priceText(value: number): string {
  return Math.round(value * 100) === value * 100 ? value.toFixed(2) : String(Number(value.toFixed(4)));
}

/** 成本怎麼估的，以及沒算進去的部分 */
export function costNote(usage: AIUsageSummary): string {
  return [
    `以設定的單價估算：輸入每百萬 token US$${priceText(usage.input_price_per_m)}、輸出 US$${priceText(usage.output_price_per_m)}。`,
    usage.measured < usage.briefs ? `${usage.briefs} 份中有 ${usage.measured} 份有 token 紀錄，平均與成本只用這些計算。` : '',
    usage.unavailable ? `其中 ${usage.unavailable} 份沒有產出內容，但一樣呼叫過模型。` : '',
    '這裡只算 AI 摘要，AI 對話與新聞事件判讀見「各功能的模型呼叫」；自架模型的實際花費是主機費用，這裡是用 token 換算的參考值。',
  ].join('');
}

/** ai_usage_logs 的功能代號；沒列到的代號照原樣顯示 */
const FEATURE_LABEL: Record<string, string> = {
  chat: 'AI 對話與小燈',
  analysis: 'AI 摘要',
  news_impact: '新聞事件判讀',
};

export const featureLabel = (feature: string): string => FEATURE_LABEL[feature] ?? feature;

/** 「12 次 · 失敗 1」；同一次請求平均呼叫幾次寫在後面 */
export function featureCallsText(usage: AIFeatureUsage): string {
  const failed = usage.failed_calls ? ` · 失敗 ${fmtNum(usage.failed_calls)}` : '';
  const perRequest = usage.requests ? `（每次請求 ${(usage.calls / usage.requests).toFixed(1)} 次）` : '';
  return `${fmtNum(usage.calls)} 次${failed}${perRequest}`;
}

/** 各功能用量的計算方式，以及沒有 token 紀錄、沒有列入的部分 */
export function featureUsageNote(usage: AIUsageSummary): string {
  const partial = (usage.features ?? [])
    .filter((feature) => feature.measured_requests < feature.requests)
    .map((feature) => `${featureLabel(feature.feature)} ${fmtNum(feature.requests)} 次中有 ${fmtNum(feature.measured_requests)} 次`);
  return [
    '同一次提問或同一份分析裡的多次模型呼叫算一次請求；平均與成本只用每次呼叫都有回報 token 的請求計算',
    partial.length ? `（${partial.join('、')}）` : '',
    '。失敗或中斷的呼叫也可能已經計費。判斷檢討與後台 AI 回測沒有用量紀錄，沒有列入。',
  ].join('');
}
