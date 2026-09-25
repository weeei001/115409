import React from 'react';
import { AlertTriangle, Info, Layers, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';

interface Props {
  symbols: string[];
  symbolColors: Record<string, string>;
  stockInfos: Record<string, StockInfo>;
  requestedRange: { startDate: string; endDate: string };
  analysisRange: { startDate: string; endDate: string } | null;
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
  if (tone === 'danger') return `共同日漲跌樣本僅 ${days} 筆，波動與相關係數可能極不穩定`;
  if (tone === 'warn') return `共同日漲跌樣本 ${days} 筆，相關係數穩定性較低`;
  return `共同日漲跌樣本 ${days} 筆`;
}

const TONE_PILL: Record<AlignedTone, string> = {
  ok: 'border-border bg-muted text-subtle',
  warn: 'border-warning-border bg-warning-muted text-warning',
  danger: 'border-danger-border bg-danger-muted text-danger',
};

/** Summarize company context and the actual comparison window. */
export function CompareHero({ symbols, symbolColors, stockInfos, requestedRange, analysisRange, alignedDays, onJumpToControls }: Props) {
  const tone = alignedTone(alignedDays);
  const industries = symbols.map((symbol) => stockInfos[symbol]?.industry?.trim());
  const context = symbols.length < 2
    ? '請選擇至少兩檔股票，再比較產業背景與價格表現。'
    : industries.some((industry) => !industry)
      ? '部分股票產業未提供，暫時無法判斷是否為同產業比較。'
      : new Set(industries).size === 1
        ? '同產業比較：可觀察價格表現與風險差異；相同產業分類不代表商業模式相同。'
        : '跨產業比較：先看價格表現與風險差異；產業背景不同，不能據此判斷公司經營優劣。';
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
            {summarize(symbols)} 的{symbols.length >= 2 ? '價格表現比較' : '價格表現'}
          </h2>
          <p className="text-xs leading-relaxed text-subtle">{context}</p>
          <p className="text-xs text-muted-foreground tabular-nums">選擇期間：{requestedRange.startDate} 至 {requestedRange.endDate}</p>
          <p className="text-xs text-subtle tabular-nums">
            {analysisRange
              ? `實際比較期間：${analysisRange.startDate} 至 ${analysisRange.endDate}`
              : '共同價格資料不足，無法建立實際比較期間或計算期間漲跌。'}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle tabular-nums">
            <span>已選 {symbols.length} 檔</span>
            <span aria-hidden>·</span>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', TONE_PILL[tone])}>
              {tone !== 'ok' ? <AlertTriangle size={11} aria-hidden /> : null}
              {analysisRange ? alignedHint(tone, alignedDays) : '共同日漲跌樣本不足'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {symbols.map((sym) => (
              <span key={sym} className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 font-mono text-xs tabular-nums">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: symbolColors[sym] }} aria-hidden />
                {sym} {stockInfos[sym]?.name?.trim() || ''}
                <span className="font-sans text-muted-foreground">{stockInfos[sym]?.industry?.trim() || '產業未提供'}</span>
              </span>
            ))}
          </div>
          <div className="space-y-1 pt-2 text-[11px] leading-snug text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span>以產業背景輔助解讀價格、基本面與籌碼差異，並以加權價格指數對照。個股價格漲跌不含股息，未調整除權息與分割；各項資料期間另行標示。</span>
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
