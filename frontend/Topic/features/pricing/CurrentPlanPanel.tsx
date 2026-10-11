import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { demoRenewalDate, endDemoSubscription, useCurrentPlan } from './demoPlan';
import { askQuota, askUsageText, limitStatus, useAskUsage } from './quota';
import { BILLING_PERIODS, DEMO_TAG, PLAN_LIMITS, QUOTA_NOT_ENFORCED, formatCount, formatTwd, planById } from './plans';

const rowClass = 'flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5';

/**
 * 個人中心的「目前方案」：後端沒有方案資料（商業模式 F34），顯示的是這台瀏覽器的展示方案（預設免費版，
 * 結帳示意頁可以模擬開通）。用量只放有真實來源的數字：AI 提問是這台裝置實際送出的次數、收藏股檔數來自帳號。
 */
export function CurrentPlanPanel() {
  const current = useCurrentPlan();
  const favorites = useFavorites();
  const usage = useAskUsage(current.owner);
  const plan = planById(current.planId);
  const limits = PLAN_LIMITS[plan.id];
  const subscription = current.subscription;
  const ask = askQuota(plan.id, current.signedIn, usage);
  const favoriteCount = favorites.status === 'ready' ? favorites.items.length : null;
  const favoriteQuota = favoriteCount == null ? null : limitStatus(favoriteCount, limits.favorites);
  const billing = subscription ? BILLING_PERIODS.find((period) => period.value === subscription.billing) : null;

  const restoreFree = () => {
    if (endDemoSubscription()) toast.success('已恢復免費版。');
    else toast.error('這個瀏覽器無法儲存展示方案，請稍後再試。');
  };

  const rows: Array<[string, React.ReactNode]> = [
    ['AI 對話與小燈提問', <>{askUsageText(ask)}<span className="block text-xs text-muted-foreground">這台裝置的實際次數</span></>],
    [
      '收藏股',
      favoriteQuota == null
        ? <span className="text-muted-foreground">{favorites.status === 'error' ? '載入失敗' : '讀取中…'}</span>
        : favoriteQuota.limit == null
          ? `${formatCount(favoriteQuota.used)} 檔（不限）`
          : `${formatCount(favoriteQuota.used)}／${formatCount(favoriteQuota.limit)} 檔`,
    ],
    ['多股比較同時檔數', `${formatCount(limits.compare)} 檔`],
  ];
  if (subscription && billing) {
    rows.unshift(
      ['計費週期', `${billing.label} ${formatTwd(plan.price[subscription.billing])}`],
      ['開通日（展示）', <span className="font-mono text-[13.5px] tabular-nums">{subscription.startedOn}</span>],
      ['下次續訂（展示）', <span className="font-mono text-[13.5px] tabular-nums">{demoRenewalDate(subscription)}</span>],
    );
  }

  return (
    <Ledger aria-labelledby="me-plan-heading" title={<span id="me-plan-heading">目前方案</span>} stamp={DEMO_TAG}>
      <LedgerPanel>
        <p className="text-lg font-bold tracking-[0.04em]">{plan.name}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {subscription
            ? `這是模擬開通的展示方案，沒有付款，也沒有實際開通服務；額度只提示，${QUOTA_NOT_ENFORCED}。`
            : `系統目前沒有方案與額度機制，所有帳號預設是免費版，功能照現況開放。可以到方案頁模擬開通付費方案，看看付費版的畫面。`}
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
            <Button type="button" variant="outline" onClick={restoreFree}>
              恢復免費版
            </Button>
          ) : null}
        </div>
      </LedgerPanel>
    </Ledger>
  );
}
