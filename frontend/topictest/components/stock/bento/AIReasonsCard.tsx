import React from 'react';
import { BrainCircuit, Loader2, Sparkles } from 'lucide-react';
import type { UseAdvisorVerdictResult } from '../../../lib/hooks/useAdvisorVerdict';
import { recommendationClass, recommendationText } from '../../../lib/utils/advisorUiHelpers';
import { BentoActionButton } from './BentoActionButton';

interface Props {
  symbol: string;
  verdict: UseAdvisorVerdictResult;
  onOpenDetail: () => void;
}

export const AIReasonsCard: React.FC<Props> = ({ symbol, verdict, onOpenDetail }) => {
  const { loading, report, keyReasons } = verdict;
  const reasons = keyReasons.filter((r) => r && r !== '—').slice(0, 3);

  return (
    <div
      className="relative rounded-2xl border border-brand/25 bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px] overflow-hidden"
      style={{ boxShadow: 'inset 0 0 28px rgba(255, 169, 90, 0.06)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'var(--brand-gradient)' }}
      />
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          <BrainCircuit size={16} className="text-brand" aria-hidden />
          AI 關鍵理由
        </h3>
        {report ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${recommendationClass(report.recommendation)}`}
          >
            <Sparkles size={12} aria-hidden />
            {recommendationText(report.recommendation)}
          </span>
        ) : null}
      </div>

      {loading && !report ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <Loader2 size={18} className="text-brand animate-spin" aria-hidden />
          <p className="text-xs text-[var(--color-text-muted)]">分析 {symbol} 中…</p>
        </div>
      ) : reasons.length > 0 ? (
        <ol className="flex-1 flex flex-col gap-2 list-none">
          {reasons.map((reason, idx) => (
            <li
              key={`${reason}-${idx}`}
              className="flex gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 px-3 py-2"
            >
              <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand">
                {idx + 1}
              </span>
              <p className="text-xs leading-relaxed text-[var(--color-text-primary)] line-clamp-2">
                {reason}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          尚無分析結果
        </p>
      )}

      <BentoActionButton label="完整 AI 分析" onClick={onOpenDetail} />
    </div>
  );
};
