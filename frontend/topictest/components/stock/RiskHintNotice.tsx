import React from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import type { UseAdvisorVerdictResult } from '../../lib/hooks/useAdvisorVerdict';
import { getRiskToneText } from '../../lib/utils/advisorUiHelpers';

interface Props {
  verdict: UseAdvisorVerdictResult;
  onOpenDetail?: () => void;
}

export const RiskHintNotice: React.FC<Props> = ({ verdict, onOpenDetail }) => {
  const { report, pricePosition } = verdict;
  if (!report) return null;

  const riskText = getRiskToneText(report, pricePosition);
  if (!riskText) return null;

  return (
    <div
      role="note"
      aria-label="風險提醒"
      className="flex items-start gap-2.5 rounded-xl border px-3 py-2 text-xs leading-relaxed"
      style={{
        backgroundColor: 'var(--color-warning-bg)',
        borderColor: 'var(--color-warning-border)',
        color: 'var(--color-warning-text)',
      }}
    >
      <ShieldAlert
        size={14}
        className="mt-0.5 shrink-0 text-warning-icon"
        aria-hidden
      />
      <p className="flex-1 line-clamp-2">
        <span className="font-semibold mr-1">風險提醒</span>
        {riskText}
      </p>
      {onOpenDetail ? (
        <button
          type="button"
          onClick={onOpenDetail}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold hover:bg-[var(--color-warning-border)]/40 transition-colors cursor-pointer"
          aria-label="開啟完整 AI 分析"
        >
          詳情
          <ArrowRight size={11} aria-hidden />
        </button>
      ) : null}
    </div>
  );
};
