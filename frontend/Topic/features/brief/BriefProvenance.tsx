import React from 'react';
import type { EvidenceIndex } from '@/lib/brief/textBriefEvidence';
import { briefProvenance } from '@/lib/brief/provenance';
import type { TextBriefResponse } from '@/lib/types/textBrief';
import { cn } from '@/lib/cn';

/** 分析的產生條件：完整分析抽屜與可列印報告共用同一份 */
export const BriefProvenance: React.FC<{ data: TextBriefResponse; evidence: EvidenceIndex }> = ({ data, evidence }) => (
  <section aria-label="這份分析怎麼產生的" className="text-xs leading-5">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {briefProvenance(data, evidence).map((row) => (
        <div key={row.label} className={cn('min-w-0', row.wide && 'col-span-2')}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className={cn('mt-0.5 break-words text-foreground', row.mono && 'font-mono tabular-nums')}>{row.value}</dd>
        </div>
      ))}
    </dl>
    <p className="mt-2 text-muted-foreground">系統只檢查格式、引用和部分數字，沒有驗證推論是否正確。</p>
  </section>
);
