import React from 'react';
import Link from 'next/link';
import { textLinkClass } from '@/components/ui/button';
import { QuotaNotice } from './QuotaNotice';
import { useCurrentPlan } from './demoPlan';
import { askQuota, askReachedText, askUsageText, useAskUsage } from './quota';
import { DEMO_TAG, planById } from './plans';

/**
 * AI 對話與小燈輸入框下方的提問額度（兩邊共用同一份計數）。
 * 次數是這台裝置實際送出的提問；用完只提示、不擋。stock 是小燈目前看的個股，用完時連到它的 AI 投資分析。
 */
export function AskQuota({ stock }: { stock?: { code: string; label: string } | null }) {
  const current = useCurrentPlan();
  const usage = useAskUsage(current.owner);
  // 伺服器端與 hydration 時還不知道登入狀態，不先顯示訪客的額度
  if (!current.ready) return null;
  const quota = askQuota(current.planId, current.signedIn, usage);
  const who = current.signedIn ? `${planById(current.planId).name}${current.planId === 'free' ? '' : `（${DEMO_TAG}）`}` : '訪客';

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
        <span className="font-mono tabular-nums">{askUsageText(quota)}</span> · {who}，這台裝置
        {quota.reached ? null : <Link href="/pricing" className={`ml-1 ${textLinkClass}`}>方案</Link>}
      </p>
    </>
  );
}
