import type { AIUsageSummary } from '../types/api';
import { fmtNum, fmtPercent } from '../utils/format';

/** 美元金額：一份摘要只有幾毫美分，不到 1 美元時留 4 位小數，不然都會顯示成 0.00 */
export function usdText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return `US$${value.toFixed(value < 1 ? 4 : 2)}`;
}

/** 每份平均 token（輸入＋輸出）；兩個平均都有才算 */
export function avgTokensText(usage: AIUsageSummary): string {
  if (usage.avg_prompt_tokens == null || usage.avg_completion_tokens == null) return '--';
  return fmtNum(Math.round(usage.avg_prompt_tokens + usage.avg_completion_tokens));
}

export function tokenSplitText(usage: AIUsageSummary): string {
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
    usage.unavailable ? `其中 ${usage.unavailable} 份沒有通過檢查、沒有產出內容，但一樣呼叫過模型。` : '',
    '未含 AI 對話、新聞影響分析、判斷檢討與後台 AI 回測的呼叫；自架模型的實際花費是主機費用，這裡是用 token 換算的參考值。',
  ].join('');
}
