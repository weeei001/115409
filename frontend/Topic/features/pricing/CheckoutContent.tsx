import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, CreditCard } from 'lucide-react';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Ledger, LedgerPanel, figureClass } from '@/components/common/Ledger';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button, textLinkClass } from '@/components/ui/button';
import { useAuthAccount } from '@/lib/auth/account';
import { clearAuth } from '@/lib/auth/storage';
import { DISCLAIMER_PATH } from '@/lib/disclaimers';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { BillingToggle, planPriceText } from './PlanCards';
import { PlannedBadge } from './PlanBadges';
import { demoRenewalDate, startDemoSubscription, taipeiToday, useCurrentPlan, type PaidPlanId } from './demoPlan';
import { BILLING_PERIODS, DEMO_TAG, PAYMENT_UNAVAILABLE, PRICING_SCOPE_NOTES, planById, type BillingPeriod } from './plans';

/**
 * 結帳示意頁（pages/checkout.tsx）的內容：方案摘要與金額，付款區寫明金流尚未串接。
 * 登入後可以「模擬開通」：不付款、不呼叫 API，只切換這個帳號在這台瀏覽器的展示方案（demoPlan.ts）。
 * planId 是 null（網址沒帶或帶了免費版、不認得的方案）時請使用者回方案頁選。
 */
