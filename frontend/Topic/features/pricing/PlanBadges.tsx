import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { DEMO_TAG, planById, type PlanId } from './plans';

/** 方案相關的徽章都是中性外框（不用狀態色、漲跌色或燈色） */
const neutral = 'font-normal text-muted-foreground';

/** 規劃中的功能：虛線外框 */
export function PlannedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="outline" size="sm" className={cn('border-dashed border-input', neutral, className)}>
      規劃中
    </Badge>
  );
}

/** 目前方案：「免費版」；模擬開通的付費方案加「展示」 */
export function PlanBadge({ planId, className }: { planId: PlanId; className?: string }) {
  return (
    <Badge tone="outline" size="sm" className={cn('border-input', neutral, className)}>
      {planById(planId).name}
      {planId === 'free' ? null : ` · ${DEMO_TAG}`}
    </Badge>
  );
}

/** 功能的方案門檻：「進階版起」 */
export function MinPlanBadge({ planId, className }: { planId: PlanId; className?: string }) {
  return (
    <Badge tone="outline" size="sm" className={cn('border-input', neutral, className)}>
      {planById(planId).name}起
    </Badge>
  );
}
