import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { StockTextBriefPanel } from './textBrief/StockTextBriefPanel';
import { AIBriefSummaryCard } from './textBrief/AIBriefSummaryCard';
import { StockHeroSection } from './StockHeroSection';
import { StockKpiStrip } from './StockKpiStrip';
import { DetailDrawer } from './DetailDrawer';
import { MiniPriceCard } from './bento/MiniPriceCard';
import { TodayInstitutionalCard } from './bento/TodayInstitutionalCard';
import { IndicatorSignalsCard } from './bento/IndicatorSignalsCard';
import { TopNewsCard } from './bento/TopNewsCard';
import { useStockTextBrief } from '../../lib/hooks/useStockTextBrief';
import { useTechnicalSignals } from '../../lib/hooks/useTechnicalSignals';

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
  // 全頁只有這一份 AI 分析：Hero 卡片、風險提醒與 AI 抽屜共用同一個 text-brief 實例。
  const textBrief = useStockTextBrief({ symbol, asOfDate: endDate ?? undefined });
  const signals = useTechnicalSignals(priceChart);

  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  // 從摘要卡的來源標籤點進來時，完整分析要先亮那一筆證據
  const [focusEvidenceId, setFocusEvidenceId] = useState<string | null>(null);
  const [focusClaimKey, setFocusClaimKey] = useState<string | null>(null);
  const close = () => setDrawer(null);
  const openAI = (evidenceId?: string, claimKey?: string) => {
    setFocusClaimKey(claimKey ?? null);
    setFocusEvidenceId(evidenceId ?? null);
    setDrawer('ai');
  };

  // 基準日確定、報價也回來了才發動；同一組 symbol＋基準日只會打一次
  useEffect(() => {
    if (!symbol.trim() || dashboard.loading || !endDate || !latest) return;
    void textBrief.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在代號／基準日／就緒狀態變更時自動分析
  }, [symbol, endDate, dashboard.loading, latest]);

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
        />
      </AnimatedSection>

      <AnimatedSection preset="fadeUp" delay={0.06}>
        <AIBriefSummaryCard
          symbol={symbol}
          brief={textBrief}
          endDate={endDate}
          latestTradeDate={latest.date}
          maStructureLabel={signals.maStructureLabel}
          onOpenDetail={openAI}
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

          <div className="lg:col-span-12 h-full">
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
        subtitle="判斷、引用依據與分析限制"
      >
        {drawer === 'ai' ? (
          <StockTextBriefPanel
            key={`${symbol}:${textBrief.data?.snapshot_id ?? textBrief.data?.as_of_date ?? endDate}`}
            symbol={symbol}
            brief={textBrief}
            initialEvidenceId={focusEvidenceId}
            initialClaimKey={focusClaimKey}
            latestTradeDate={latest.date}
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
