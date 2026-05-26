import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { recommendationClass, recommendationText } from '../../lib/utils/advisorUiHelpers';
import type { UseAdvisorVerdictResult } from '../../lib/hooks/useAdvisorVerdict';

interface Props {
  symbol: string;
  endDate: string | null;
  verdict: UseAdvisorVerdictResult;
  onOpenDetail?: () => void;
}

function SignalChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5">
      <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-[var(--color-text-primary)] leading-tight">
        {value}
      </p>
    </div>
  );
}

function HeroFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative h-full rounded-2xl border border-brand/30 bg-[var(--color-bg-card)] p-5 sm:p-6 shadow-[var(--shadow-card)] overflow-hidden"
      style={{ boxShadow: 'inset 0 0 28px rgba(255, 169, 90, 0.08)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'var(--brand-gradient)' }}
      />
      {children}
    </div>
  );
}

export const AIVerdictHeroCard: React.FC<Props> = ({ symbol, endDate, verdict, onOpenDetail }) => {
  const {
    loading,
    error,
    report,
    progress,
    runAnalysis,
    headlineReason,
    generatedAtLabel,
    maStructureLabel,
    volumeConfirmLabel,
  } = verdict;

  const hasPartial = Boolean(report);
  const showFullCard = Boolean(report);
  const stillFinalizing = loading && progress?.pendingFinal;

  if (error && !report) {
    return (
      <HeroFrame>
        <div className="flex h-full flex-col items-start gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            <BrainCircuit size={14} className="text-brand" aria-hidden />
            AI 投資分析
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-up/30 bg-up-muted px-3 py-2 text-sm text-up-emphasis">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void runAnalysis(true)}
            className="mt-auto inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
          >
            <RefreshCw size={14} aria-hidden />
            重試分析
          </button>
        </div>
      </HeroFrame>
    );
  }

  if (!showFullCard) {
    return (
      <HeroFrame>
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              <BrainCircuit size={14} className="text-brand" aria-hidden />
              AI 投資分析
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
              基準日 {endDate ?? '—'}
            </span>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-brand font-medium">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
            正在分析 {symbol}…
          </p>
          <div className="space-y-2" aria-hidden>
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[80%]" />
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[60%]" />
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[40%]" />
          </div>
          <p className="mt-auto text-xs text-[var(--color-text-muted)] leading-relaxed">
            RAG 約數秒、AI 模型常需 1～3 分鐘；完成後此卡會立即更新。
          </p>
        </div>
      </HeroFrame>
    );
  }

  return (
    <HeroFrame>
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            <BrainCircuit size={14} className="text-brand" aria-hidden />
            AI 投資分析
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
            {generatedAtLabel}
          </span>
        </div>

        <div className="min-w-0">
          <span
            className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${recommendationClass(
              report!.recommendation
            )}`}
            aria-label={`AI 建議：${recommendationText(report!.recommendation)}`}
          >
            <Sparkles size={14} aria-hidden className="mr-1 shrink-0" />
            建議：{recommendationText(report!.recommendation)}
          </span>
          {stillFinalizing ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={12} className="animate-spin shrink-0 text-brand" aria-hidden />
              完整分析載入中…
            </p>
          ) : null}
        </div>

        <p className="text-sm leading-relaxed text-[var(--color-text-primary)] line-clamp-3">
          {headlineReason || '正在整理 AI 觀點，請稍候…'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <SignalChip label="均線" value={maStructureLabel} />
          <SignalChip label="量能" value={volumeConfirmLabel} />
        </div>

        <button
          type="button"
          onClick={onOpenDetail}
          disabled={!onOpenDetail}
          className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-bg-elevated)] border border-brand/30 px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          查看完整 AI 分析
          <ArrowRight size={14} aria-hidden />
        </button>

        {hasPartial && error ? (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            部分區塊載入失敗：{error}
          </p>
        ) : null}
      </div>
    </HeroFrame>
  );
};
