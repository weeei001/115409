import React, { useCallback, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { GitCompare, X } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { IndustrySearch } from '@/components/common/IndustrySearch';
import { Ledger, LedgerPanel, LightGlyph, NextStep, type LightState } from '@/components/common/Ledger';
import { EmptyState, Notice } from '@/components/common/Notice';
import { StockSearch } from '@/components/common/StockSearch';
import { Button } from '@/components/ui/button';
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
import { AnalysisIndex } from '@/features/compare/AnalysisIndex';
import {
  correlationFinding,
  fundamentalsFinding,
  institutionalFinding,
  methodFinding,
  scatterFinding,
  technicalFinding,
} from '@/features/compare/analysisFindings';
import { buildBenchmarkComparison } from '@/lib/utils/compareBenchmark';

/** 載入＝燈質 Q：有線的空白列（DESIGN.md 第 10 節） */
function QRows({ label, className }: { label: string; className?: string }) {
  return (
    <section aria-hidden className="min-w-0">
      <div className="border-b border-border-strong pb-2">
        <span className="characteristic inline-flex items-center gap-1.5">
          <LightGlyph state="loading" />
          {label}
        </span>
      </div>
      <div className={cn('q-rows border-x border-b bg-card', className)} />
    </section>
  );
}

/** 還沒比較時：說清楚按下「開始比較」會得到什麼（三列，不放圖示） */
const OUTPUTS: Array<[string, string]> = [
  ['航跡圖', '各檔與加權指數在共同起日換算成 100 的走勢，可切換報價與區間漲跌幅。'],
  ['比較指標表', '區間漲跌幅、年化波動、最大回撤、上漲日比例與平均成交量，點欄位排序。'],
  ['延伸分析', '一張索引表：波動與漲跌幅分佈、基本面、三大法人、技術指標快照、相關性與計算方法，各附一句發現。'],
];

function CompareOutputs() {
  return (
    <section aria-labelledby="compare-outputs-heading" className="-mt-4 min-w-0 lg:-mt-8">
      <h2 id="compare-outputs-heading" className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">
        加入兩檔以上股票並按「開始比較」，會產出
      </h2>
      <dl className="mt-2 divide-y border-y border-t-border-strong">
        {OUTPUTS.map(([term, desc]) => (
          <div key={term} className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="font-serif text-[17px] font-black tracking-[0.06em]">{term}</dt>
            <dd className="text-[15px] leading-relaxed text-subtle">{desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function ComparePage() {
  const c = useCompare();
  const [chartMode, setChartMode] = useState<CompareChartMode>('index100');
  const controlsRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  // 這一頁已經掃過圖廓光束的資料（換股或換期間才再掃；比較指標算完、外層重新掛載時不重掃）
  const sweptBeams = useRef(new Set<string>()).current;

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
  // 已選清單依目前順序取色，和按下「開始比較」後各圖表的顏色一致（決議 c76）
  const selectedColors = useMemo(() => buildSymbolColorMap(c.selected), [c.selected]);
  const alignedChart = useMemo(() => result?.chart ? alignComparePrices(result.chart) : null, [result?.chart]);
  const benchmarkComparison = useMemo(() => buildBenchmarkComparison(result?.chart ?? null, metrics?.benchmark ?? null), [result?.chart, metrics?.benchmark]);
  const loading = c.chartLoading || c.metricsLoading;
  // 實際比較期間內的交易日數＝主圖畫出的點數（共同起訖日之間的合併交易日）
  const tradingDays = alignedChart?.data.length || null;
  // 燈質記號：股票清單讀取中＝Q、讀不到＝熄燈、可用＝F
  const pickerState: LightState = c.allSymbols.length ? 'ready' : c.error ? 'error' : 'loading';
  const resultState: LightState = loading ? 'loading' : 'ready';

  const chartPanel = result?.chart ? (
    <ComparisonChart
      data={result.chart}
      symbols={symbols}
      mode={chartMode}
      onModeChange={setChartMode}
      symbolColors={colors}
      benchmark={metrics?.benchmark ?? null}
      benchmarkLoading={c.metricsLoading}
      sweptBeams={sweptBeams}
    />
  ) : null;

  // 圖下的條目：每檔一格（代表色條、代號、名稱、最後收盤、期間漲跌、近期走勢）
  const snapshotEntries = viewModel && alignedChart ? (
    <LedgerPanel padded={false} aria-label="個股快照">
      {/* 格數不一定填滿一列：用負邊距的細線切格，空格維持面板底色 */}
      <div className="overflow-hidden">
        <div className={cn('-mr-px -mb-px grid grid-cols-1 sm:grid-cols-2', symbols.length > 2 && 'lg:grid-cols-3')}>
          {symbols.map((sym) => (
            <div key={sym} className="border-r border-b">
              <SnapshotCard
                symbol={sym}
                stockInfos={c.stockInfos}
                color={colors[sym]}
                data={alignedChart}
                returnPct={viewModel.metricsRows.find((r) => r.symbol === sym)?.totalReturnPct ?? null}
              />
            </div>
          ))}
        </div>
      </div>
    </LedgerPanel>
  ) : null;

  return (
    <>
      <Head>
        <title>股海明燈｜多股比較</title>
        <meta name="description" content="結合產業背景，以共同期間比較多檔台股的價格漲跌、波動、回撤、法人買賣超與相關性。" />
      </Head>
      <SiteHeader icon={GitCompare} title="多股比較" subtitle="依產業背景，同期比較價格、風險與相關性" />

      <main aria-label="多股比較" className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-10 px-4 py-6 sm:px-6 lg:gap-16 lg:px-10 lg:py-10">
        <AnimatedSection delay={0.05}>
          <div ref={controlsRef} className="scroll-mt-24">
            <Ledger
              title="比較清單"
              stamp={
                <span className="inline-flex items-center gap-1.5">
                  <LightGlyph state={pickerState} />
                  {pickerState === 'loading' ? '股票清單讀取中 · ' : ''}已選 {c.selected.length} 檔
                </span>
              }
              actions={c.selected.length > 0 ? (
                <Button type="button" variant="ghost" onClick={c.clearAll} className="-my-1.5 text-subtle hover:bg-danger-muted hover:text-danger">
                  清空全部
                </Button>
              ) : null}
              cols="grid-cols-1 lg:grid-cols-12"
            >
              <LedgerPanel title="加入股票與期間" className="flex flex-col gap-4 lg:col-span-7">
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
                {/* 結束日是查詢條件，不一定有儲存資料；實際資料期間寫在比較結果裡 */}
                <DateRangePicker
                  className="shrink-0"
                  endLabel="查詢到"
                  startDate={c.startDate}
                  endDate={c.endDate}
                  onStartChange={c.setStartDate}
                  onEndChange={c.setEndDate}
                />

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

                <div className="mt-auto flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:gap-4">
                  {/* 本頁唯一的燈色主要按鈕 */}
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => void c.compare()}
                    disabled={loading || c.selected.length === 0}
                    className="w-full sm:w-auto sm:min-w-40"
                  >
                    {c.chartLoading ? '載入主圖資料...' : c.metricsLoading ? '計算比較指標...' : '開始比較'}
                  </Button>
                  {loading ? (
                    <div className="characteristic" aria-live="polite" aria-atomic="true">
                      {c.chartLoading ? <p>主圖資料載入中...</p> : null}
                      {c.metricsLoading && c.metricsProgress ? (
                        <p>
                          指標資料載入中：{c.metricsProgress.done}/{c.metricsProgress.total}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </LedgerPanel>

              <LedgerPanel padded={false} className="flex flex-col lg:col-span-5">
                <div className="flex items-baseline justify-between gap-3 border-b px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
                  <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">已選股票</h3>
                  <span className="characteristic">色條＝圖表代表色</span>
                </div>
                {c.selected.length > 0 ? (
                  <ul className="divide-y" aria-label="已選股票">
                    {c.selected.map((sym) => (
                      <li key={sym} className="relative flex min-h-14 items-center gap-3 bg-card py-1.5 pr-1.5 pl-5 sm:pl-6">
                        {/* 代表色只當一條 3px 的「燈色條」，不用彩色膠囊 */}
                        <span aria-hidden className="absolute inset-y-2 left-0 w-[3px]" style={{ backgroundColor: selectedColors[sym] }} />
                        <span className="w-12 shrink-0 font-mono text-[13.5px] font-medium tabular-nums">{sym}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.stockInfos[sym]?.name ?? ''}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.stockInfos[sym]?.industry?.trim() || '產業未提供'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => c.removeSymbol(sym)}
                          aria-label={`移除 ${sym}`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-flash) hover:bg-danger-muted hover:text-danger"
                        >
                          <X size={16} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState className="flex-1 px-4">尚未選擇股票；在「加入股票與期間」搜尋代號、公司或產業加入。</EmptyState>
                )}
              </LedgerPanel>
            </Ledger>
          </div>
        </AnimatedSection>

        {!result && !loading ? <CompareOutputs /> : null}

        {result && !result.chart && c.chartLoading ? <QRows label="航跡圖載入中" className="h-[360px] sm:h-[392px] lg:h-[440px]" /> : null}

        {/* 比較結果的主體：航跡圖（本頁唯一的圖廓）在最上方，條目緊接在圖下 */}
        {viewModel ? (
          <AnimatedSection>
            <CompareHero
              symbols={symbols}
              symbolColors={colors}
              stockInfos={c.stockInfos}
              requestedRange={viewModel.qualityMeta.requestedRange}
              analysisRange={viewModel.qualityMeta.analysisRange}
              alignedDays={viewModel.qualityMeta.alignedDays}
              tradingDays={tradingDays}
              onJumpToControls={jumpToControls}
              state={resultState}
              chart={chartPanel}
              entries={snapshotEntries}
            />
          </AnimatedSection>
        ) : chartPanel ? (
          <AnimatedSection>
            <Ledger
              title="航跡圖"
              stamp={
                <span className="inline-flex items-center gap-1.5">
                  <LightGlyph state="loading" />
                  比較指標計算中…
                </span>
              }
            >
              {chartPanel}
            </Ledger>
          </AnimatedSection>
        ) : null}

        {result && !metrics && c.metricsLoading ? <QRows label="比較指標計算中" className="h-[220px]" /> : null}

        {viewModel && viewModel.metricsRows.length > 0 ? (
          <AnimatedSection>
            <MetricsTable
              rows={viewModel.metricsRows}
              symbolColors={colors}
              benchmarkReturnPct={benchmarkComparison.returnPct}
              period={viewModel.qualityMeta.analysisRange}
              tradingDays={tradingDays}
              state={resultState}
            />
          </AnimatedSection>
        ) : null}

        {metrics ? (
          <AnimatedSection delay={0.05}>
            <CategoryLeaders leaders={metrics.leaders} symbolColors={colors} stockInfos={c.stockInfos} />
          </AnimatedSection>
        ) : null}

        {/* 延伸分析：索引表一列一項（名稱＋一句發現＋展開），一次只開一項 */}
        {metrics ? (
          <AnimatedSection>
            <AnalysisIndex
              title="延伸分析"
              entries={[
                {
                  key: 'scatter',
                  state: resultState,
                  name: '波動與漲跌幅分佈',
                  finding: scatterFinding(metrics.leaders),
                  description: '各檔年化波動%（X）對區間漲跌幅%（Y）的散點，以波動中位數與 0% 切四象限',
                  content: () => (viewModel ? <RiskReturnScatter rows={viewModel.metricsRows} symbolColors={colors} /> : null),
                },
                {
                  key: 'fundamentals',
                  // 每檔的基本面都讀不到（端點失敗回 null）＝熄燈
                  state: symbols.length && symbols.every((sym) => !metrics.fundamentals[sym]) ? 'error' : resultState,
                  name: '基本面比較',
                  finding: fundamentalsFinding(symbols, metrics.fundamentals, metrics.fundamentalsEndDate),
                  description: `月營收、EPS、本益比、股價淨值比與殖利率，資料截至 ${metrics.fundamentalsEndDate}；各自標示期間，不排名`,
                  content: () => <FundamentalsPanel symbols={symbols} data={metrics.fundamentals} endDate={metrics.fundamentalsEndDate} />,
                },
                {
                  key: 'institutional',
                  state: symbols.length && symbols.every((sym) => metrics.institutionalMap[sym] === null) ? 'error' : resultState,
                  name: '三大法人累計買賣超',
                  finding: institutionalFinding(symbols, metrics.aggregateMap),
                  description: '每檔的累計買賣超走勢，以及期間外資、投信、自營與合計彙總',
                  content: () => (
                    <InstitutionalComparePanel
                      symbols={symbols}
                      institutionalMap={metrics.institutionalMap}
                      aggregateMap={metrics.aggregateMap}
                      symbolColors={colors}
                    />
                  ),
                },
                {
                  key: 'technical',
                  state: resultState,
                  name: '技術指標快照',
                  finding: technicalFinding(metrics.leaders),
                  description: '每檔最後一個交易日的 RSI10、MACD 動能、KD 與 MA20／MA60 位置',
                  content: () => <TechnicalSnapshotTable symbols={symbols} latestMap={metrics.technicalLatestMap} symbolColors={colors} />,
                },
                {
                  key: 'correlation',
                  state: resultState,
                  name: '日漲跌幅相關性',
                  finding: correlationFinding(symbols, metrics.viewModel.correlationMatrix, metrics.viewModel.correlationSamples),
                  description: '各組配對的 Pearson ρ 與各自的有效樣本數',
                  content: () => (
                    <CorrelationPanel symbols={symbols} matrix={metrics.viewModel.correlationMatrix} sampleCounts={metrics.viewModel.correlationSamples} />
                  ),
                },
                {
                  key: 'method',
                  state: resultState,
                  name: '方法與可信度',
                  finding: methodFinding(metrics.viewModel.qualityMeta, tradingDays),
                  description: '運算口徑、實際比較期間與各檔資料品質',
                  content: () => <MethodologyPanel qualityMeta={metrics.viewModel.qualityMeta} />,
                },
              ]}
            />
          </AnimatedSection>
        ) : null}

        {/* 頁尾只有一個下一步：到個股頁看第一檔 */}
        {metrics && symbols[0] ? (
          <nav aria-label="下一步" className="border-y border-border-strong">
            <NextStep href={`/stock/${symbols[0]}`}>
              到個股頁看 {symbols[0]}
              {c.stockInfos[symbols[0]]?.name?.trim() ? ` ${c.stockInfos[symbols[0]]?.name?.trim()}` : ''} 的 K 線、法人與 AI 分析
            </NextStep>
          </nav>
        ) : null}
      </main>
    </>
  );
}
