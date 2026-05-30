import React from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';

interface Props {
  summary: string;
  asOfDate?: string;
}

/** 後端在 LLM 結構化輸出失敗時，會把 summary 設成包含 "fallback" 字樣的訊息。 */
function isFallbackSummary(text: string): boolean {
  return /fallback|結構化輸出失敗|非有效分析結果/i.test(text);
}

export const AISummaryCard: React.FC<Props> = ({ summary, asOfDate }) => {
  const text = summary?.trim();
  if (!text) return null;

  const fallback = isFallbackSummary(text);

  if (fallback) {
    return (
      <section
        role="alert"
        aria-label="AI 分析失敗"
        className="ui-alert-warning rounded-2xl border p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-icon" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">AI 分析失敗</p>
              {asOfDate ? (
                <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                  {asOfDate}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm leading-6">{text}</p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              本次未取得有效 AI 結構化結果，下方數據與推演僅作背景參考；可點上方「重新分析」再試一次。
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="AI 總結"
      className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:p-6 shadow-[var(--shadow-card)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ background: 'var(--brand-gradient)' }}
      />
      <div className="pl-2 sm:pl-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-brand uppercase tracking-wider">
            <Sparkles size={14} aria-hidden />
            AI 總結
          </div>
          {asOfDate ? (
            <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
              {asOfDate}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm sm:text-base leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap">
          {text}
        </p>
      </div>
    </section>
  );
};
