import React from 'react';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import type { UseStockTextBriefResult } from '../../lib/hooks/useStockTextBrief';

interface Props {
  brief: UseStockTextBriefResult;
  onOpenDetail?: () => void;
}

/** 取 text-brief 的第一項風險當頁面上方的提醒；完整清單在 AI 分析抽屜裡 */
export const RiskHintNotice: React.FC<Props> = ({ brief, onOpenDetail }) => {
  const risk = brief.data?.brief?.risks?.[0];
  if (!risk) return null;

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
      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning-icon" aria-hidden />
      <p className="flex-1 line-clamp-2">
        <span className="font-semibold mr-1">風險提醒</span>
        {risk.risk_type ? `${risk.risk_type}：` : ''}
        {risk.description}
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
