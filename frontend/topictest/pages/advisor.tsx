import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import {
  AlertTriangle,
  BrainCircuit,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDashed,
  ExternalLink,
  Loader2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { SubpageHeader } from '../components/SubpageHeader';
import {
  fetchAdvisorReportProgressive,
  type AdvisorBacktestView,
  type AdvisorFetchProgress,
} from '../lib/api/advisor';
import { CoreModePriceChart } from '../components/core-mode/CoreModePriceChart';
import { fetchSymbols } from '../lib/api/stock';
import type {
  AdvisorAction,
  AdvisorPartialDataEvent,
  AdvisorReport,
  AdvisorStepKey,
  AdvisorStepStatus,
  AdvisorStepUpdate,
} from '../lib/types';

type DisplayDataset = 'institutional' | 'prices' | 'indicators';

interface StepView {
  key: AdvisorStepKey;
  title: string;
  status: AdvisorStepStatus;
  message?: string;
}

const STEP_DEFS: Array<{ key: AdvisorStepKey; title: string }> = [
  { key: 'institutional', title: '查看法人買賣方向' },
  { key: 'cross_check', title: '檢查股價與技術面' },
  { key: 'news', title: '整理近期市場消息' },
  { key: 'final', title: '產生投資觀點' },
];

const DATASET_TITLES: Record<DisplayDataset, string> = {
  institutional: '法人籌碼',
  prices: '股價表現',
  indicators: '技術指標',
};

const SNAPSHOT_SECTION_TITLE = '關鍵資料整理';

function createInitialSteps(): StepView[] {
  return STEP_DEFS.map((s) => ({ ...s, status: 'pending' as const }));
}

function actionHintText(action: AdvisorAction): string {
  if (action === 'buy') return '可續抱或分批布局';
  if (action === 'sell') return '建議降低持股或暫避風險';
  return '建議先觀察，不急著進場';
}

function recommendationClass(action: AdvisorAction): string {
  if (action === 'buy') {
    return 'bg-down-muted text-down';
  }
  if (action === 'sell') {
    return 'bg-up-muted text-up';
  }
  return 'bg-brand/10 text-brand-deep dark:bg-brand/15 dark:text-brand-light';
}

function weightedScoreClass(score: number): string {
  if (score >= 0.25) return 'text-emerald-600 dark:text-emerald-300';
  if (score <= -0.25) return 'text-rose-600 dark:text-rose-300';
  return 'text-amber-600 dark:text-amber-300';
}

function formatNetShares(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('zh-TW');
}

function statusText(status: AdvisorStepStatus): string {
  if (status === 'running') return '分析中';
  if (status === 'done') return '已完成';
  if (status === 'error') return '發生問題';
  return '等待中';
}

function isDisplayDataset(dataset: string): dataset is DisplayDataset {
  return dataset === 'institutional' || dataset === 'prices' || dataset === 'indicators';
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function formatPctFromUnit(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(2)}%`;
}

const ADVISOR_MODEL_WEIGHTS = {
  technical: 0.38,
  institutional: 0.3,
  news: 0.15,
  momentum: 0.17,
} as const;

function getSummaryRows(dataset: DisplayDataset, card: AdvisorPartialDataEvent | null) {
  const summary = card?.summary ?? {};

  switch (dataset) {
    case 'institutional':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '法人合計買賣超', value: summary.latest_total_net },
      ];

    case 'prices':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '最新收盤價', value: summary.latest_close },
        { label: '單日漲跌', value: summary.latest_change },
      ];

    case 'indicators':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: 'RSI 強弱指標', value: summary.latest_rsi14 },
        { label: 'MACD 動能', value: summary.latest_macd_hist },
      ];
  }
}

function getColumns(dataset: DisplayDataset): Array<{ key: string; label: string }> {
  if (dataset === 'institutional') {
    return [
      { key: 'date', label: '日期' },
      { key: 'foreign_net', label: '外資買賣超' },
      { key: 'trust_net', label: '投信買賣超' },
      { key: 'dealer_net', label: '自營商買賣超' },
      { key: 'total_net', label: '法人合計' },
    ];
  }

  if (dataset === 'prices') {
    return [
      { key: 'date', label: '日期' },
      { key: 'close', label: '收盤價' },
      { key: 'change', label: '漲跌' },
      { key: 'volume', label: '成交量' },
    ];
  }

  return [
    { key: 'date', label: '日期' },
    { key: 'ma5', label: '5 日均線' },
    { key: 'ma20', label: '20 日均線' },
    { key: 'rsi14', label: 'RSI' },
    { key: 'macd_hist', label: 'MACD 動能' },
  ];
}
function recommendationText(action: AdvisorAction): string {
  if (action === 'buy') return '偏多';
  if (action === 'sell') return '偏空';
  return '觀望';
}
function getInvestorToneSummary(report: AdvisorReport): string {
  const action = report.recommendation;

  if (action === 'buy') {
    return `${report.symbol} 目前偏多，股價趨勢、技術動能與籌碼面整體偏正向。已有持股者可續抱觀察；尚未進場者不建議一次追高，可等待拉回或分批布局。`;
  }

  if (action === 'sell') {
    return `${report.symbol} 目前偏空，短線風險升高，建議降低持股或先暫避風險。若後續股價重新站回關鍵位置，再重新評估是否進場。`;
  }

  return `${report.symbol} 目前方向不明，建議先觀望。等待股價、技術面與籌碼面出現更一致的訊號後，再考慮進場。`;
}

function getRiskToneText(report: AdvisorReport): string {
  if (report.risk_notes) return report.risk_notes;

  if (report.recommendation === 'buy') {
    return '短線若漲幅過快，追價風險會升高。建議設定停損，並留意是否跌破近期支撐。';
  }

  if (report.recommendation === 'sell') {
    return '若股價快速反彈並站回關鍵均線，偏空判斷可能需要重新評估。';
  }

  return '目前訊號尚未明朗，過早進場容易承擔不必要波動。';
}

function StepIcon({ status }: { status: AdvisorStepStatus }) {
  if (status === 'done') return <CheckCircle2 size={16} className="text-emerald-500" />;
  if (status === 'running') return <Loader2 size={16} className="text-brand animate-spin" />;
  if (status === 'error') return <AlertTriangle size={16} className="text-rose-500" />;
  return <CircleDashed size={16} className="text-[var(--color-text-muted)]" />;
}

export default function AdvisorPage() {
  const [symbol, setSymbol] = useState('');
  const [symbolOptions, setSymbolOptions] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [progress, setProgress] = useState<AdvisorFetchProgress | null>(null);
  const [steps, setSteps] = useState<StepView[]>(createInitialSteps);
  const [partialCards, setPartialCards] = useState<Record<DisplayDataset, AdvisorPartialDataEvent | null>>({
    institutional: null,
    prices: null,
    indicators: null,
  });
  const [expanded, setExpanded] = useState<Record<DisplayDataset, boolean>>({
    institutional: false,
    prices: false,
    indicators: false,
  });
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestResult, setBacktestResult] = useState<AdvisorBacktestView | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    let active = true;
    setSymbolsLoading(true);

    fetchSymbols()
      .then((symbols) => {
        if (!active) return;
        const normalized = Array.from(
          new Set(
            symbols
              .map((item) => item.trim().toUpperCase())
              .filter(Boolean)
          )
        );
        setSymbolOptions(normalized);
      })
      .catch(() => {
        if (!active) return;
        setSymbolOptions([]);
      })
      .finally(() => {
        if (!active) return;
        setSymbolsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const generatedAtLabel = useMemo(() => {
    if (!report?.generated_at) return '--';
    const date = new Date(report.generated_at);
    return Number.isNaN(date.getTime()) ? report.generated_at : date.toLocaleString('zh-TW');
  }, [report?.generated_at]);

  const showTracker = loading || steps.some((s) => s.status !== 'pending');
  const showPartialCards =
    loading || Object.values(partialCards).some((card) => card?.preview?.length || card?.summary);
  const snapshotDatasets: DisplayDataset[] = ['institutional', 'prices', 'indicators'];

  const renderSnapshotCards = () => (
    <div className="mt-4 grid grid-cols-1 gap-4">
      {snapshotDatasets.map((dataset) => {
        const card = partialCards[dataset];
        const rows = card?.preview ?? [];
        const columns = getColumns(dataset);
        const summaryRows = getSummaryRows(dataset, card);
        return (
          <div key={dataset} className="rounded-xl border border-[var(--color-border)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{DATASET_TITLES[dataset]}</h3>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Circle size={8} className="fill-current" />
                {rows.length > 0 ? `${rows.length} 筆` : '等待資料'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {summaryRows.map((s) => (
                <div key={s.label} className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2">
                  <p className="text-[var(--color-text-muted)]">{s.label}</p>
                  <p className="mt-0.5 font-medium text-[var(--color-text-primary)] break-all">{toDisplayString(s.value)}</p>
                </div>
              ))}
            </div>

            {rows.length > 0 ? (
              <>
                {expanded[dataset] ? (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--color-border)]">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
                        <tr>
                          {columns.map((c) => (
                            <th key={c.key} className="px-2.5 py-2 whitespace-nowrap font-semibold">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {rows.map((row, rowIndex) => (
                          <tr key={`${dataset}-${rowIndex}`} className="text-[var(--color-text-primary)]">
                            {columns.map((c) => (
                              <td key={c.key} className="px-2.5 py-2 whitespace-nowrap">
                                {toDisplayString(row[c.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [dataset]: !prev[dataset] }))}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand hover:text-brand transition-colors cursor-pointer"
                >
                  {expanded[dataset] ? (
                    <>
                      <ChevronUp size={14} />
                      收合
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      顯示更多
                    </>
                  )}
                </button>
              </>
            ) : (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">尚未取得資料。</p>
            )}
          </div>
        );
      })}
    </div>
  );

  const handleGenerate = async () => {
    const trimmed = symbol.trim();
    if (!trimmed) {
      setError('請先輸入股票代號');
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setReport(null);
    setProgress({
      pendingInstitutional: true,
      pendingFinal: true,
    });
    setSteps(createInitialSteps());
    setPartialCards({
      institutional: null,
      prices: null,
      indicators: null,
    });
    setExpanded({
      institutional: false,
      prices: false,
      indicators: false,
    });
    setBacktestResult(null);
    setBacktestError(null);

    try {
      const data = await fetchAdvisorReportProgressive(
        { symbol: trimmed },
        {
          onPartial: (r) => {
            if (seq !== requestSeq.current) return;
            setReport(r);
          },
          onProgress: (p) => {
            if (seq !== requestSeq.current) return;
            setProgress(p);
          },
          onStepUpdate: (update: AdvisorStepUpdate) => {
            if (seq !== requestSeq.current) return;
            setSteps((prev) =>
              prev.map((step) =>
                step.key === update.step_key
                  ? { ...step, status: update.status, message: update.message ?? step.message }
                  : step
              )
            );
          },
          onPartialData: (payload) => {
            if (seq !== requestSeq.current) return;
            if (!isDisplayDataset(payload.dataset)) return;
            setPartialCards((prev) => ({
              ...prev,
              [payload.dataset]: payload,
            }));
          },
          onBacktest: (payload) => {
            if (seq !== requestSeq.current) return;
            setBacktestResult(payload);
          },
        }
      );
      if (seq !== requestSeq.current) return;
      setReport(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setReport(null);
      setProgress(null);
      const msg = err instanceof Error ? err.message : '取得投資顧問結果失敗';
      setError(msg);
      toast.error(msg);
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜投資顧問</title>
        <meta name="description" content="整合法人籌碼、股價與技術指標，產生投資建議與資料來源。" />
      </Head>

      <SubpageHeader
        icon={BrainCircuit}
        title="投資顧問"
        subtitle="用法人籌碼、股價趨勢與技術指標，整理成容易理解的投資觀點"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col gap-6">
        <section className="bento-cell p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative sm:w-48">
              <select
                value={symbolOptions.includes(symbol.trim().toUpperCase()) ? symbol.trim().toUpperCase() : ''}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setError(null);
                }}
                disabled={loading || symbolsLoading || symbolOptions.length === 0}
                className="w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]
                           text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand disabled:opacity-60"
              >
                <option value="">
                  {symbolsLoading ? '載入股票代號中...' : symbolOptions.length > 0 ? '選擇股票代號' : '沒有股票代號可供選擇'}
                </option>
                {symbolOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
              />
            </div>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) void handleGenerate();
                }}
                placeholder="輸入股票代號，例如 2330"
                disabled={loading}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]
                           text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold
                         shadow-lg transition-all
                         disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              style={{ background: 'var(--brand-gradient)' }}
            >
              {loading ? '分析中...' : '產生建議'}
            </button>
          </div>
          {!symbolsLoading && symbolOptions.length === 0 ? (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">
              目前無法載入股票清單，你仍可直接輸入股票代號。</p>
          ) : null}
          <div className="mt-3 space-y-2">
            {loading && symbol.trim() ? (
              <p className="text-brand text-sm font-medium flex items-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                {report && progress?.pendingFinal
                  ? `部分內容已顯示，完整分析載入中…（${symbol.trim().toUpperCase()}）`
                  : `正在分析 ${symbol.trim().toUpperCase()}…（AI 整理中，約需數十秒）`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/5 to-brand/8
                               dark:from-brand/15 dark:to-brand/10 dark:border-brand/40
                               px-3 py-1.5 text-xs sm:text-sm shadow-sm text-[var(--color-text-primary)]"
              >
                <span className="text-[var(--color-text-muted)] shrink-0">分析時間</span>
                <span className="font-semibold tabular-nums">{generatedAtLabel}</span>
              </span>
              {report?.date_start && report?.date_end ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/5 to-brand/8
                                 dark:from-brand/15 dark:to-brand/10 dark:border-brand/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-[var(--color-text-primary)]"
                >
                  <span className="text-[var(--color-text-muted)] shrink-0">資料區間</span>
                  <span className="font-semibold tabular-nums">
                    {report.date_start} ～ {report.date_end}
                  </span>
                </span>
              ) : null}
              {typeof report?.sentiment_score === 'number' && !Number.isNaN(report.sentiment_score) ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/5 to-brand/8
                                 dark:from-brand/15 dark:to-brand/10 dark:border-brand/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-[var(--color-text-primary)]"
                >
                  <span className="text-[var(--color-text-muted)] shrink-0">多空情緒</span>
                  <span className="font-semibold tabular-nums">{report.sentiment_score.toFixed(2)}</span>
                  <span className="text-[var(--color-text-muted)] text-[0.65rem] sm:text-xs whitespace-nowrap">
                    （-1 極空～1 極多）
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {showTracker ? (
          <section className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm p-5">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">分析進度</h2>
            <div className="mt-3 space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  className="rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm flex items-start gap-3"
                >
                  <div className="mt-0.5"><StepIcon status={step.status} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--color-text-primary)]">
                      {index + 1}. {step.title}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {step.message ?? `${step.title}... (${statusText(step.status)})`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showPartialCards && !report ? (
          <section className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm p-5">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">{SNAPSHOT_SECTION_TITLE}</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              先整理目前已取得的法人、股價與技術資料，方便快速掌握重點。
            </p>
            {renderSnapshotCards()}
          </section>
        ) : null}

        {error ? (
          <section className="bg-up-muted border border-up/20 rounded-2xl p-4 text-sm text-up flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>{error}</span>
          </section>
        ) : null}

        {loading && !report ? (
          <section className="bento-cell p-8 sm:p-10">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
              <div>
                <p className="text-base font-semibold">分析中</p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)] max-w-md">
                  正在整合新聞、三大法人與技術面，請稍候勿關閉頁面。
                </p>
              </div>
              <div className="w-full max-w-md space-y-2.5 mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse"
                    style={{ width: `${85 - i * 12}%` }}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {!loading && !report ? (
          <section className="bento-cell p-8 text-center text-sm text-[var(--color-text-muted)]">
            輸入股票代號後，即可產生投資顧問分析報告。
          </section>
        ) : null}

        {report ? (
          <>
            <section className="bento-cell p-5">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">{SNAPSHOT_SECTION_TITLE}</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                以下整理本次判斷會參考的主要資料，幫助你了解模型為什麼得出這個看法。
              </p>
              {renderSnapshotCards()}
            </section>

            <section className="bento-cell p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">歷史走勢與買賣點</h2>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {backtestResult ? '已完成' : '整理中'}
                </span>
              </div>

              {!backtestResult ? (
                <div className="mt-4 text-sm text-[var(--color-text-muted)] inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-brand" />
                  正在整理歷史走勢…
                </div>
              ) : null}

              {backtestError ? (
                <div className="mt-4 rounded-xl border border-up/20 bg-up-muted p-3 text-sm text-up inline-flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {backtestError}
                </div>
              ) : null}

              {backtestResult ? (
                <>
                  {/* <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">樣本數</p>
                      <p className="text-lg font-semibold tabular-nums">{backtestResult.overall.sample_count ?? '--'}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">Accuracy</p>
                      <p className="text-lg font-semibold tabular-nums">{formatPctFromUnit(backtestResult.overall.accuracy)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">F1 (buy)</p>
                      <p className="text-lg font-semibold tabular-nums">{formatPctFromUnit(backtestResult.overall.f1_buy)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">Precision (buy)</p>
                      <p className="text-lg font-semibold tabular-nums">{formatPctFromUnit(backtestResult.overall.precision_buy)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">Recall (buy)</p>
                      <p className="text-lg font-semibold tabular-nums">{formatPctFromUnit(backtestResult.overall.recall_buy)}</p>
                    </div>
                  </div> */}

                  <div className="mt-4 rounded-xl border border-[var(--color-border)] p-3">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-brand" />
                      股價走勢圖
                    </h3>
                    {backtestResult.price_chart?.candles?.length ? (
                      <div className="mt-3">
                        <CoreModePriceChart data={backtestResult.price_chart} />
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">此區間沒有可用價格 K 線資料。</p>
                    )}
                  </div>

                  {/* <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl bg-[var(--color-bg-elevated)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">TP</p>
                      <p className="text-base font-semibold tabular-nums">{backtestResult.overall.tp ?? '--'}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-bg-elevated)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">FP</p>
                      <p className="text-base font-semibold tabular-nums">{backtestResult.overall.fp ?? '--'}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-bg-elevated)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">FN</p>
                      <p className="text-base font-semibold tabular-nums">{backtestResult.overall.fn ?? '--'}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--color-bg-elevated)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">TN</p>
                      <p className="text-base font-semibold tabular-nums">{backtestResult.overall.tn ?? '--'}</p>
                    </div>
                  </div> */}

                  {/* <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4 text-sm">
                    <h3 className="font-semibold">指標公式與依據（新手版）</h3>
                    <div className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
                      <p><strong>Accuracy</strong> = (TP + TN) / (TP + FP + FN + TN)</p>
                      <p><strong>Precision</strong> = TP / (TP + FP)</p>
                      <p><strong>Recall</strong> = TP / (TP + FN)</p>
                      <p><strong>F1</strong> = 2 × Precision × Recall / (Precision + Recall)</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        這裡把「buy」當正類：TP=預測買且實際漲、FP=預測買但實際跌、FN=預測賣但實際漲、TN=預測賣且實際跌。
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <a
                        href="https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        Google ML Crash Course（Accuracy/F1）
                      </a>
                      <a
                        href="https://scikit-learn.org/stable/modules/generated/sklearn.metrics.accuracy_score.html"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        scikit-learn: accuracy_score
                      </a>
                      <a
                        href="https://scikit-learn.org/stable/modules/generated/sklearn.metrics.f1_score.html"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        scikit-learn: f1_score
                      </a>
                      <a
                        href="https://scikit-learn.org/stable/modules/generated/sklearn.metrics.confusion_matrix.html"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        scikit-learn: confusion_matrix（TP/FP/FN/TN）
                      </a>
                    </div>
                  </div> */}
                </>
              ) : null}
            </section>


            <section className="bento-cell p-5">
              <h2 className="text-base sm:text-lg font-bold">技術指標重點</h2>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {loading && !report.technical_signals?.length ? (
                  <>
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                      <p className="text-sm text-[var(--color-text-muted)] inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin shrink-0 text-brand" />
                        技術觀察載入中…
                      </p>
                      <div className="h-16 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse" />
                      <div className="h-16 rounded-xl bg-[var(--color-bg-elevated)] animate-pulse max-w-[95%]" />
                    </div>
                  </>
                ) : report.technical_signals?.length ? (
                  report.technical_signals.map((signal) => (
                    <div
                      key={`${signal.name}-${String(signal.value ?? '')}`}
                      className="rounded-xl border border-[var(--color-border)] p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{signal.name}</p>
                        {signal.value !== undefined && signal.value !== null ? (
                          <span className="px-2 py-0.5 rounded-md text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
                            {String(signal.value)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {signal.interpretation}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)] sm:col-span-2 lg:col-span-3">
                    技術指標資料不足
                  </p>
                )}
              </div>
            </section>

            <section className="bento-cell p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-base sm:text-lg font-bold">目前看法</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    先看結論，再看理由與風險。
                  </p>
                </div>

                {loading && progress?.pendingFinal ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin shrink-0" />
                    整理中
                  </span>
                ) : (
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}
                  >
                    {recommendationText(report.recommendation)}
                  </span>
                )}
              </div>

              {loading && progress?.pendingFinal ? (
                <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--color-text-muted)]">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" />
                    正在整理投資觀點…
                  </span>
                  <div className="h-3 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse max-w-lg" />
                  <div className="h-3 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse max-w-md" />
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}
                    >
                      {report.symbol}：{recommendationText(report.recommendation)}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {actionHintText(report.recommendation)}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[var(--color-text-primary)]">
                    {getInvestorToneSummary(report)}
                  </p>

                  {report.summary ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
                      {report.summary}
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            {/* <section className="bento-cell p-5">
              <h2 className="text-base sm:text-lg font-bold">加權模型</h2>
              {report.score_breakdown ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[var(--color-text-muted)]">最終加權分數</span>
                    <span
                      className={`text-2xl font-bold tabular-nums ${weightedScoreClass(
                        report.score_breakdown.weighted_score
                      )}`}
                    >
                      {report.score_breakdown.weighted_score.toFixed(2)}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">門檻：偏多 ≥ 0.25，偏空 ≤ -0.25</span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">技術面</p>
                      <p className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                        {report.score_breakdown.technical_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        權重 {ADVISOR_MODEL_WEIGHTS.technical.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">籌碼面</p>
                      <p className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                        {report.score_breakdown.institutional_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        權重 {ADVISOR_MODEL_WEIGHTS.institutional.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">新聞 / RAG</p>
                      <p className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                        {report.score_breakdown.news_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        權重 {ADVISOR_MODEL_WEIGHTS.news.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">量價動能</p>
                      <p className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                        {report.score_breakdown.momentum_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        權重 {ADVISOR_MODEL_WEIGHTS.momentum.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="font-medium text-[var(--color-text-primary)]">技術面解釋</p>
                      <p className="mt-1 text-[var(--color-text-secondary)]">{report.score_breakdown.explanations.technical}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="font-medium text-[var(--color-text-primary)]">籌碼面解釋</p>
                      <p className="mt-1 text-[var(--color-text-secondary)]">{report.score_breakdown.explanations.institutional}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="font-medium text-[var(--color-text-primary)]">新聞面解釋</p>
                      <p className="mt-1 text-[var(--color-text-secondary)]">{report.score_breakdown.explanations.news}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="font-medium text-[var(--color-text-primary)]">量價動能解釋</p>
                      <p className="mt-1 text-[var(--color-text-secondary)]">{report.score_breakdown.explanations.momentum}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">加權模型資料不足</p>
              )}
            </section> */}


            <section className="bento-cell p-5">
              <h2 className="text-base sm:text-lg font-bold">最終建議</h2>
              {loading && progress?.pendingFinal ? (
                <div className="mt-3 space-y-2 text-sm text-[var(--color-text-muted)]">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" />
                    最終建議與論述載入中，請先參考上方法人與技術觀察…
                  </span>
                  <div className="h-3 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse max-w-lg" />
                  <div className="h-3 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse max-w-md" />
                </div>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">方向</p>
                      <p>
                        <span className={`mt-1 inline-flex px-3 py-1 rounded-full text-sm font-bold ${recommendationClass(report.recommendation)}`}>
                          {recommendationText(report.recommendation)}
                        </span>
                      </p>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">操作參考</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                        {actionHintText(report.recommendation)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">股票代號</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                        {report.symbol}
                      </p>
                    </div>
                  </div>

                  {report.recommendation_text ? (
                    <div className="mt-4 rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 p-3">
                      <p className="text-xs font-semibold text-brand-deep dark:text-brand-light">操作建議</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-text-primary)]">
                        {report.recommendation_text}
                      </p>
                    </div>
                  ) : null}

                  {report.reasoning ? (
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">為什麼這樣判斷？</h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)] whitespace-pre-wrap">
                        {report.reasoning}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-50 dark:bg-amber-400/10 p-3">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">風險提醒</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-text-primary)]">
                      {getRiskToneText(report)}
                    </p>
                  </div>
                </>
              )}
            </section>

            <section className="bento-cell p-5">
              <h2 className="text-base sm:text-lg font-bold">資料來源</h2>
              <div className="mt-3 space-y-2">
                {loading && progress?.pendingFinal ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" />
                    新聞與參考來源載入中…
                  </div>
                ) : report.sources?.length ? (
                  report.sources.map((source, index) => (
                    <div
                      key={`${source.title}-${index}`}
                      className="rounded-xl border border-[var(--color-border)] p-3 text-sm"
                    >
                      <p className="font-semibold">{source.title}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {source.publisher || '未知來源'}
                        {source.type ? ` ｜ ${source.type}` : ''}
                        {source.published_at ? ` ｜ ${source.published_at}` : ''}
                      </p>
                      {source.summary ? (
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
                          {source.summary}
                        </p>
                      ) : null}
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                        >
                          前往來源
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">暫無資料來源</p>
                )}
              </div>
            </section>
          </>
        ) : null}

        <section className="text-xs text-[var(--color-text-muted)] pb-2">
          本頁內容由系統依據公開資料與模型整理產生，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。
        </section>
      </main>
    </div>
  );
}
