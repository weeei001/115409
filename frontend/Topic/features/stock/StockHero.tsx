import { Minus, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { MA_KEYS, type MaKey } from '@/lib/types/view';
import { fmtPrice } from '@/lib/utils/format';
import { getValueTone, toneText } from '@/lib/utils/tone';
import { PriceChart } from '@/components/charts/PriceChart';
import { DataStamp, type LightState } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { signedText } from '@/components/common/LightEntry';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { EmptyRangeActions } from './EmptyRangeActions';

interface Props {
  dashboard: UseStockDashboardResult;
  /** 開啟「價量走勢與統計」抽屜（均線週期、日期區間、量能表、歷史股價） */
  onOpenDetail: () => void;
}

/** 首屏主圖的繪圖區高度：桌機約 420px、手機 320px */
const HERO_PLOT_HEIGHT = 'h-[320px] lg:h-[420px]';

/**
 * 個股首屏：本頁唯一的主圖。收盤價（Figure XL）與帶正負號的日漲跌在上，
 * 下面是框在圖廓裡的 K 線（沿用儀表板已載入的資料，不另外抓），最後一列是昨收／開／高／低。
 * 公司名稱已在頁首 h1，這裡不重複；「非即時」也只在頁首副標題說一次。
 */
export function StockHero({ dashboard, onOpenDetail }: Props) {
  const { latest, priceChart, chartLoading, chartError, reloadCharts, widenDateRange, maPeriods, volumeInsight } = dashboard;
  if (!latest) return null;

  const close = latest.close ?? 0;
  const change = latest.change ?? 0;
  const prevClose = close - change;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : null;
  const tone = getValueTone(latest.change);
  const TrendIcon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Minus;
  const activeMa = MA_KEYS.filter((key) => maPeriods.split(',').includes(key.slice(2))) as MaKey[];
  // 燈質：K 線讀取中＝Q、已載入＝F、讀取失敗且沒有舊資料＝熄燈
  const chartState: LightState = chartLoading ? 'loading' : chartError && !priceChart ? 'error' : 'ready';
  // 圖廓的光束只在 K 線資料到達（或換了日期區間）時掃一次：用資料的起訖日當 key 重新掛載圖表；
  // 換均線週期、開關序列、滑過、切主題都不會改變這個 key
  const firstCandle = priceChart?.candles[0]?.time;
  const lastCandle = priceChart?.candles[priceChart.candles.length - 1]?.time;
  const beamKey = `${dashboard.symbol}:${firstCandle ?? ''}:${lastCandle ?? ''}`;

  const metrics = [
    { label: '昨收', value: prevClose > 0 ? fmtPrice(prevClose) : '--' },
    { label: '開盤', value: fmtPrice(latest.open) },
    { label: '最高', value: fmtPrice(latest.high) },
    { label: '最低', value: fmtPrice(latest.low) },
  ];

  const retry = (
    <Button type="button" size="sm" variant="outline" onClick={reloadCharts}>
      <RefreshCw aria-hidden />
      重新載入
    </Button>
  );

  return (
    <section aria-labelledby="stock-hero-heading" className="min-w-0">
      <h2 id="stock-hero-heading" className="sr-only">
        最近儲存收盤行情與 K 線
      </h2>

      {/* 讀數：收盤價是全頁最大的數字，日漲跌緊貼在旁邊 */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border-strong pb-3">
        <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-1">
          <p className="font-mono text-[clamp(40px,5vw,64px)] leading-[0.95] font-semibold tracking-[-0.01em] tabular-nums">
            <span className="sr-only">收盤價 </span>
            {fmtPrice(latest.close)}
          </p>
          <p className="flex flex-col gap-0.5 pb-0.5">
            <span className={cn('inline-flex items-center gap-1.5 font-mono text-lg leading-tight font-medium whitespace-nowrap tabular-nums', toneText(tone))}>
              <TrendIcon size={17} aria-hidden />
              <span>{signedText(latest.change)}</span>
              <span>（{signedText(changePct, 2, '%')}）</span>
            </span>
            <span className="characteristic">元 · 較前一交易日</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <DataStamp date={latest.date} state={chartState} />
          <Button type="button" variant="outline" onClick={onOpenDetail}>
            詳細 K 線與量能
          </Button>
        </div>
      </div>

      <div className="pt-3">
        {chartLoading && !priceChart ? (
          <LoadingRows label="讀取 K 線中…" className={cn('border bg-card', HERO_PLOT_HEIGHT)} />
        ) : priceChart ? (
          <PriceChart key={beamKey} data={priceChart} activeMa={activeMa} volumeInsight={volumeInsight} compact heightClassName={HERO_PLOT_HEIGHT} />
        ) : chartError ? (
          <Notice tone="danger" action={retry}>
            {chartError}
          </Notice>
        ) : (
          <EmptyState
            className={cn('border bg-card', HERO_PLOT_HEIGHT)}
            action={<EmptyRangeActions onWidenRange={widenDateRange} onRetry={reloadCharts} />}
          >
            所選日期區間沒有 K 線資料
          </EmptyState>
        )}
      </div>

      {/* 燈質列：昨收／開／高／低，一列用細線分隔，不另外框成方塊 */}
      <dl className="mt-3 grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4" aria-label={`${latest.date ?? '最近交易日'} 開高低與昨收`}>
        {metrics.map((m) => (
          <div key={m.label} className="flex items-baseline justify-between gap-3 bg-background px-3 py-2.5 sm:block sm:px-4 sm:first:pl-0">
            <dt className="characteristic">{m.label}</dt>
            <dd className="font-mono text-[15px] font-medium tabular-nums sm:mt-0.5">{m.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