export function CheckoutContent({ planId, billing }: { planId: PaidPlanId | null; billing: BillingPeriod }) {
  const router = useRouter();
  const current = useCurrentPlan();
  const account = useAuthAccount();
  const [result, setResult] = useState<'done' | 'failed' | null>(null);

  if (!planId) {
    return (
      <LedgerPanel framed>
        <EmptyState action={<Button asChild variant="outline"><Link href="/pricing">回到方案頁</Link></Button>}>
          找不到要結帳的方案，請從方案頁選擇進階版或專業版。
        </EmptyState>
      </LedgerPanel>
    );
  }

  const plan = planById(planId);
  const price = planPriceText(plan, billing);
  const periodLabel = BILLING_PERIODS.find((period) => period.value === billing)?.label ?? '';
  const today = taipeiToday();
  const sameAsCurrent = current.subscription?.plan === planId && current.subscription.billing === billing;
  const loginHref = { pathname: '/login', query: { returnUrl: safeReturnUrl(router.asPath) ?? '/pricing' } };

  const changeBilling = (next: BillingPeriod) => {
    setResult(null);
    void router.replace({ pathname: '/checkout', query: { plan: planId, billing: next } }, undefined, { shallow: true, scroll: false });
  };

  const activate = () => setResult(startDemoSubscription(planId, billing) ? 'done' : 'failed');

  let action: React.ReactNode;
  if (result === 'done') {
    action = (
      <Notice tone="success">
        已切換為{plan.name}（{DEMO_TAG}，{periodLabel}）。沒有付款，也沒有實際開通任何服務。
        <span className="mt-1 flex flex-wrap gap-x-4">
          <Link href="/me" className={textLinkClass}>到個人中心看目前方案</Link>
          <Link href="/pricing" className={textLinkClass}>回到方案頁</Link>
        </span>
      </Notice>
    );
  } else if (account && !current.signedIn) {
    // 有登入 token 卻讀不到帳號資料：登入頁看到 token 會直接導回來，要先清掉再重新登入
    action = (
      <>
        <p className="text-sm leading-relaxed text-subtle">這台瀏覽器的登入資料不完整，請重新登入後再模擬開通。</p>
        <Button
          type="button"
          size="lg"
          className="mt-3 w-full"
          onClick={() => {
            clearAuth();
            void router.push(loginHref);
          }}
        >
          重新登入
        </Button>
      </>
    );
  } else if (!current.signedIn) {
    action = (
      <>
        <p className="text-sm leading-relaxed text-subtle">付費方案綁定帳號，登入後才能模擬開通。</p>
        <Button asChild size="lg" className="mt-3 w-full">
          <Link href={loginHref}>登入後繼續</Link>
        </Button>
      </>
    );
  } else if (sameAsCurrent) {
    action = (
      <p className="flex min-h-11 items-center gap-2 border border-dashed border-input px-3 text-sm text-subtle">
        <Check size={16} className="shrink-0" aria-hidden />
        你目前已是{plan.name}（{DEMO_TAG}，{periodLabel}）
      </p>
    );
  } else {
    action = (
      // 這個畫面唯一的燈色主要按鈕；按下去只改展示方案，不付款
      <Button type="button" size="lg" className="w-full" onClick={activate}>
        {current.planId === planId ? `改為${periodLabel}（模擬，不付款）` : '模擬開通（不付款）'}
      </Button>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
      <AnimatedSection className="min-w-0 lg:col-span-7">
        <Ledger
          aria-labelledby="checkout-summary-heading"
          title={<span id="checkout-summary-heading">訂單摘要</span>}
          actions={<BillingToggle value={billing} onChange={changeBilling} />}
        >
          <LedgerPanel>
            <h3 className="text-lg font-bold tracking-[0.04em]">{plan.name}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">適合{plan.audience}</p>
            <p className="mt-4 flex items-baseline gap-1">
              <span className={figureClass}>{price.amount}</span>
              <span className="text-sm text-muted-foreground">／{price.unit}</span>
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-subtle">{price.detail}</p>

            <dl className="mt-4 grid gap-px border-y bg-border text-sm">
              {[
                ['計費週期', periodLabel],
                ['開通日（展示）', today],
                ['下次續訂（展示）', demoRenewalDate({ plan: planId, billing, startedOn: today })],
              ].map(([label, value]) => (
                <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-[13.5px] tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5">
              {plan.includes ? <p className="mb-2 text-[13px] text-muted-foreground">{plan.includes}</p> : null}
              <ul className="space-y-2 text-sm leading-relaxed">
                {plan.highlights.map((item) => (
                  <li key={item.text} className="flex items-start gap-2">
                    <Check size={16} className="mt-[0.2em] shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      {item.text}
                      {item.planned ? <PlannedBadge className="ml-1.5 align-[0.1em]" /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </LedgerPanel>
        </Ledger>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          想比較其他方案？<Link href="/pricing" className={textLinkClass}>回到方案頁</Link>
        </p>
      </AnimatedSection>

      <AnimatedSection delay={0.05} className="min-w-0 lg:col-span-5">
        <Ledger aria-labelledby="checkout-payment-heading" title={<span id="checkout-payment-heading">付款</span>} stamp={DEMO_TAG}>
          <LedgerPanel>
            <div className="flex items-start gap-3 border px-3 py-3">
              <CreditCard size={20} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  信用卡（綠界 ECPay 測試環境）
                  <PlannedBadge />
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">之後會串接綠界的測試環境示範付款流程，這個階段不會連到任何付款頁。</p>
              </div>
            </div>

            <Notice tone="warning" className="mt-4">
              {PAYMENT_UNAVAILABLE}。「模擬開通」不會付款，只會把這個帳號在這台瀏覽器顯示的方案切換成{plan.name}，隨時可以在個人中心恢復免費版。
            </Notice>

            {/* 結果一直放在同一個 live region：按下模擬開通後讀屏器會念出來 */}
            <div className="mt-4" aria-live="polite">
              {result === 'failed' ? (
                <Notice tone="danger" className="mb-3">這個瀏覽器無法儲存展示方案（可能是無痕模式或封鎖了網站資料），請換一般視窗再試。</Notice>
              ) : null}
              {action}
            </div>

            <ul className="mt-5 list-disc space-y-1.5 border-t pt-4 pl-5 text-[13px] leading-relaxed text-muted-foreground marker:text-muted-foreground">
              {PRICING_SCOPE_NOTES.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Link href={DISCLAIMER_PATH} className={textLinkClass}>閱讀投資免責聲明</Link>
            </p>
          </LedgerPanel>
        </Ledger>
      </AnimatedSection>
    </div>
  );
}
