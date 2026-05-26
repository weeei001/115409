import React, { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { UseStockDashboardResult } from '../../lib/hooks/useStockDashboard';
import { getStockDisplayName } from '../../lib/utils/symbolNames';
import { AnimatedSection } from '../AnimatedSection';
import { StatisticsPanel } from '../StatisticsPanel';
import { HistoryTable } from '../HistoryTable';
import { TradingChartSection } from './TradingChartSection';
import { InstitutionalKpiCards } from './InstitutionalKpiCards';
import { InstitutionalTabs } from './InstitutionalTabs';
import { IndicatorChartsPanel } from './IndicatorChartsPanel';
import { StockNewsPanel } from './StockNewsPanel';
import { StockAdvisorSection } from './StockAdvisorSection';
import { StockHeroSection } from './StockHeroSection';
import { StockKpiStrip } from './StockKpiStrip';
import { DetailDrawer } from './DetailDrawer';
import { MiniPriceCard } from './bento/MiniPriceCard';
import { TodayInstitutionalCard } from './bento/TodayInstitutionalCard';
import { IndicatorSignalsCard } from './bento/IndicatorSignalsCard';
import { AIReasonsCard } from './bento/AIReasonsCard';
import { RiskHintCard } from './bento/RiskHintCard';
import { TopNewsCard } from './bento/TopNewsCard';
import { useAdvisorVerdict } from '../../lib/hooks/useAdvisorVerdict';

type DrawerKey = 'chart' | 'institutional' | 'indicators' | 'ai' | 'news';

interface Props {
  dashboard: UseStockDashboardResult;
}

function Hairline() {
  return <div aria-hidden className="h-px w-full bg-[var(--color-border)]/60" />;
}

export const StockDashboardLayout: React.FC<Props> = ({ dashboard }) => {
  const {
    symbol,
    latest,
    chipsLoading,
    chipsError,
    institutionalRange,
    institutionalLatest,
    chipsVolumeRows,
    indicatorsRange,
    indicatorLatest,
    priceChart,
    chartLoading,
    chartError,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    maPeriods,
    setMaPeriods,
    statistics,
    reloadChips,
    reloadCharts,
    widenDateRange,
    history,
    historyPage,
    setHistoryPage,
    historyError,
    historyPageSize,
    volumeData,
    priceChangeData,
    showPriceChange,
    setShowPriceChange,
  } = dashboard;

  const stockName = getStockDisplayName(symbol);
  const verdict = useAdvisorVerdict({ symbol, dashboard });

  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const close = () => setDrawer(null);

  if (!latest) return null;

  return (
    <div className="flex flex-col gap-4">
      <AnimatedSection preset="fadeUp" delay={0.05}>
        <StockHeroSection
          symbol={symbol}
          stockName={stockName}
          latest={latest}
          institutionalLatest={institutionalLatest}
          indicatorLatest={indicatorLatest}
          priceChart={priceChart}
          endDate={endDate}
          verdict={verdict}
          onOpenAI={() => setDrawer('ai')}
        />
      </AnimatedSection>

      <Hairline />

      <AnimatedSection preset="fadeUp" delay={0.04}>
        <StockKpiStrip
          priceChart={priceChart}
          institutionalLatest={institutionalLatest}
          indicatorLatest={indicatorLatest}
        />
      </AnimatedSection>

      <Hairline />

      <AnimatedSection preset="fadeUp" delay={0.05}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-6 h-full">
            <MiniPriceCard priceChart={priceChart} onOpenDetail={() => setDrawer('chart')} />
          </div>
          <div className="lg:col-span-3 h-full">
            <TodayInstitutionalCard
              latest={institutionalLatest}
              loading={chipsLoading}
              onOpenDetail={() => setDrawer('institutional')}
            />
          </div>
          <div className="lg:col-span-3 h-full">
            <IndicatorSignalsCard
              indicatorLatest={indicatorLatest}
              indicatorsRange={indicatorsRange}
              loading={chipsLoading}
              onOpenDetail={() => setDrawer('indicators')}
            />
          </div>

          <div className="lg:col-span-4 h-full">
            <AIReasonsCard symbol={symbol} verdict={verdict} onOpenDetail={() => setDrawer('ai')} />
          </div>
          <div className="lg:col-span-4 h-full">
            <RiskHintCard verdict={verdict} />
          </div>
          <div className="lg:col-span-4 h-full">
            <TopNewsCard symbol={symbol} onOpenDetail={() => setDrawer('news')} />
          </div>
        </div>
      </AnimatedSection>

      {/* Drawers: lazy-mount content to avoid unnecessary ECharts / API calls when closed */}
      <DetailDrawer
        open={drawer === 'chart'}
        onClose={close}
        title="價量走勢與統計"
        subtitle={`${symbol} ${stockName}`}
      >
        {drawer === 'chart' ? (
          <div className="flex flex-col gap-5">
            {chartError ? (
              <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis flex items-center justify-between gap-3">
                <span>{chartError}</span>
                <button
                  type="button"
                  onClick={reloadCharts}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-up/30 text-xs font-medium text-up-emphasis cursor-pointer"
                >
                  <RefreshCw size={14} aria-hidden />
                  重試
                </button>
              </div>
            ) : null}
            <TradingChartSection
              chart={priceChart}
              loading={chartLoading}
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              maPeriods={maPeriods}
              onMaPeriodsChange={setMaPeriods}
              maSelectorDisabled={false}
              compactChart={false}
              volumeData={volumeData}
              priceChangeData={priceChangeData}
              showPriceChange={showPriceChange}
              onShowPriceChangeChange={setShowPriceChange}
            />
            {statistics ? (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
                <StatisticsPanel stats={statistics} />
              </div>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>

      <DetailDrawer
        open={drawer === 'institutional'}
        onClose={close}
        title="籌碼面詳細"
        subtitle="三大法人買賣超與量價籌碼"
      >
        {drawer === 'institutional' ? (
          <div className="flex flex-col gap-5">
            {chipsError ? (
              <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis flex items-center justify-between gap-3">
                <span>{chipsError}</span>
                <button
                  type="button"
                  onClick={reloadChips}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-up/30 text-xs font-medium text-up-emphasis cursor-pointer"
                >
                  <RefreshCw size={14} aria-hidden />
                  重試
                </button>
              </div>
            ) : null}
            <InstitutionalKpiCards latest={institutionalLatest} loading={chipsLoading} />
            <InstitutionalTabs
              institutionalRange={institutionalRange}
              institutionalLatest={institutionalLatest}
              chipsVolumeRows={chipsVolumeRows}
              loading={chipsLoading}
              error={chipsError}
            />
            {historyError ? (
              <p className="text-sm text-up-emphasis" role="alert">
                {historyError}
              </p>
            ) : null}
            {history ? (
              <HistoryTable
                data={history}
                page={historyPage}
                pageSize={historyPageSize}
                onPageChange={setHistoryPage}
              />
            ) : !historyError ? (
              <p className="text-sm text-[var(--color-text-muted)]" aria-live="polite">
                載入歷史股價…
              </p>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>

      <DetailDrawer
        open={drawer === 'indicators'}
        onClose={close}
        title="技術指標詳細"
        subtitle="RSI / MACD / KD / 布林通道"
      >
        {drawer === 'indicators' ? (
          <IndicatorChartsPanel
            data={indicatorsRange}
            loading={chipsLoading}
            onRetry={reloadChips}
            onWidenRange={widenDateRange}
          />
        ) : null}
      </DetailDrawer>

      <DetailDrawer
        open={drawer === 'ai'}
        onClose={close}
        title="AI 投資分析"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate">情境推演、訊號與資料快照</span>
            {verdict.generatedAtLabel ? (
              <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-muted)]">分析</span>
                <span className="tabular-nums">{verdict.generatedAtLabel}</span>
              </span>
            ) : null}
            {verdict.report?.date_start && verdict.report?.date_end ? (
              <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-muted)]">區間</span>
                <span className="tabular-nums">
                  {verdict.report.date_start} ～ {verdict.report.date_end}
                </span>
              </span>
            ) : null}
          </div>
        }
        headerActions={
          <button
            type="button"
            onClick={() => void verdict.runAnalysis(true)}
            disabled={verdict.loading || dashboard.loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/10 to-brand/5 dark:from-brand/20 dark:to-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition-[opacity,background-color] hover:bg-brand/15 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            aria-label="重新分析"
          >
            {verdict.loading ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            <span className="hidden sm:inline">{verdict.loading ? '分析中…' : '重新分析'}</span>
          </button>
        }
      >
        {drawer === 'ai' ? (
          <StockAdvisorSection
            symbol={symbol}
            dashboard={dashboard}
            verdict={verdict}
            variant="drawer"
          />
        ) : null}
      </DetailDrawer>

      <DetailDrawer
        open={drawer === 'news'}
        onClose={close}
        title="相關新聞"
        subtitle={`${symbol} ${stockName}`}
      >
        {drawer === 'news' ? <StockNewsPanel symbol={symbol} /> : null}
      </DetailDrawer>
    </div>
  );
};
