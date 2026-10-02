import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { MA_KEYS, type MaKey } from '@/lib/types/view';
import { PriceChart } from '@/components/charts/PriceChart';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { MaPeriodSelector } from './MaPeriodSelector';
import { HistoryTable, PriceChangeTable, StatisticsPanel, VolumeTable } from './PriceTables';

/** 「價量走勢與統計」抽屜內容 */
export function PricePanel({ dashboard }: { dashboard: UseStockDashboardResult }) {
  const {
    priceChart,
    chartLoading,
    chartError,
    reloadCharts,
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
  const lastDate = priceChart?.candles[priceChart.candles.length - 1]?.time;

  return (
    <div className="flex flex-col gap-5">
      {chartError ? (
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="outline" onClick={reloadCharts} className="min-h-9">
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {chartError}
        </Notice>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold">價量走勢</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastDate ? `資料截至 ${lastDate}` : '尚無資料日期'}；非即時行情，依已匯入資料顯示；展示用途，非投資建議。
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
            <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <MaPeriodSelector value={maPeriods} onChange={setMaPeriods} disabled={chartLoading} />
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-subtle">
                <Checkbox checked={showPriceChange} onCheckedChange={(v) => setShowPriceChange(v === true)} />
                顯示漲跌明細
              </label>
            </div>
          </div>
        </div>

        {chartLoading ? (
          <div className="flex h-[50dvh] max-h-[420px] min-h-[280px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={20} className="animate-spin text-brand" aria-hidden />
            載入圖表中…
          </div>
        ) : priceChart ? (
          <PriceChart data={priceChart} activeMa={activeMa} volumeInsight={volumeInsight} />
        ) : (
          <EmptyState className="py-16">尚無 K 線資料</EmptyState>
        )}

        {!chartLoading ? (
          <div className="mt-6 space-y-6 border-t pt-6">
            <VolumeTable data={volumeData} />
            {showPriceChange ? <PriceChangeTable data={priceChangeData} /> : null}
          </div>
        ) : null}
      </section>

      {statistics ? <StatisticsPanel stats={statistics} /> : null}

      <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
        {historyLoading ? (
          <p className="text-sm text-muted-foreground" role="status">載入歷史股價…</p>
        ) : historyError ? (
          <Notice tone="danger">{historyError}</Notice>
        ) : history ? (
          <HistoryTable data={history} page={historyPage} pageSize={historyPageSize} onPageChange={setHistoryPage} />
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            載入歷史股價…
          </p>
        )}
      </section>
    </div>
  );
}
