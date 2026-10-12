import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { cancelPlan, useCurrentPlan } from './currentPlan';
import { askUsageText, limitStatus } from './quota';
import { BILLING_PERIODS, DEMO_TAG, formatCount, formatTwd, planById } from './plans';

const rowClass = 'flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5';

/**
 * 個人中心的「目前方案」：方案、額度與 AI 提問次數來自後端 GET /subscription（預設免費版，結帳示意頁可以模擬開通），
 * 收藏股檔數來自收藏清單。
 */
export function CurrentPlanPanel() {
  const current = useCurrentPlan();
  const favorites = useFavorites();
  const [restoring, setRestoring] = useState(false);
  const plan = planById(current.planId);
  const { ask, limits, subscription } = current;
  const favoriteCount = favorites.status === 'ready' ? favorites.items.length : null;
  const favoriteQuota = favoriteCount == null || !limits ? null : limitStatus(favoriteCount, limits.favorites);
  const billing = subscription ? BILLING_PERIODS.find((period) => period.value === subscription.billing) : null;
  const loading = <span className="text-muted-foreground">{current.error ? '載入失敗' : '讀取中…'}</span>;

  const restoreFree = () => {
    setRestoring(true);
    cancelPlan()
      .then(() => toast.success('已恢復免費版。'))
      .catch((error) => toast.error(userFacingMessage(error, '沒有恢復成免費版，請稍後再試。')))
      .finally(() => setRestoring(false));
  };

  const rows: Array<[string, React.ReactNode]> = [
    ['AI 對話與小燈提問', ask ? askUsageText(ask) : loading],
    [
      '收藏股',
      favoriteQuota == null
        ? <span className="text-muted-foreground">{favorites.status === 'error' || current.error ? '載入失敗' : '讀取中…'}</span>
        : favoriteQuota.limit == null
          ? `${formatCount(favoriteQuota.used)} 檔（不限）`
          : `${formatCount(favoriteQuota.used)}／${formatCount(favoriteQuota.limit)} 檔`,
    ],
    ['多股比較同時檔數', limits ? `${formatCount(limits.compare)} 檔` : loading],
    ['歷史對話保存', limits ? (limits.historyDays == null ? '不限' : `最近 ${formatCount(limits.historyDays)} 天`) : loading],
    ['Web、Android 推播', limits ? (limits.push ? '可以使用' : `${planById('plus').name}起`) : loading],
  ];
  if (subscription && billing) {
    rows.unshift(
      ['計費週期', `${billing.label} ${formatTwd(plan.price[subscription.billing])}`],
      ['開通日（展示）', <span className="font-mono text-[13.5px] tabular-nums">{subscription.startedOn}</span>],
      ['下次續訂（展示）', <span className="font-mono text-[13.5px] tabular-nums">{subscription.renewsOn}</span>],
    );
  }

  return (
    <Ledger aria-labelledby="me-plan-heading" title={<span id="me-plan-heading">目前方案</span>} stamp={DEMO_TAG}>
      <LedgerPanel>
        <p className="text-lg font-bold tracking-[0.04em]">{plan.name}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {subscription
            ? '這是模擬開通的方案，沒有付款；額度與工具已照這個方案生效。恢復免費版後收藏都會保留，超過 30 天的歷史對話只是隱藏，不會刪除。'
            : '所有帳號預設是免費版，額度用完會暫停 AI 提問到下次歸零。可以到方案頁模擬開通付費方案（不付款）。'}
        </p>
        <dl className="mt-4 grid gap-px border-y bg-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className={rowClass}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button asChild variant="outline">
            <Link href="/pricing">
              {subscription ? '變更方案' : '升級方案'}
              <ArrowRight size={16} aria-hidden />
            </Link>
          </Button>
          {subscription ? (
            <Button type="button" variant="outline" onClick={restoreFree} disabled={restoring} aria-busy={restoring || undefined}>
              {restoring ? '處理中…' : '恢復免費版'}
            </Button>
          ) : null}
        </div>
      </LedgerPanel>
    </Ledger>
  );
}
