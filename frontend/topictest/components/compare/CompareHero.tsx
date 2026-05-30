import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Info, Layers, RotateCcw } from 'lucide-react';
import { COMPARE_COLOR_PALETTE } from '../../lib/utils/compare';
import { usePrefersReducedMotionClient } from '../../lib/usePrefersReducedMotionClient';

interface Props {
  symbols: string[];
  symbolColors: Record<string, string>;
  startDate: string;
  endDate: string;
  alignedDays?: number;
  onJumpToControls: () => void;
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

function summarize(symbols: string[]): string {
  if (symbols.length === 0) return '尚未選擇股票';
  if (symbols.length <= 3) return symbols.join('、');
  return `${symbols.slice(0, 3).join('、')} 等 ${symbols.length} 檔`;
}

type AlignedTone = 'ok' | 'warn' | 'danger';

function getAlignedTone(days: number | undefined): AlignedTone {
  if (days == null) return 'ok';
  if (days < 5) return 'danger';
  if (days < 20) return 'warn';
  return 'ok';
}

function alignedHint(tone: AlignedTone, days: number): string {
  if (tone === 'danger') return `共同交易日僅 ${days} 天，波動與相關係數可能極不穩定`;
  if (tone === 'warn') return `共同交易日 ${days} 天，相關係數穩定性較低`;
  return `共同交易日 ${days} 天`;
}

const TONE_PILL_CLASS: Record<AlignedTone, string> = {
  ok: 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 text-[var(--color-text-secondary)]',
  warn: 'border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300',
  danger: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

export const CompareHero: React.FC<Props> = ({
  symbols,
  symbolColors,
  startDate,
  endDate,
  alignedDays,
  onJumpToControls,
}) => {
  const reduceMotion = usePrefersReducedMotionClient();
  const tone = getAlignedTone(alignedDays);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.4 }}
      className="relative rounded-2xl border border-brand/25 bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] overflow-hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'var(--brand-gradient)' }}
      />
      <div className="px-5 py-5 sm:px-6 sm:py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Layers size={14} className="text-brand" aria-hidden />
            <span>比較概覽</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)] tracking-tight">
            {summarize(symbols)} 在 {startDate} 至 {endDate} 的表現對比
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)] tabular-nums">
            <span>已選 {symbols.length} 檔</span>
            <span aria-hidden>·</span>
            {alignedDays != null ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${TONE_PILL_CLASS[tone]}`}
                title={alignedHint(tone, alignedDays)}
              >
                {tone !== 'ok' && <AlertTriangle size={11} aria-hidden />}
                {alignedHint(tone, alignedDays)}
              </span>
            ) : (
              <span>比較區間</span>
            )}
          </div>
          {symbols.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {symbols.map((sym) => {
                const color = symbolColors[sym] ?? fallbackColor(sym);
                return (
                  <span
                    key={sym}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 px-2.5 py-1 text-xs font-mono tabular-nums text-[var(--color-text-primary)]"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    {sym}
                  </span>
                );
              })}
            </div>
          )}
          <div className="pt-2 space-y-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
            <p className="flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span>本比較僅含技術面與籌碼面，不含基本面（EPS、本益比等）、產業類別與大盤對標。</span>
            </p>
            <p className="pl-[18px]">※ 資料為市場資訊呈現，非投資建議。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onJumpToControls}
          className="shrink-0 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-brand/50 hover:text-brand cursor-pointer"
        >
          <RotateCcw size={15} aria-hidden />
          換股 / 換期間
        </button>
      </div>
    </motion.section>
  );
};
