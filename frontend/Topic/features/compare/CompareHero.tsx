import React from 'react';
import { AlertTriangle, Info, Layers, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  symbols: string[];
  symbolColors: Record<string, string>;
  startDate: string;
  endDate: string;
  alignedDays: number;
  onJumpToControls: () => void;
}

function summarize(symbols: string[]): string {
  if (symbols.length === 0) return '尚未選擇股票';
  if (symbols.length <= 3) return symbols.join('、');
  return `${symbols.slice(0, 3).join('、')} 等 ${symbols.length} 檔`;
}

type AlignedTone = 'ok' | 'warn' | 'danger';

const alignedTone = (days: number): AlignedTone => (days < 5 ? 'danger' : days < 20 ? 'warn' : 'ok');

function alignedHint(tone: AlignedTone, days: number): string {
  if (tone === 'danger') return `共同交易日僅 ${days} 天，波動與相關係數可能極不穩定`;
  if (tone === 'warn') return `共同交易日 ${days} 天，相關係數穩定性較低`;
  return `共同交易日 ${days} 天`;
}

const TONE_PILL: Record<AlignedTone, string> = {
  ok: 'border-border bg-muted text-subtle',
  warn: 'border-warning-border bg-warning-muted text-warning',
  danger: 'border-danger-border bg-danger-muted text-danger',
};

/** 比較概覽：比了哪些股票、哪段期間、共同交易日夠不夠 */
export function CompareHero({ symbols, symbolColors, startDate, endDate, alignedDays, onJumpToControls }: Props) {
  const tone = alignedTone(alignedDays);
  return (
    <section data-stagger className="relative overflow-hidden rounded-2xl border border-brand/25 bg-card shadow-card">
      <div aria-hidden className="bg-brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px" />
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Layers size={14} className="text-brand" aria-hidden />
            <span>比較概覽</span>
          </div>
          <h2 className="text-base font-bold tracking-tight sm:text-lg">
            {summarize(symbols)} 在 {startDate} 至 {endDate} 的表現對比
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle tabular-nums">
            <span>已選 {symbols.length} 檔</span>
            <span aria-hidden>·</span>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', TONE_PILL[tone])}>
              {tone !== 'ok' ? <AlertTriangle size={11} aria-hidden /> : null}
              {alignedHint(tone, alignedDays)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {symbols.map((sym) => (
              <span key={sym} className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 font-mono text-xs tabular-nums">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                {sym}
              </span>
            ))}
          </div>
          <div className="space-y-1 pt-2 text-[11px] leading-snug text-muted-foreground">
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
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border bg-muted px-4 py-2 text-sm text-subtle transition-colors hover:border-brand/50 hover:text-brand-text"
        >
          <RotateCcw size={15} aria-hidden />
          換股 / 換期間
        </button>
      </div>
    </section>
  );
}
