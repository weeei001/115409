import React, { useCallback, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { GitCompare, X } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { IndustrySearch } from '@/components/common/IndustrySearch';
import { Notice } from '@/components/common/Notice';
import { StockSearch } from '@/components/common/StockSearch';
import { CategoryLeaders } from '@/features/compare/CategoryLeaders';
import { CompareHero } from '@/features/compare/CompareHero';
import { ComparisonChart } from '@/features/compare/ComparisonChart';
import { CorrelationPanel } from '@/features/compare/CorrelationPanel';
import { InstitutionalComparePanel } from '@/features/compare/InstitutionalComparePanel';
import { MethodologyPanel } from '@/features/compare/MethodologyPanel';
import { MetricsTable } from '@/features/compare/MetricsTable';
import { RiskReturnScatter } from '@/features/compare/RiskReturnScatter';
import { SnapshotCard } from '@/features/compare/SnapshotCard';
import { TechnicalSnapshotTable } from '@/features/compare/TechnicalSnapshotTable';
import { useCompare } from '@/features/compare/useCompare';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import type { CompareChartMode } from '@/lib/types/compare';
import { alignComparePrices, buildSymbolColorMap } from '@/lib/utils/compare';
import { cn } from '@/lib/cn';
import { FundamentalsPanel } from '@/features/compare/FundamentalsPanel';
import { buildBenchmarkComparison } from '@/lib/utils/compareBenchmark';

export default function ComparePage() {
  const c = useCompare();
  const [chartMode, setChartMode] = useState<CompareChartMode>('index100');
  const controlsRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  const jumpToControls = useCallback(() => {
    controlsRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [reduceMotion]);

  const availableSymbols = c.allSymbols.filter((s) => !c.selected.includes(s));
  const stockInfos = useMemo(() => Object.values(c.stockInfos), [c.stockInfos]);
  const result = c.result;
  const metrics = result?.metrics ?? null;
  const viewModel = metrics?.viewModel ?? null;
  const symbols = result?.symbols ?? [];
  const colors = useMemo(() => buildSymbolColorMap(symbols), [symbols]);
  const alignedChart = useMemo(() => result?.chart ? alignComparePrices(result.chart) : null, [result?.chart]);
  const benchmarkComparison = useMemo(() => buildBenchmarkComparison(result?.chart ?? null, metrics?.benchmark ?? null), [result?.chart, metrics?.benchmark]);
  const loading = c.chartLoading || c.metricsLoading;

  return (
    <>
      <Head>
        <title>股海明燈｜多股比較</title>
        <meta name="description" content="結合產業背景，以共同期間比較多檔台股的價格漲跌、波動、回撤、法人買賣超與相關性。" />
      </Head>
      <SiteHeader icon={GitCompare} title="多股比較" subtitle="先看產業背景，再用相同期間比較價格表現、風險與彼此關係。" />

      <main aria-label="多股比較" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <AnimatedSection delay={0.05}>
          <div ref={controlsRef} className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border bg-card p-5 shadow-card sm:p-6">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.65fr)_auto] lg:items-end">
              <StockSearch
                className="min-w-0 flex-1"
                symbols={availableSymbols}
                stockInfos={stockInfos}
                onSelect={c.addSymbol}
                onBulkSelect={c.handleBulkSelect}
                placeholder="新增代號或公司名稱"
              />
              <IndustrySearch
                stockInfos={stockInfos}
                supportedSymbols={c.allSymbols}
                selectedSymbols={c.selected}
                onSelect={(symbols) => c.handleBulkSelect(symbols.join(','))}
              />
              <DateRangePicker
                className="shrink-0 lg:ml-1 lg:border-l lg:pl-5"
                startDate={c.startDate}
                endDate={c.endDate}
                onStartChange={c.setStartDate}
                onEndChange={c.setEndDate}
              />
            </div>

            <div className="flex items-center justify-end gap-3 text-xs text-subtle">
              {c.selected.length > 0 ? (
                <button
                  type="button"
                  onClick={c.clearAll}
                  className="min-h-9 rounded-lg border px-3 py-1 text-subtle transition-colors hover:border-danger-border hover:text-danger"
                >
                  清空全部
                </button>
              ) : null}
            </div>

            {c.selected.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="已選股票">
                {c.selected.map((sym) => (
                  <li
                    key={sym}
                    className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/5 py-1 pr-1 pl-3 font-mono text-sm font-medium text-brand-text dark:bg-brand/15"
                  >
                    {sym} {c.stockInfos[sym]?.name ?? ''}
                    <span className="font-sans text-xs text-muted-foreground">{c.stockInfos[sym]?.industry?.trim() || '產業未提供'}</span>
                    <button
                      type="button"
                      onClick={() => c.removeSymbol(sym)}
                      aria-label={`移除 ${sym}`}
                      className="flex size-8 items-center justify-center rounded-full text-brand-text/70 transition-colors hover:bg-danger-muted hover:text-danger"
                    >
                      <X size={14} strokeWidth={2.5} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {c.error ? <Notice tone="danger">{c.error}</Notice> : null}
            {c.metadataWarning ? <Notice tone="warning">{c.metadataWarning}</Notice> : null}
            {c.metricsError ? <Notice tone="danger">{c.metricsError}</Notice> : null}
            {c.warnings.length > 0 ? (
              <Notice tone="warning">
                <span className="block space-y-1 text-xs">
                  {c.warnings.map((w) => (
                    <span key={w} className="block">
                      • {w}
                    </span>
                  ))}
                </span>
              </Notice>
            ) : null}

            <button
              type="button"
              onClick={() => void c.compare()}
              disabled={loading || c.selected.length === 0}
              className="bg-brand-gradient min-h-11 w-full rounded-2xl px-8 py-3 text-[15px] font-semibold text-on-brand shadow-md shadow-brand/25 transition-[box-shadow,filter,opacity] hover:shadow-lg hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none sm:w-auto sm:self-start"
            >
              {c.chartLoading ? '載入主圖資料...' : c.metricsLoading ? '計算比較指標...' : '開始比較'}
            </button>

            {loading ? (
              <div className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
                {c.chartLoading ? <p>主圖資料載入中...</p> : null}
                {c.metricsLoading && c.metricsProgress ? (
                  <p>
                    指標資料載入中：{c.metricsProgress.done}/{c.metricsProgress.total}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </AnimatedSection>

        {viewModel ? (
          <AnimatedSection>
            <CompareHero
              symbols={symbols}
              symbolColors={colors}
              stockInfos={c.stockInfos}
              requestedRange={viewModel.qualityMeta.requestedRange}
              analysisRange={viewModel.qualityMeta.analysisRange}
              alignedDays={viewModel.qualityMeta.alignedDays}
              onJumpToControls={jumpToControls}
            />
          </AnimatedSection>
        ) : null}

        {result?.chart ? (
          <AnimatedSection>
            <ComparisonChart
              data={result.chart}
              symbols={symbols}
              mode={chartMode}
              onModeChange={setChartMode}
              symbolColors={colors}
              benchmark={metrics?.benchmark ?? null}
              benchmarkLoading={c.metricsLoading}
            />
          </AnimatedSection>
        ) : null}

        {metrics ? (
          <AnimatedSection delay={0.05}>
            <CategoryLeaders leaders={metrics.leaders} symbolColors={colors} />
          </AnimatedSection>
        ) : null}

        {viewModel && alignedChart ? (
          <section aria-label="個股快照網格">
            <h2 className="sr-only">個股快照</h2>
            <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4', symbols.length > 2 && 'lg:grid-cols-3')}>
              {symbols.map((sym) => (
                <SnapshotCard
                  key={sym}
                  symbol={sym}
                  stockInfos={c.stockInfos}
                  color={colors[sym]}
                  data={alignedChart}
                  returnPct={viewModel.metricsRows.find((r) => r.symbol === sym)?.totalReturnPct ?? null}
                />
              ))}
            </div>
          </section>
        ) : null}

        {viewModel && viewModel.metricsRows.length > 0 ? (
          <>
            <AnimatedSection>
              <MetricsTable rows={viewModel.metricsRows} symbolColors={colors} benchmarkReturnPct={benchmarkComparison.returnPct} />
            </AnimatedSection>
            <AnimatedSection>
              <RiskReturnScatter rows={viewModel.metricsRows} symbolColors={colors} />
            </AnimatedSection>
          </>
        ) : null}

        {metrics ? (
          <>
            <AnimatedSection>
              <FundamentalsPanel symbols={symbols} data={metrics.fundamentals} endDate={metrics.fundamentalsEndDate} />
            </AnimatedSection>
            <AnimatedSection>
              <InstitutionalComparePanel
                symbols={symbols}
                institutionalMap={metrics.institutionalMap}
                aggregateMap={metrics.aggregateMap}
                symbolColors={colors}
              />
            </AnimatedSection>
            <AnimatedSection>
              <TechnicalSnapshotTable symbols={symbols} latestMap={metrics.technicalLatestMap} symbolColors={colors} />
            </AnimatedSection>
            <AnimatedSection>
              <CorrelationPanel symbols={symbols} matrix={metrics.viewModel.correlationMatrix} sampleCounts={metrics.viewModel.correlationSamples} />
            </AnimatedSection>
            <AnimatedSection>
              <MethodologyPanel qualityMeta={metrics.viewModel.qualityMeta} />
            </AnimatedSection>
          </>
        ) : null}
      </main>
    </>
  );
}
