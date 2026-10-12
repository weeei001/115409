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
import { withDateRangeHint } from '@/lib/api/errorDetail';
import { EmptyRangeActions } from '../EmptyRangeActions';
import { MaPeriodSelector } from './MaPeriodSelector';
import { HistoryTable, PriceChangeTable, StatisticsPanel, VolumeTable } from './PriceTables';
import { CsvExportButton } from '@/components/common/ExportButtons';
import { exportFileName, type CsvTable } from '@/lib/export/csv';
import { DATA_SOURCES } from '@/lib/export/sources';
import type { PriceChartData } from '@/lib/types/view';

/** 匯出圖上的每一根 K 棒：開高低收、成交量（股）與目前選的均線 */
function priceCsv(data: PriceChartData, activeMa: MaKey[], stockLabel: string, period: string | null): CsvTable {
  const volume = new Map(data.volume.map((v) => [v.time, v.value]));
  const ma = activeMa.map((key) => new Map(data.overlays[key].map((p) => [p.time, p.value])));
  return {
    title: `${stockLabel} 日 K 線`,
    source: DATA_SOURCES.price,
    period,
    columns: ['日期', '開盤', '最高', '最低', '收盤', '成交量（股）', ...activeMa],
    rows: data.candles.map((c) => [c.time, c.open, c.high, c.low, c.close, volume.get(c.time), ...ma.map((m) => m.get(c.time))]),
    notes: ['價格未還原除權息。'],
  };
}

/**
 * 「K 線與量能」抽屜內容：控制列 → K 線 → 量能／漲跌表 → 所選日期區間統計 → 歷史股價。
 * 頁面首屏已有框在圖廓裡的 K 線，這裡的圖只用一般邊框（一頁只有一個圖廓）。
 */
export function PricePanel({ dashboard, stockLabel = dashboard.symbol }: { dashboard: UseStockDashboardResult; /** 匯出檔的標題：「台積電 2330」 */ stockLabel?: string }) {
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
          {withDateRangeHint(chartError)}
        </Notice>
      ) : null}

      {/* 抽屜標題是「K 線與量能」：第一段直接寫它的內容 */}
      <Ledger
        as="h3"
        title="K 線與成交量"
        stamp={
          <span className="inline-flex items-center gap-1.5">
            <LightGlyph state={chartLoading ? 'loading' : chartError && !priceChart ? 'error' : 'ready'} />
            {span ? <span data-plotted-span>K 線 {plottedSpanText(span)}</span> : chartLoading ? '載入中…' : '尚無資料日期'}
          </span>
        }
        actions={
          priceChart && !chartLoading ? (
            <CsvExportButton
              build={() => priceCsv(priceChart, activeMa, stockLabel, plottedSpanText(span))}
              fileName={exportFileName([dashboard.symbol, '日K線', span?.last], 'csv')}
            />
          ) : null
        }
      >
        <LedgerPanel>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <MaPeriodSelector value={maPeriods} onChange={setMaPeriods} disabled={chartLoading} />
              {/* 整個標籤都能點：游標與 hover 要看得出來（03-F12） */}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-subtle transition-colors duration-(--dur-flash) hover:text-foreground">
                <Checkbox checked={showPriceChange} onCheckedChange={(v) => setShowPriceChange(v === true)} />
                顯示漲跌明細
              </label>
            </div>
          </div>
        </LedgerPanel>

        <LedgerPanel className="px-3 sm:px-5">
          {chartLoading ? (
            <LoadingRows label="載入 K 線中…" className="h-[50dvh] max-h-[420px] min-h-[280px] border-y" />
          ) : priceChart ? (
            <PriceChart
              data={priceChart}
              activeMa={activeMa}
              volumeInsight={volumeInsight}
              frame="plain"
              exportImage={{ title: `${stockLabel} 日 K 線與成交量`, source: DATA_SOURCES.price, period: plottedSpanText(span), fileName: exportFileName([dashboard.symbol, '日K線', span?.last], 'png') }}
            />
          ) : chartError ? (
            // 錯誤已在上方說明一次（含重試）：這裡只放靜止說明，不把載入失敗說成「沒有資料」
            <p className="py-16 text-center text-[13px] text-muted-foreground">K 線暫時無法顯示，請用上方的「重試」重新載入。</p>
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

      {!chartLoading && statistics ? <StatisticsPanel stats={statistics} /> : null}

      <section>
        <HistoryTable data={history} loading={historyLoading} error={historyError ? withDateRangeHint(historyError) : null} page={historyPage} pageSize={historyPageSize} onPageChange={setHistoryPage} />
      </section>
    </div>
  );
}
