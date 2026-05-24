import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { UseAdvisorVerdictResult } from '../../../lib/hooks/useAdvisorVerdict';
import { getRiskToneText } from '../../../lib/utils/advisorUiHelpers';

interface Props {
  verdict: UseAdvisorVerdictResult;
}

export const RiskHintCard: React.FC<Props> = ({ verdict }) => {
  const { report, pricePosition, loading } = verdict;
  const riskText = report ? getRiskToneText(report, pricePosition) : null;

  return (
    <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 dark:bg-amber-950/15 dark:border-amber-800/30 shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px]">
      <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
        <ShieldAlert size={16} className="text-amber-600 dark:text-amber-400" aria-hidden />
        風險提醒
      </h3>

      {loading && !report ? (
        <div className="space-y-2 flex-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse" />
          ))}
        </div>
      ) : riskText ? (
        <p className="flex-1 text-xs leading-relaxed text-[var(--color-text-primary)] line-clamp-6">
          {riskText}
        </p>
      ) : (
        <p className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          尚未取得風險評估
        </p>
      )}

      <p className="mt-auto min-h-[36px] flex items-center text-[10px] text-[var(--color-text-muted)] leading-snug">
        本內容由 AI 整理，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。
      </p>
    </div>
  );
};
