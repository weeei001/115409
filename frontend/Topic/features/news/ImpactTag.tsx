import React from 'react';
import type { NewsImpactDirection } from '@/lib/types/api';
import { DIRECTION_LABELS, DIRECTION_TONE } from '@/lib/utils/newsImpact';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

/** 方向前面的正負號：正向「+」、負向「−」（U+2212），其餘不加；不只靠顏色表達方向 */
const DIRECTION_SIGN: Partial<Record<NewsImpactDirection, string>> = { positive: '+', negative: '−' };

/**
 * 事件影響方向標籤：帶正負號的文字，正向用漲色、負向用跌色，其餘中性（DESIGN.md 第 7 節）。
 * 配色只來自 lib/utils/newsImpact.ts 的 DIRECTION_TONE（全站徽章色 toneBadge）。
 */
export function ImpactDirectionTag({ direction, children, className }: { direction: NewsImpactDirection; children?: React.ReactNode; className?: string }) {
  const sign = DIRECTION_SIGN[direction];
  return (
    <Badge tone={DIRECTION_TONE[direction]} emphasis className={cn('py-px leading-5', className)}>
      {children}
      <span>
        {sign ? <span aria-hidden className="font-mono">{sign}</span> : null}
        {DIRECTION_LABELS[direction]}
      </span>
    </Badge>
  );
}
