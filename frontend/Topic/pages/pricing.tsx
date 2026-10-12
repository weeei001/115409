import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { Notice } from '@/components/common/Notice';
import { textLinkClass } from '@/components/ui/button';
import { BillingToggle, PlanCard } from '@/features/pricing/PlanCards';
import { ComparisonTable } from '@/features/pricing/ComparisonTable';
import { MinPlanBadge, PlannedBadge } from '@/features/pricing/PlanBadges';
import { useCurrentPlan } from '@/features/pricing/currentPlan';
import {
  DEFAULT_BILLING,
  DEMO_TAG,
  DESKTOP_MASCOT,
  PLANS,
  PRICING_DEMO_NOTICE,
  PRICING_FAQ,
  PRICING_LEAD,
  PRICING_SCOPE_NOTES,
  PRIMARY_PLAN_ID,
  planById,
  type BillingPeriod,
} from '@/features/pricing/plans';
import { DISCLAIMER_PATH, INVESTMENT_RISK_NOTICE } from '@/lib/disclaimers';

/**
 * 方案頁：方案卡與比較表是 features/pricing/plans.ts 的靜態資料，「目前方案」讀 GET /subscription。
 * 順序：專題展示聲明 → 方案卡（含月繳／年繳切換）→ 比較表 → 桌面小燈（規劃中，#desktop）→ 常見問題與付費範圍的免責文字。
 */
export default function PricingPage() {
  const [billing, setBilling] = useState<BillingPeriod>(DEFAULT_BILLING);
  const current = useCurrentPlan();
  const currentName = `${planById(current.planId).name}${current.planId === 'free' ? '' : `（${DEMO_TAG}）`}`;

  return (
    <>
      <Head>
        <title>股海明燈｜方案</title>
        <meta name="description" content="股海明燈免費版、進階版、專業版的價格、額度與工具比較。AI 投資分析在所有方案都完整開放；本頁為專題展示，不實際收費。" />
      </Head>
      <SiteHeader title="方案" subtitle="三種方案的用量與工具 · 專題展示，不實際收費" />
      <main aria-label="方案" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="flex flex-col gap-10 lg:gap-16">
          <AnimatedSection className="min-w-0">
            <Notice tone="info" className="mb-6">{PRICING_DEMO_NOTICE}</Notice>
            <Ledger
              aria-labelledby="pricing-plans-heading"
              title={<span id="pricing-plans-heading">選擇方案</span>}
              stamp={current.signedIn ? `目前方案 ${currentName}` : '訪客 · 免費版'}
              actions={<BillingToggle value={billing} onChange={setBilling} />}
              cols="grid-cols-1 md:grid-cols-3"
            >
              {PLANS.map((plan) => (
                <PlanCard key={plan.id} plan={plan} billing={billing} currentPlanId={current.planId} primary={plan.id === PRIMARY_PLAN_ID} />
              ))}
            </Ledger>
            <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">
              {PRICING_LEAD}
            </p>
          </AnimatedSection>

          <AnimatedSection delay={0.05} className="min-w-0">
            <Ledger aria-labelledby="pricing-compare-heading" title={<span id="pricing-compare-heading">方案比較</span>}>
              <ComparisonTable billing={billing} currentPlanId={current.planId} />
            </Ledger>
          </AnimatedSection>

          {/* /pricing#desktop：規劃中的桌面小燈；scroll-mt 讓錨點捲到頁首下方 */}
          <AnimatedSection delay={0.05} className="min-w-0">
            <Ledger
              id={DESKTOP_MASCOT.anchor}
              aria-labelledby="pricing-desktop-heading"
              title={<span id="pricing-desktop-heading">桌面小燈</span>}
              actions={<span className="flex items-center gap-2"><PlannedBadge /><MinPlanBadge planId={DESKTOP_MASCOT.minPlan} /></span>}
              className="scroll-mt-24"
            >
              <LedgerPanel>
                <p className="max-w-[68ch] text-[15px] leading-[1.8] text-pretty">{DESKTOP_MASCOT.summary}</p>
                <ul className="mt-3 max-w-[68ch] list-disc space-y-1.5 pl-5 text-[15px] leading-[1.8] marker:text-muted-foreground">
                  {DESKTOP_MASCOT.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </LedgerPanel>
            </Ledger>
          </AnimatedSection>

          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
            <AnimatedSection delay={0.1} className="min-w-0 lg:col-span-7">
              <Ledger aria-labelledby="pricing-faq-heading" title={<span id="pricing-faq-heading">常見問題</span>}>
                {PRICING_FAQ.map((item) => (
                  <FoldSection key={item.id} title={item.question}>
                    <p className="px-4 py-3 text-[15px] leading-[1.8] text-pretty sm:px-5">{item.answer}</p>
                  </FoldSection>
                ))}
              </Ledger>
            </AnimatedSection>

            <AnimatedSection delay={0.15} className="min-w-0 lg:col-span-5">
              <Ledger aria-labelledby="pricing-scope-heading" title={<span id="pricing-scope-heading">付費方案的範圍</span>}>
                <LedgerPanel>
                  <ul className="list-disc space-y-2 pl-5 text-[15px] leading-[1.8] marker:text-muted-foreground">
                    {PRICING_SCOPE_NOTES.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <Notice tone="warning" className="mt-4">
                    {INVESTMENT_RISK_NOTICE}
                    <Link href={DISCLAIMER_PATH} className={`ml-1 ${textLinkClass}`}>閱讀投資免責聲明</Link>
                  </Notice>
                </LedgerPanel>
              </Ledger>
            </AnimatedSection>
          </div>
        </div>
      </main>
    </>
  );
}
