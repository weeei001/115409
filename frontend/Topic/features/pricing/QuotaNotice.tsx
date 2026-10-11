import React from 'react';
import Link from 'next/link';
import { Notice } from '@/components/common/Notice';
import { textLinkClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** 額度提示：資訊色的提示框加「查看方案」，不用警告色（只是提示，不是錯誤或風險） */
export function QuotaNotice({ children, extraLink, className }: { children: React.ReactNode; extraLink?: React.ReactNode; className?: string }) {
  return (
    <Notice tone="info" className={cn('text-[13px] leading-relaxed', className)}>
      {children}
      <span className="mt-1 flex flex-wrap gap-x-4">
        {extraLink}
        <Link href="/pricing" className={textLinkClass}>查看方案</Link>
      </span>
    </Notice>
  );
}
