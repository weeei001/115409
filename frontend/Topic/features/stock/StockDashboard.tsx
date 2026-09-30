import React, { useEffect, useMemo, useState } from 'react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { useStockTextBrief } from '@/lib/hooks/useStockTextBrief';
import { getMaStructureLabel, summarizePricePosition } from '@/lib/utils/technicalSignals';
import { useStockDisplayName } from '@/lib/utils/symbolNames';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { AIBriefSummaryCard } from '@/features/brief/AIBriefSummaryCard';
import { StockTextBriefPanel } from '@/features/brief/StockTextBriefPanel';
import { StockHero } from './StockHero';
import { StockKpiStrip } from './StockKpiStrip';
import { DetailDrawer } from './DetailDrawer';
import { MiniPriceCard } from './cards/MiniPriceCard';
import { TodayInstitutionalCard } from './cards/TodayInstitutionalCard';
import { IndicatorSignalsCard } from './cards/IndicatorSignalsCard';
import { TopNewsCard } from './cards/TopNewsCard';
import { PricePanel } from './price/PricePanel';
import { ChipsPanel } from './chips/ChipsPanel';
import { IndicatorsPanel } from './indicators/IndicatorsPanel';
import { StockNewsPanel } from './StockNewsPanel';

type DrawerKey = 'chart' | 'institutional' | 'indicators' | 'ai' | 'news';

const Hairline = () => <div aria-hidden className="h-px w-full bg-border" />;

export function StockDashboard({ dashboard }: { dashboard: UseStockDashboardResult }) {
  const { symbol, latest, loading, baseDate, priceChart, chipsLoading, institutionalLatest, indicators, indicatorLatest } = dashboard;
  const stockDisplayName = useStockDisplayName(symbol);
  const stockName = stockDisplayName === symbol ? null : stockDisplayName;
  // The latest analysis cutoff is independent of the last trading day.
  const textBrief = useStockTextBrief({ symbol });
  const maStructureLabel = useMemo(() => getMaStructureLabel(summarizePricePosition(priceChart)), [priceChart]);

  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [focusEvidenceId, setFocusEvidenceId] = useState<string | null>(null);
  const [focusClaimKey, setFocusClaimKey] = useState<string | null>(null);
  const close = () => setDrawer(null);
  const openAI = (evidenceId?: string, claimKey?: string) => {
    setFocusClaimKey(claimKey ?? null);
    setFocusEvidenceId(evidenceId ?? null);
    setDrawer('ai');
  };

  // 只在代號／基準日／就緒狀態變動時自動發動
  useEffect(() => {
    if (!symbol.trim() || loading || !baseDate || !latest) return;
    void textBrief.run();
  }, [symbol, baseDate, loading, latest]);

  if (!latest) return null;
  const subtitle = stockName ? `${symbol} ${stockName}` : symbol;

  return (
    <div className="flex flex-col gap-4">
      <AnimatedSection delay={0.05}>
        <StockHero symbol={symbol} stockName={stockName} latest={latest} priceChart={priceChart} />
      </AnimatedSection>

      <AnimatedSection delay={0.06}>
        <AIBriefSummaryCard
          symbol={symbol}
          brief={textBrief}
          endDate={baseDate}
          latestTradeDate={latest.date}
          maStructureLabel={maStructureLabel}
          onOpenDetail={openAI}
        />
      </AnimatedSection>

      <Hairline />
      <AnimatedSection delay={0.04}>
        <StockKpiStrip priceChart={priceChart} institutionalLatest={institutionalLatest} indicatorLatest={indicatorLatest} />
      </AnimatedSection>
      <Hairline />

      <AnimatedSection delay={0.05}>
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-12">
          <div className="h-full md:col-span-2 lg:col-span-6">
            <MiniPriceCard priceChart={priceChart} onOpenDetail={() => setDrawer('chart')} />
          </div>
          <div className="h-full lg:col-span-3">
            <TodayInstitutionalCard latest={institutionalLatest} loading={chipsLoading} onOpenDetail={() => setDrawer('institutional')} />
          </div>
          <div className="h-full lg:col-span-3">
            <IndicatorSignalsCard latest={indicatorLatest} loading={chipsLoading} onOpenDetail={() => setDrawer('indicators')} />
          </div>
          <div className="h-full md:col-span-2 lg:col-span-12">
            <TopNewsCard symbol={symbol} onOpenDetail={() => setDrawer('news')} />
          </div>
        </div>
      </AnimatedSection>

      <DetailDrawer open={drawer === 'chart'} onClose={close} title="價量走勢與統計" subtitle={subtitle}>
        <PricePanel dashboard={dashboard} />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'institutional'} onClose={close} title="籌碼面詳細" subtitle="三大法人買賣超與量價籌碼">
        <ChipsPanel dashboard={dashboard} />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'indicators'} onClose={close} title="技術指標詳細" subtitle="RSI / MACD / KD / 布林通道">
        <IndicatorsPanel rows={indicators} loading={chipsLoading} onRetry={dashboard.reloadChips} onWidenRange={dashboard.widenDateRange} />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'ai'} onClose={close} title="AI 投資分析" subtitle="判斷、引用依據與分析限制">
        <StockTextBriefPanel
          key={`${symbol}:${textBrief.data?.snapshot_id ?? textBrief.data?.as_of_date ?? baseDate}`}
          symbol={symbol}
          brief={textBrief}
          initialEvidenceId={focusEvidenceId}
          initialClaimKey={focusClaimKey}
          latestTradeDate={latest.date}
        />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'news'} onClose={close} title="相關新聞" subtitle={subtitle}>
        <StockNewsPanel symbol={symbol} />
      </DetailDrawer>
    </div>
  );
}
