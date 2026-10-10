import React from 'react';
import type { PriceChartData } from '@/lib/types/view';
import { signedText } from '@/lib/utils/format';
import { LightGlyph, type LightState } from '@/components/common/Ledger';
import { getValueTone, type ValueTone } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

interface Props {
  priceChart: PriceChartData | null;
  /** 區間列（K 線）的資料狀態，寫成燈質記號 */
  chartState?: LightState;
}

interface Cell {
  label: string;
  value: string;
  /** 只有有正負方向的數值才上漲跌色（決議 D8） */
  tone: ValueTone;
}

interface Group {
  /** 這一列數字的時間窗，用文字寫出來（例如「近 63 個交易日」） */
  window: string;
  /** 時間窗的實際日期 */
  dates?: string;
  state?: LightState;
  cells: Cell[];
}

const TONE_CLASS: Record<Cell['tone'], string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-foreground',
};

function rangeGroup(priceChart: PriceChartData | null): Group {
  const candles = priceChart?.candles ?? [];
  const first = candles[0]?.close;
  const last = candles[candles.length - 1]?.close;
  const pct = candles.length && first ? ((last - first) / first) * 100 : null;
  const highs = candles.map((c) => c.high).filter(Number.isFinite);
  const lows = candles.map((c) => c.low).filter(Number.isFinite);
  const firstDate = candles[0]?.time;
  const lastDate = candles[candles.length - 1]?.time;
  return {
    window: candles.length ? `近 ${candles.length} 個交易日` : '近期交易日',
    dates: firstDate && lastDate ? `${firstDate} → ${lastDate}` : undefined,
    cells: [
      // 個股頁預設畫面唯一的區間漲跌幅：標籤直接寫出實際筆數（K 線載入的交易日數）
      { label: candles.length ? `近 ${candles.length} 個交易日漲跌幅` : '區間漲跌幅', value: pct == null || !Number.isFinite(pct) ? '--' : signedText(pct, 2, '%'), tone: getValueTone(pct) },
      { label: '區間最高', value: highs.length ? Math.max(...highs).toFixed(2) : '--', tone: 'neutral' },
      { label: '區間最低', value: lows.length ? Math.min(...lows).toFixed(2) : '--', tone: 'neutral' },
    ],
  };
}

/**
 * 個股關鍵指標：一張只有橫豎細線的燈質表（不另外框成方塊，直接印在頁面底色上）。先寫時間窗（列首），再列三格「標籤靠左、數字靠右」。
 * 桌機一列 4 格（列首＋3），手機 2 欄（列首佔一格），格數剛好整除，不露灰底。
 * 只放 K 線區間的數字；最近交易日的法人合計、RSI、MACD 柱在下方「法人與指標」，不重複（04-S2）。
 */
export function StockKpiStrip({ priceChart, chartState }: Props) {
  const groups: Group[] = [{ ...rangeGroup(priceChart), state: chartState }];

  return (
    <div className="grid gap-px border-y bg-border" role="group" aria-label="個股關鍵指標">
      {groups.map((group) => (
        <div key={group.window} data-stagger className="grid grid-cols-2 gap-px lg:grid-cols-[minmax(0,0.8fr)_repeat(3,minmax(0,1fr))]">
          {/* 列首：時間窗 */}
          <p className="flex min-h-11 min-w-0 flex-col justify-center bg-background px-3 py-2 sm:px-4 lg:pl-0">
            <span className="inline-flex items-center gap-1.5 text-[13px] leading-tight font-medium tracking-[0.04em] text-foreground">
              {group.window}
              {group.state ? <LightGlyph state={group.state} className="text-muted-foreground" /> : null}
            </span>
            {group.dates ? (
              // 日期不在中間斷行：每個日期各自不換行，必要時在箭頭處換行
              <span className="characteristic mt-0.5">
                {group.dates.split(' → ').map((d, i) => (
                  <React.Fragment key={d}>
                    {i > 0 ? ' → ' : null}
                    <span className="whitespace-nowrap">{d}</span>
                  </React.Fragment>
                ))}
              </span>
            ) : null}
          </p>
          <dl className="contents">
            {group.cells.map((cell) => (
              <div key={cell.label} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-background px-3 py-2 sm:px-4">
                <dt className="min-w-0">
                  <span className="sr-only">{group.window}</span>
                  <span className="block text-[13px] leading-tight text-subtle">{cell.label}</span>
                </dt>
                <dd className={cn('ml-auto font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums', TONE_CLASS[cell.tone])}>{cell.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
