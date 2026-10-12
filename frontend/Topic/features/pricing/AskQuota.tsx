import React from 'react';
import Link from 'next/link';
import { textLinkClass } from '@/components/ui/button';
import { QuotaNotice } from './QuotaNotice';
import { useCurrentPlan } from './currentPlan';
import { askReachedText, askUsageText } from './quota';
import { DEMO_TAG, planById } from './plans';

/**
 * AI 對話與小燈輸入框下方的提問額度（兩邊共用同一份額度，次數由後端計算）。
 * 用完時輸入框停用（呼叫端用 useCurrentPlan().ask.reached）；stock 是小燈目前看的個股，用完時連到它的 AI 投資分析。
 */
export function AskQuota({ stock }: { stock?: { code: string; label: string } | null }) {
  const current = useCurrentPlan();
  const quota = current.ask;
  // 還沒讀到方案時不先顯示數字
  if (!quota) return null;
  const who = quota.guest ? '訪客' : `${planById(current.planId).name}${current.planId === 'free' ? '' : `（${DEMO_TAG}）`}`;

  return (
    <>
      {quota.reached ? (
        <QuotaNotice
          className="mt-2"
          extraLink={stock ? <Link href={`/stock/${stock.code}`} className={textLinkClass}>看 {stock.label} 的 AI 投資分析</Link> : null}
        >
          {askReachedText(quota, current.planId)}
        </QuotaNotice>
      ) : null}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        <span className="font-mono tabular-nums">{askUsageText(quota)}</span> · {who}
        {quota.reached ? null : <Link href="/pricing" className={`ml-1 ${textLinkClass}`}>方案</Link>}
      </p>
    </>
  );
}

/** 額度用完時停用 AI 對話與小燈的輸入框 */
export function useAskQuotaReached(): boolean {
  return useCurrentPlan().ask?.reached ?? false;
}
