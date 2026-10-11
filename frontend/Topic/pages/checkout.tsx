import Head from 'next/head';
import { useRouter } from 'next/router';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { LoadingRows } from '@/components/common/Notice';
import { CheckoutContent } from '@/features/pricing/CheckoutContent';
import { isBillingPeriod, isPaidPlanId } from '@/features/pricing/demoPlan';
import { DEFAULT_BILLING } from '@/features/pricing/plans';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { breadcrumbsTrail } from '@/lib/nav';

const CRUMBS = breadcrumbsTrail({ label: '方案', href: '/pricing' }, '結帳');

/**
 * 結帳示意頁（商業模式第 8 節 #2）。方案與計費週期帶在查詢字串（?plan=plus&billing=yearly），內容在 CheckoutContent。
 * 靜態頁在伺服器端的 router.isReady 一定是 false；網址沒有查詢字串時，瀏覽器 hydration 當下就是 true。
 * 等 hydration 完才讀查詢字串，兩邊第一次畫的都是「讀取中」，不會 hydration 不一致。
 */
export default function CheckoutPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const ready = hydrated && router.isReady;
  const planParam = router.query.plan;
  const billingParam = router.query.billing;

  return (
    <>
      <Head>
        <title>股海明燈｜結帳</title>
        <meta name="description" content="股海明燈付費方案的結帳示意頁。專題展示，金流尚未串接，不會實際收費。" />
      </Head>
      <SiteHeader title="結帳" subtitle="專題展示 · 金流尚未串接，不會實際收費" breadcrumbs={CRUMBS} />
      <main aria-label="結帳" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {ready ? (
          <CheckoutContent
            planId={isPaidPlanId(planParam) ? planParam : null}
            billing={isBillingPeriod(billingParam) ? billingParam : DEFAULT_BILLING}
          />
        ) : (
          <div className="border-t border-border-strong">
            <LoadingRows label="讀取方案中…" className="h-[176px]" />
          </div>
        )}
      </main>
    </>
  );
}
