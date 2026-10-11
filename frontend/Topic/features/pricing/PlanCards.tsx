import React from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { LedgerPanel, figureClass } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PlannedBadge } from './PlanBadges';
import {
  BILLING_PERIODS,
  DEMO_TAG,
  PLANS,
  formatTwd,
  yearlyInMonths,
  yearlyPerMonth,
  type BillingPeriod,
  type Plan,
  type PlanId,
} from './plans';

export function BillingToggle({ value, onChange }: { value: BillingPeriod; onChange: (value: BillingPeriod) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="square"
      spacing={1}
      value={value}
      onValueChange={(next) => next && onChange(next as BillingPeriod)}
      aria-label="計費週期"
    >
      {BILLING_PERIODS.map((period) => (
        <ToggleGroupItem key={period.value} value={period.value} className="min-w-16">
          {period.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** 價格讀數：年繳另外寫折合每月與等於幾個月 */
export function planPriceText(plan: Plan, billing: BillingPeriod): { amount: string; unit: string; detail: string } {
  const unit = BILLING_PERIODS.find((period) => period.value === billing)?.unit ?? '';
  const months = yearlyInMonths(plan);
  if (months == null) return { amount: formatTwd(0), unit, detail: '不需付款' };
  if (billing === 'yearly') {
    return { amount: formatTwd(plan.price.yearly), unit, detail: `折合每月 ${formatTwd(yearlyPerMonth(plan))}，等於 ${months} 個月的月費` };
  }
  return { amount: formatTwd(plan.price.monthly), unit, detail: `改年繳 ${formatTwd(plan.price.yearly)}，等於 ${months} 個月的月費` };
}

/** 結帳示意頁的網址（方案與計費週期帶在查詢字串） */
export const checkoutHref = (planId: PlanId, billing: BillingPeriod): string => `/checkout?plan=${planId}&billing=${billing}`;

const planRank = (id: PlanId): number => PLANS.findIndex((plan) => plan.id === id);

/** 不能按的說明格（目前方案、免費版的說明）：虛線外框，和按鈕同高 */
function StaticAction({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-11 items-center gap-2 border border-dashed border-input px-3 text-sm text-subtle">
      <Check size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

interface PlanCardProps {
  plan: Plan;
  billing: BillingPeriod;
  /** 目前帳號的展示方案 */
  currentPlanId: PlanId;
  /** 這張卡的升級鈕用燈色（一個畫面只放一顆主要按鈕） */
  primary?: boolean;
}

/**
 * 方案卡：名稱與適合誰 → 價格 → 動作 → 功能與額度。
 * 付費方案的按鈕帶到結帳示意頁（不接金流）；目前方案標「目前方案」。
 */
export function PlanCard({ plan, billing, currentPlanId, primary = false }: PlanCardProps) {
  const headingId = `plan-${plan.id}-name`;
  const price = planPriceText(plan, billing);
  const current = plan.id === currentPlanId;

  let action: React.ReactNode;
  if (current) {
    action = <StaticAction>目前方案{plan.id === 'free' ? '' : `（${DEMO_TAG}）`}</StaticAction>;
  } else if (plan.id === 'free') {
    action = (
      <StaticAction>
        可在<Link href="/me" className="mx-0.5 underline decoration-input underline-offset-4 hover:decoration-foreground">個人中心</Link>恢復免費版
      </StaticAction>
    );
  } else {
    action = (
      <Button asChild variant={primary ? 'default' : 'outline'} className="w-full">
        <Link href={checkoutHref(plan.id, billing)}>{planRank(plan.id) > planRank(currentPlanId) ? '升級到' : '改為'}{plan.name}</Link>
      </Button>
    );
  }

  return (
    <LedgerPanel as="section" aria-labelledby={headingId} data-current={current || undefined} className="flex flex-col">
      <h3 id={headingId} className="text-lg font-bold tracking-[0.04em]">{plan.name}</h3>
      {/* 桌機三欄並排時保留兩行高，價格才會對齊 */}
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground md:min-h-[2lh]">適合{plan.audience}</p>

      <p className="mt-4 flex items-baseline gap-1">
        <span className={figureClass}>{price.amount}</span>
        <span className="text-sm text-muted-foreground">／{price.unit}</span>
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-subtle">{price.detail}</p>

      <div className="mt-4">{action}</div>

      <div className="mt-5 border-t pt-4">
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
  );
}
