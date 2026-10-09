import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { parseStockNewsView, stockNewsViewHref, STOCK_NEWS_VIEW_PARAM } from '@/lib/news/stockNewsView';
import { useDrawerHistory } from '@/lib/navigation/drawerHistory';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import { useStockTextBrief } from '@/lib/hooks/useStockTextBrief';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Ledger, NextStep, type LightState } from '@/components/common/Ledger';
import { AIBriefSummaryCard } from '@/features/brief/AIBriefSummaryCard';
import { StockTextBriefPanel } from '@/features/brief/StockTextBriefPanel';
import { AITrackRecordCard } from '@/features/brief/AITrackRecordCard';
import { StockHero } from './StockHero';
import { StockKpiStrip } from './StockKpiStrip';
import { DetailDrawer } from './DetailDrawer';
import { LatestInstitutionalCard } from './cards/LatestInstitutionalCard';
import { IndicatorSignalsCard } from './cards/IndicatorSignalsCard';
import { TopNewsCard } from './cards/TopNewsCard';
import { PricePanel } from './price/PricePanel';
import { ChipsPanel } from './chips/ChipsPanel';
import { IndicatorsPanel } from './indicators/IndicatorsPanel';
import { StockNewsPanel } from './StockNewsPanel';

type DrawerKey = 'chart' | 'institutional' | 'indicators' | 'ai' | 'news';

interface Props {
  dashboard: UseStockDashboardResult;
  /** 查不到中文名為 null（名稱由頁面查一次後傳進來） */
  stockName: string | null;
}

export function StockDashboard({ dashboard, stockName }: Props) {
  const router = useRouter();
  const { symbol, latest, loading, baseDate, priceChart, chipsLoading, institutionalLatest, indicators, indicatorLatest } = dashboard;
  // 燈質記號：讀取中＝Q、已載入＝F、讀取失敗（且沒有可顯示的舊資料）＝熄燈；只用 hook 已有的狀態
  const chartState: LightState = dashboard.chartLoading ? 'loading' : dashboard.chartError && !priceChart ? 'error' : 'ready';
  // 法人與指標各看各的端點：只有一支失敗時，失敗的那一格熄燈並顯示錯誤
  const institutionalState: LightState = chipsLoading ? 'loading' : dashboard.institutionalError ? 'error' : 'ready';
  const indicatorsState: LightState = chipsLoading ? 'loading' : dashboard.indicatorsError ? 'error' : 'ready';
  // The latest analysis cutoff is independent of the last trading day.
  const textBrief = useStockTextBrief({ symbol });

  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const newsView = parseStockNewsView(router.query[STOCK_NEWS_VIEW_PARAM], symbol);
  const [focusEvidenceId, setFocusEvidenceId] = useState<string | null>(null);
  const [focusClaimKey, setFocusClaimKey] = useState<string | null>(null);
  const closeNow = () => {
    setDrawer(null);
    if (newsView) void router.replace(stockNewsViewHref(router.asPath, null), undefined, { shallow: true, scroll: false });
  };
  // 手機按上一頁（返回鍵）先關抽屜，不離開個股頁（P2-054）
  const requestClose = useDrawerHistory(drawer !== null || Boolean(newsView), closeNow);
  const close = () => requestClose(closeNow);
  const openNews = () => {
    setDrawer(null);
    void router.replace(stockNewsViewHref(router.asPath, {
      version: 1, symbol, relation: 'direct', page: 1, filters: {},
    }), undefined, { shallow: true, scroll: false });
  };
  const openAI = (evidenceId?: string, claimKey?: string) => {
    setFocusClaimKey(claimKey ?? null);
    setFocusEvidenceId(evidenceId ?? null);
    setDrawer('ai');
  };

  // 個股資料就緒後自動讀取 AI 分析；只在代號或就緒狀態變動時發動
  const ready = !loading && Boolean(latest);
  useEffect(() => {
    if (!symbol.trim() || !ready) return;
    void textBrief.run();
  }, [symbol, ready]);

  if (!latest) return null;
  const subtitle = stockName ? `${symbol} ${stockName}` : symbol;

  return (
    <div className="flex flex-col gap-10 lg:gap-16">
      {/* 首屏：本頁唯一的主圖（收盤價＋K 線圖廓＋開高低），緊接區間的關鍵指標 */}
      <AnimatedSection delay={0.05} className="flex flex-col gap-6">
        <StockHero dashboard={dashboard} onOpenDetail={() => setDrawer('chart')} />
        <StockKpiStrip priceChart={priceChart} chartState={chartState} />
      </AnimatedSection>

      {/* 帳頁：法人 6／指標 6；手機單欄。日期寫在各格底部的戳記。
          標準指標排在 AI 分析之前；法人合計、RSI、MACD 柱只在這裡出現一次，不在 KPI 列重複（04-S2） */}
      <AnimatedSection delay={0.05}>
        <Ledger title="法人與指標" cols="grid-cols-1 md:grid-cols-2">
          <LatestInstitutionalCard
            latest={institutionalLatest}
            loading={chipsLoading}
            state={institutionalState}
            error={dashboard.institutionalError}
            onOpenDetail={() => setDrawer('institutional')}
            onRetry={dashboard.reloadChips}
          />
          <IndicatorSignalsCard
            latest={indicatorLatest}
            loading={chipsLoading}
            state={indicatorsState}
            error={dashboard.indicatorsError}
            onOpenDetail={() => setDrawer('indicators')}
            onRetry={dashboard.reloadChips}
          />
        </Ledger>
      </AnimatedSection>

      <AnimatedSection delay={0.06}>
        <AIBriefSummaryCard
          symbol={symbol}
          brief={textBrief}
          endDate={baseDate}
          latestTradeDate={latest.date}
          onOpenDetail={openAI}
        />
      </AnimatedSection>

      <AnimatedSection delay={0.06}>
        <AITrackRecordCard symbol={symbol} />
      </AnimatedSection>

      <AnimatedSection delay={0.05}>
        <TopNewsCard symbol={symbol} onOpenDetail={openNews} />
      </AnimatedSection>

      {/* 頁尾只有一個下一步 */}
      <nav aria-label="下一步" className="border-y border-border-strong">
        <NextStep href="/compare">和同產業的股票比較</NextStep>
      </nav>

      {/* 抽屜標題和開啟它的按鈕用同一組字（05、04 一致性表） */}
      <DetailDrawer open={drawer === 'chart'} onClose={close} title="K 線與量能" subtitle={subtitle}>
        <PricePanel dashboard={dashboard} />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'institutional'} onClose={close} title="籌碼明細" subtitle="三大法人買賣超與量價籌碼">
        <ChipsPanel dashboard={dashboard} />
      </DetailDrawer>
      <DetailDrawer open={drawer === 'indicators'} onClose={close} title="技術指標明細" subtitle="RSI、MACD、KD、布林通道">
        <IndicatorsPanel
          rows={indicators}
          loading={chipsLoading}
          error={dashboard.indicatorsError}
          onRetry={dashboard.reloadChips}
          onWidenRange={dashboard.widenDateRange}
        />
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
      <DetailDrawer open={Boolean(newsView)} onClose={close} title="相關新聞" subtitle={subtitle}>
        {newsView && <StockNewsPanel symbol={symbol} initialView={newsView} />}
      </DetailDrawer>
    </div>
  );
}
