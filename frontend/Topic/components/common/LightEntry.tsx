import React from 'react';
import { fmtPrice } from '@/lib/utils/format';
import { getValueTone, toneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

/** 帶正負號的漲跌；負號用 U+2212，和數字等寬 */
export function signedText(value: number | null | undefined, decimals = 2, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '--';
  const abs = Math.abs(value).toFixed(decimals);
  if (value > 0) return `+${abs}${suffix}`;
  if (value < 0) return `−${abs}${suffix}`;
  return `${abs}${suffix}`;
}

export interface LightEntryProps {
  symbol: string;
  name?: string;
  industry?: string | null;
  close?: number | null;
  change?: number | null;
  changePercent?: number | null;
  /** 資料日（YYYY-MM-DD） */
  date?: string | null;
  selected?: boolean;
  /** 名稱右側（例如走勢線） */
  extra?: React.ReactNode;
  /** 列尾（例如取消收藏鈕）；放在按鈕外面，避免巢狀互動元素 */
  trailing?: React.ReactNode;
  onSelect?: (symbol: string) => void;
  className?: string;
}

/**
 * 條目列：全站共用的一筆股票。代號是編號、產業是所屬海岸、收盤／漲跌／資料日是它的燈質。
 * 漲跌依數值正負上色（DESIGN.md 第 7 節），並且一律帶正負號，不只靠顏色。
 */
export function LightEntry({ symbol, name, industry, close, change, changePercent, date, selected, extra, trailing, onSelect, className }: LightEntryProps) {
  const tone = toneText(getValueTone(change));
  const body = (
    <>
      <span className="w-14 shrink-0 font-mono text-[13.5px] font-medium tabular-nums">{symbol}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name || symbol}</span>
        {industry || date ? (
          <span className="block truncate text-xs text-muted-foreground">
            {[industry, date ? `收 ${date}` : null].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
      {extra}
      <span className="shrink-0 text-right font-mono text-[13.5px] tabular-nums">
        <span className="block font-medium">{fmtPrice(close)}</span>
        <span className={cn('block text-xs', tone)}>
          {signedText(change)}
          {changePercent != null && Number.isFinite(changePercent) ? `（${signedText(changePercent, 2, '%')}）` : ''}
        </span>
      </span>
    </>
  );
  const rowClass = cn('lamp-row flex min-h-14 w-full items-center gap-3 bg-card px-4 py-2 text-left sm:px-5', className);
  if (!onSelect) {
    return (
      <div className={rowClass} data-selected={selected ? 'true' : undefined}>
        {body}
        {trailing}
      </div>
    );
  }
  return (
    <div className="flex items-stretch bg-card">
      <button
        type="button"
        onClick={() => onSelect(symbol)}
        data-selected={selected ? 'true' : undefined}
        aria-pressed={selected}
        aria-label={`${symbol} ${name ?? ''}`.trim()}
        className={cn(rowClass, 'min-w-0 flex-1')}
      >
        {body}
      </button>
      {trailing}
    </div>
  );
}
