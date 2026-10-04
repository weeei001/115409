import { RefreshCw } from 'lucide-react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { MA_KEYS, type MaKey } from '@/lib/types/view';
import { PriceChart } from '@/components/charts/PriceChart';
import { plottedSpan, plottedSpanText } from '@/lib/charts/adapters';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { Ledger, LedgerPanel, LightGlyph } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { EmptyRangeActions } from '../EmptyRangeActions';
import { MaPeriodSelector } from './MaPeriodSelector';
import { HistoryTable, PriceChangeTable, StatisticsPanel, VolumeTable } from './PriceTables';

/**
 * 「價量走勢與統計」抽屜內容：控制列 → K 線 → 量能／漲跌表 → 所選日期區間統計 → 歷史股價。
 * 頁面首屏已有框在圖廓裡的 K 線，這裡的圖只用一般邊框（一頁只有一個圖廓）。
 */
export function PricePanel({ dashboard }: { dashboard: UseStockDashboardResult }) {
  const {
    priceChart,
    chartLoading,
    chartError,
    reloadCharts,
    widenDateRange,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    maPeriods,
    setMaPeriods,
    showPriceChange,
    setShowPriceChange,
    volumeData,
    volumeInsight,
    priceChangeData,
    statistics,
    history,
    historyPage,
    setHistoryPage,
    historyError,
    historyLoading,
    historyPageSize,
  } = dashboard;

  const activeMa = MA_KEYS.filter((key) => maPeriods.split(',').includes(key.slice(2))) as MaKey[];
  // 圖說取自圖上實際畫出的 K 棒，不是日期選擇器的查詢區間
  const span = plottedSpan(priceChart?.candles.map((c) => c.time));

  return (
    <div className="flex flex-col gap-10">
      {chartError ? (
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="outline" onClick={reloadCharts} className="min-h-11">
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {chartError}
        </Notice>
      ) : null}

      {/* 抽屜標題是「價量走勢與統計」：第一段不再叫「價量走勢」，直接寫它的內容 */}
      <Ledger
        as="h3"
        title="K 線與成交量"
        stamp={
          <span className="inline-flex items-center gap-1.5">
            <LightGlyph state={chartLoading ? 'loading' : chartError && !priceChart ? 'error' : 'ready'} />
            {span ? <span data-plotted-span>K 線 {plottedSpanText(span)}</span> : chartLoading ? '讀取中…' : '尚無資料日期'}
          </span>
        }
      >
        <LedgerPanel>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <MaPeriodSelector value={maPeriods} onChange={setMaPeriods} disabled={chartLoading} />
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-subtle">
                <Checkbox checked={showPriceChange} onCheckedChange={(v) => setShowPriceChange(v === true)} />
                顯示漲跌明細
              </label>
            </div>
          </div>
        </LedgerPanel>

        <LedgerPanel className="px-3 sm:px-5">
          {chartLoading ? (
            <LoadingRows label="讀取 K 線中…" className="h-[50dvh] max-h-[420px] min-h-[280px] border-y" />
          ) : priceChart ? (
            <PriceChart data={priceChart} activeMa={activeMa} volumeInsight={volumeInsight} frame="plain" />
          ) : (
            <EmptyState
              className="py-16"
              action={<EmptyRangeActions onWidenRange={widenDateRange} onRetry={reloadCharts} />}
            >
              所選日期區間沒有 K 線資料
            </EmptyState>
          )}
        </LedgerPanel>

        {!chartLoading ? (
          <LedgerPanel className="space-y-8">
            <VolumeTable data={volumeData} />
            {showPriceChange ? <PriceChangeTable data={priceChangeData} /> : null}
          </LedgerPanel>
        ) : null}
      </Ledger>

      {statistics ? <StatisticsPanel stats={statistics} /> : null}

      <section>
        {historyLoading ? (
          <LoadingRows label="讀取歷史股價中…" className="h-[132px] border-y" />
        ) : historyError ? (
          <Notice tone="danger">{historyError}</Notice>
        ) : history ? (
          <HistoryTable data={history} page={historyPage} pageSize={historyPageSize} onPageChange={setHistoryPage} />
        ) : (
          <LoadingRows label="讀取歷史股價中…" className="h-[132px] border-y" />
        )}
      </section>
    </div>
  );
}
