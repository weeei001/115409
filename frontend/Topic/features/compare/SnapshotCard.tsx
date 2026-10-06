import { useMemo } from 'react';
import { Sparkline } from '@/components/common/Sparkline';
import { plottedSpan, plottedSpanText } from '@/lib/charts/adapters';
import { signedText } from '@/components/common/LightEntry';
import type { MultiStockResponse, StockInfo } from '@/lib/types/api';
import { fmtPrice } from '@/lib/utils/format';
import { getValueTone, valueToneText } from '@/lib/utils/tone';

interface Props {
  symbol: string;
  color: string;
  stockInfos: Record<string, StockInfo>;
  /** 已對齊的實際比較期間（alignComparePrices 的結果），和區間漲跌幅同一段 */
  data: MultiStockResponse;
  /** Closing-price change over the shared analysis window. */
  returnPct: number | null;
}

const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 實際比較期間內這檔的每一個有效收盤；中間缺值跳過並計數，頭尾兩列由 alignComparePrices 保證有價 */
function windowCloses(data: MultiStockResponse, symbol: string): { closes: number[]; missing: number } {
  const closes = data.data.map((row) => row.prices[symbol]).filter(isPrice);
  return { closes, missing: data.data.length - closes.length };
}

/**
 * 個股快照＝一筆條目：代表色條、等寬代號、名稱與產業，右側是共同區間最後收盤與帶正負號的區間漲跌幅；
 * 下方是同一段實際比較期間的收盤走勢線（百分比、走勢線、線色都對應同一段，不另取近 N 日）。外框由父層的帳頁細線負責。
 */
export function SnapshotCard({ symbol, color, stockInfos, data, returnPct }: Props) {
  const { closes, missing } = useMemo(() => windowCloses(data, symbol), [data, symbol]);
  const tone = getValueTone(returnPct);
  const name = stockInfos[symbol]?.name?.trim() || '';
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  // 期間標示和主圖一樣以整段交易日計；缺收盤的日子在線上直接連過去，另外寫出天數
  const span = plottedSpanText(plottedSpan(data.data.map((row) => row.date)));
  const spanText = span ? `收盤走勢 ${span}${missing > 0 ? `；缺 ${missing} 日收盤，前後直接連線` : ''}` : null;
  return (
    <article aria-label={`${symbol} ${name} 比較快照`.replace(/\s+/g, ' ')} data-stagger className="flex h-full flex-col bg-card">
      <header className="relative flex min-h-14 items-center gap-3 py-2 pr-4 pl-5 sm:pr-5 sm:pl-6">
        <span className="absolute inset-y-2 left-0 w-[3px]" style={{ backgroundColor: color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[13.5px] font-medium tabular-nums">{symbol}</span>
            <span className="truncate text-sm font-medium">{name}</span>
          </h3>
          <p className="truncate text-xs text-muted-foreground">{stockInfos[symbol]?.industry?.trim() || '產業未提供'}</p>
        </div>
        <p className="shrink-0 text-right font-mono text-[13.5px] tabular-nums">
          <span className="block font-medium">{fmtPrice(lastClose)}</span>
          <span className="block text-xs">
            <span className="font-sans text-muted-foreground">區間漲跌幅 </span>
            <span className={valueToneText(returnPct)}>{signedText(returnPct, 2, '%')}</span>
          </span>
        </p>
      </header>
      {/* 手機只留條目列：走勢已在上方主圖，迷你線在 sm 以上才畫 */}
      <div className="mx-4 hidden min-h-[60px] flex-1 border-t pt-3 pb-4 sm:mx-5 sm:block">
        {closes.length >= 2 ? (
          <>
            <Sparkline values={closes} trend={tone === 'neutral' ? 'flat' : tone} className="h-[56px]" />
            {spanText ? <p className="characteristic mt-2" data-plotted-span>{spanText}</p> : null}
          </>
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">走勢資料不足，無法畫出走勢線。</p>
        )}
      </div>
    </article>
  );
}
