import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { UseStockTextBriefResult } from '../../lib/hooks/useStockTextBrief';
import type { UseTechnicalSignalsResult } from '../../lib/hooks/useTechnicalSignals';
import { CONF, STANCE, STANCE_TONE, type BriefTone } from '../../lib/utils/textBriefLabels';

interface Props {
  symbol: string;
  endDate: string | null;
  brief: UseStockTextBriefResult;
  signals: UseTechnicalSignalsResult;
  onOpenDetail?: () => void;
}

/** 整體看法徽章的配色；ok＝偏多（TW 紅漲），bad＝偏空（綠跌） */
const STANCE_BADGE: Record<BriefTone, string> = {
  ok: 'bg-up-muted text-up-emphasis border border-up/30',
  bad: 'bg-down-muted text-down-emphasis border border-down/30',
  warn: 'ui-alert-warning border',
  info: 'bg-brand/10 text-brand border border-brand/30',
  plain:
    'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
};

function StanceIcon({ tone }: { tone: BriefTone }) {
  if (tone === 'ok') return <TrendingUp size={14} aria-hidden className="mr-1 shrink-0" />;
  if (tone === 'bad') return <TrendingDown size={14} aria-hidden className="mr-1 shrink-0" />;
  return <Sparkles size={14} aria-hidden className="mr-1 shrink-0" />;
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

function HeroTitle({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        <BrainCircuit size={14} className="text-brand" aria-hidden />
        AI 投資分析
      </span>
      {right}
    </div>
  );
}

/**
 * Hero 的 AI 摘要卡：只講「現在是什麼狀態」，理由與依據留在抽屜裡。
 * 資料與抽屜共用同一個 useStockTextBrief 實例，不會重打一次 LLM。
 */
export const AIVerdictHeroCard: React.FC<Props> = ({
  symbol,
  endDate,
  brief,
  signals,
  onOpenDetail,
}) => {
  const { loading, error, data, seconds, run } = brief;
  const b = data?.brief;

  // 有回應但沒有 brief＝AI 寫的內容沒通過系統檢查（status unavailable），不能一直轉圈
  if (!loading && data && !b) {
    return (
      <HeroFrame>
        <div className="flex h-full flex-col items-start gap-3">
          <HeroTitle />
          <div className="ui-alert-warning flex items-start gap-2 rounded-xl border px-3 py-2 text-sm">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-warning-icon" />
            <span className="leading-relaxed">這次沒有產出分析，AI 寫的內容沒通過系統檢查。</span>
          </div>
          <button
            type="button"
            onClick={() => void run(true)}
            className="mt-auto inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
          >
            <RefreshCw size={14} aria-hidden />
            重新分析
          </button>
        </div>
      </HeroFrame>
    );
  }

  if (error && !b) {
    return (
      <HeroFrame>
        <div className="flex h-full flex-col items-start gap-3">
          <HeroTitle />
          <div className="flex items-start gap-2 rounded-xl border border-up/30 bg-up-muted px-3 py-2 text-sm text-up-emphasis">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void run(true)}
            className="mt-auto inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
          >
            <RefreshCw size={14} aria-hidden />
            重試分析
          </button>
        </div>
      </HeroFrame>
    );
  }

  if (loading || !b) {
    return (
      <HeroFrame>
        <div className="flex h-full flex-col gap-4">
          <HeroTitle
            right={
              <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                基準日 {endDate ?? '—'}
              </span>
            }
          />
          <p className="inline-flex items-center gap-2 text-sm text-brand font-medium">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
            正在分析 {symbol}…
            {loading && seconds > 0 ? (
              <span className="tabular-nums text-[var(--color-text-muted)]">{seconds} 秒</span>
            ) : null}
          </p>
          <div className="space-y-2" aria-hidden>
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[80%]" />
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[60%]" />
            <div className="h-4 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-[40%]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SignalChip label="均線" value={signals.maStructureLabel} />
            <SignalChip label="量能" value={signals.volumeConfirmLabel} />
          </div>
        </div>
      </HeroFrame>
    );
  }

  const tone: BriefTone = STANCE_TONE[b.overall_stance ?? ''] ?? 'plain';
  const stanceText = STANCE[b.overall_stance ?? ''] ?? b.overall_stance ?? '—';

  return (
    <HeroFrame>
      <div className="flex h-full flex-col gap-4">
        <HeroTitle
          right={
            <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
              分析到 {data?.as_of_date ?? endDate ?? '—'}
            </span>
          }
        />

        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold ${STANCE_BADGE[tone]}`}
            aria-label={`整體看法：${stanceText}`}
          >
            <StanceIcon tone={tone} />
            {stanceText}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            資料充分度 {CONF[b.confidence ?? ''] ?? b.confidence ?? '—'}
          </span>
        </div>

        <p className="text-sm leading-relaxed text-[var(--color-text-primary)] line-clamp-4">
          {b.headline}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <SignalChip label="均線" value={signals.maStructureLabel} />
          <SignalChip label="量能" value={signals.volumeConfirmLabel} />
        </div>

        <button
          type="button"
          onClick={onOpenDetail}
          disabled={!onOpenDetail}
          className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-bg-elevated)] border border-brand/30 px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          看為什麼
          <ArrowRight size={14} aria-hidden />
        </button>

        {error ? (
          <p className="text-[11px] text-[var(--color-text-muted)]">部分內容載入失敗：{error}</p>
        ) : null}
      </div>
    </HeroFrame>
  );
};
