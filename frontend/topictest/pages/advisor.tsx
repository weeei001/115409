import React, { useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import {
  AlertTriangle,
  BrainCircuit,
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
  type AdvisorFetchProgress,
} from '../lib/api/advisor';
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
  { key: 'institutional', title: '抓取近 30 日法人籌碼' },
  { key: 'news', title: '檢索相關新聞與情緒摘要' },
  { key: 'cross_check', title: '交叉比對股價與技術指標' },
  { key: 'final', title: '生成綜合報告' },
];

const DATASET_TITLES: Record<DisplayDataset, string> = {
  institutional: '法人籌碼快照',
  prices: '股價快照',
  indicators: '技術指標快照',
};
const SNAPSHOT_SECTION_TITLE = '中間分析快照（法人／股價／技術指標）';

function createInitialSteps(): StepView[] {
  return STEP_DEFS.map((s) => ({ ...s, status: 'pending' as const }));
}

function recommendationText(action: AdvisorAction): string {
  if (action === 'buy') return '建議買進';
  if (action === 'sell') return '建議賣出';
  return '建議觀望';
}

function recommendationClass(action: AdvisorAction): string {
  if (action === 'buy') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
  }
  if (action === 'sell') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300';
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
}

function weightedScoreClass(score: number): string {
  if (score >= 0.25) return 'text-emerald-600 dark:text-emerald-300';
  if (score <= -0.25) return 'text-rose-600 dark:text-rose-300';
  return 'text-amber-600 dark:text-amber-300';
}

function statusText(status: AdvisorStepStatus): string {
  if (status === 'running') return '進行中';
  if (status === 'done') return 'Done';
  if (status === 'error') return 'Failed';
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

function getSummaryRows(dataset: DisplayDataset, card: AdvisorPartialDataEvent | null) {
  const summary = card?.summary ?? {};
  switch (dataset) {
    case 'institutional':
      return [
        { label: '資料筆數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '最新三大法人合計', value: summary.latest_total_net },
      ];
    case 'prices':
      return [
        { label: '資料筆數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '最新收盤', value: summary.latest_close },
        { label: '最新漲跌', value: summary.latest_change },
      ];
    case 'indicators':
      return [
        { label: '資料筆數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: 'RSI14', value: summary.latest_rsi14 },
        { label: 'MACD Hist', value: summary.latest_macd_hist },
      ];
  }
}

function getColumns(dataset: DisplayDataset): Array<{ key: string; label: string }> {
  if (dataset === 'institutional') {
    return [
      { key: 'date', label: '日期' },
      { key: 'foreign_net', label: '外資' },
      { key: 'trust_net', label: '投信' },
      { key: 'dealer_net', label: '自營商' },
      { key: 'total_net', label: '合計' },
    ];
  }
  if (dataset === 'prices') {
    return [
      { key: 'date', label: '日期' },
      { key: 'close', label: '收盤' },
      { key: 'change', label: '漲跌' },
      { key: 'volume', label: '成交量' },
    ];
  }
  return [
    { key: 'date', label: '日期' },
    { key: 'ma5', label: 'MA5' },
    { key: 'ma20', label: 'MA20' },
    { key: 'rsi14', label: 'RSI14' },
    { key: 'macd_hist', label: 'MACD Hist' },
  ];
}

function StepIcon({ status }: { status: AdvisorStepStatus }) {
  if (status === 'done') return <CheckCircle2 size={16} className="text-emerald-500" />;
  if (status === 'running') return <Loader2 size={16} className="text-[#ffa95a] animate-spin" />;
  if (status === 'error') return <AlertTriangle size={16} className="text-rose-500" />;
  return <CircleDashed size={16} className="text-gray-400" />;
}

export default function AdvisorPage() {
  const [symbol, setSymbol] = useState('');
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
  const requestSeq = useRef(0);

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
          <div key={dataset} className="rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{DATASET_TITLES[dataset]}</h3>
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Circle size={8} className="fill-current" />
                {rows.length > 0 ? `${rows.length} 筆` : '等待資料'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {summaryRows.map((s) => (
                <div key={s.label} className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-2.5 py-2">
                  <p className="text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="mt-0.5 font-medium text-gray-700 dark:text-gray-200 break-all">{toDisplayString(s.value)}</p>
                </div>
              ))}
            </div>

            {rows.length > 0 ? (
              <>
                {expanded[dataset] ? (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
                    <table className="min-w-full text-xs text-left">
                      <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                        <tr>
                          {columns.map((c) => (
                            <th key={c.key} className="px-2.5 py-2 whitespace-nowrap font-semibold">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {rows.map((row, rowIndex) => (
                          <tr key={`${dataset}-${rowIndex}`} className="text-gray-700 dark:text-gray-300">
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
                  className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors cursor-pointer"
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
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">尚未取得資料。</p>
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
      pendingQuick: true,
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
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜投資顧問</title>
        <meta name="description" content="整合法人籌碼、股價與技術指標，產生投資建議與資料來源。" />
      </Head>

      <SubpageHeader
        icon={BrainCircuit}
        title="投資顧問"
        subtitle="整合 RAG/LLM 分析，提供買進、賣出或觀望建議"
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col gap-6">
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) void handleGenerate();
                }}
                placeholder="輸入股票代號（例如：2330）"
                disabled={loading}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700
                           text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a] disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white text-sm font-semibold
                         shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl hover:shadow-[#ffa95a]/30 transition-all
                         disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? '分析中...' : '產生建議'}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {loading && symbol.trim() ? (
              <p className="text-[#ffa95a] text-sm font-medium flex items-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                {report && progress?.pendingFinal
                  ? `部分內容已顯示，完整分析載入中…（${symbol.trim().toUpperCase()}）`
                  : `正在分析 ${symbol.trim().toUpperCase()}…（AI 整理中，約需數十秒）`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                               dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                               px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">分析時間</span>
                <span className="font-semibold tabular-nums">{generatedAtLabel}</span>
              </span>
              {report?.date_start && report?.date_end ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                                 dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100">
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">資料區間</span>
                  <span className="font-semibold tabular-nums">
                    {report.date_start} ～ {report.date_end}
                  </span>
                </span>
              ) : null}
              {typeof report?.sentiment_score === 'number' && !Number.isNaN(report.sentiment_score) ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                                 dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100">
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">加權分數</span>
                  <span className="font-semibold tabular-nums">{report.sentiment_score.toFixed(2)}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-[0.65rem] sm:text-xs whitespace-nowrap">（-1 極空～1 極多）</span>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {showTracker ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <h2 className="text-base sm:text-lg font-bold">分析步驟追蹤</h2>
            <div className="mt-3 space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  className="rounded-xl border border-gray-100 dark:border-gray-700 px-3 py-2.5 text-sm flex items-start gap-3"
                >
                  <div className="mt-0.5"><StepIcon status={step.status} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 dark:text-gray-100">
                      [{index + 1 === steps.length ? 'Final' : `Step ${index + 1}`}] {step.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {step.message ?? `${step.title}... (${statusText(step.status)})`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showPartialCards && !report ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <h2 className="text-base sm:text-lg font-bold">{SNAPSHOT_SECTION_TITLE}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">等待最終報告時，先查看已完成步驟的中間資料。</p>
            {renderSnapshotCards()}
          </section>
        ) : null}

        {error ? (
          <section className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-4 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>{error}</span>
          </section>
        ) : null}

        {loading && !report ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 sm:p-10">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <Loader2 size={40} className="text-[#ffa95a] animate-spin" aria-hidden />
              <div>
                <p className="text-base font-semibold text-gray-800 dark:text-gray-100">分析中</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-md">
                  正在整合新聞、三大法人與技術面，請稍候勿關閉頁面。
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {!loading && !report ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            輸入股票代號後，即可產生投資顧問分析報告。
          </section>
        ) : null}

        {report ? (
          <>
            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">{SNAPSHOT_SECTION_TITLE}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                整合法人籌碼、股價與技術指標三種資料，快速比對中間分析結果。
              </p>
              {renderSnapshotCards()}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">技術指標重點</h2>
              <div className="mt-3 space-y-3">
                {report.technical_signals?.length ? (
                  report.technical_signals.map((signal) => (
                    <div key={`${signal.name}-${String(signal.value ?? '')}`} className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{signal.name}</p>
                        {signal.value !== undefined && signal.value !== null ? (
                          <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            {String(signal.value)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{signal.interpretation}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">技術指標資料不足</p>
                )}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">加權模型</h2>
              {report.score_breakdown ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-gray-500 dark:text-gray-400">最終加權分數</span>
                    <span
                      className={`text-2xl font-bold tabular-nums ${weightedScoreClass(
                        report.score_breakdown.weighted_score
                      )}`}
                    >
                      {report.score_breakdown.weighted_score.toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">門檻：偏多 ≥ 0.25，偏空 ≤ -0.25</span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">技術面</p>
                      <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                        {report.score_breakdown.technical_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">權重 {report.score_breakdown.weights.technical.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">籌碼面</p>
                      <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                        {report.score_breakdown.institutional_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">權重 {report.score_breakdown.weights.institutional.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">新聞 / RAG</p>
                      <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                        {report.score_breakdown.news_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">權重 {report.score_breakdown.weights.news.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">量價動能</p>
                      <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                        {report.score_breakdown.momentum_score.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">權重 {report.score_breakdown.weights.momentum.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">技術面解釋</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{report.score_breakdown.explanations.technical}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">籌碼面解釋</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{report.score_breakdown.explanations.institutional}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">新聞面解釋</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{report.score_breakdown.explanations.news}</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">量價動能解釋</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{report.score_breakdown.explanations.momentum}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">加權模型資料不足</p>
              )}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">最終建議</h2>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}>
                  {recommendationText(report.recommendation)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">標的：{report.symbol}</span>
              </div>
              {report.recommendation_text ? (
                <p className="mt-3 text-sm leading-6 text-gray-800 dark:text-gray-200 font-medium">操作建議：{report.recommendation_text}</p>
              ) : null}
              <p className="mt-3 text-sm leading-6 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{report.reasoning}</p>
              {report.risk_notes ? (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3">
                  風險提醒：{report.risk_notes}
                </p>
              ) : null}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">資料來源</h2>
              <div className="mt-3 space-y-2">
                {report.sources?.length ? (
                  report.sources.map((source, index) => (
                    <div key={`${source.title}-${index}`} className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-sm">
                      <p className="font-semibold">{source.title}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {source.publisher || '未知來源'}
                        {source.type ? ` ｜ ${source.type}` : ''}
                        {source.published_at ? ` ｜ ${source.published_at}` : ''}
                      </p>
                      {source.summary ? (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{source.summary}</p>
                      ) : null}
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-[#ffa95a] hover:underline"
                        >
                          前往來源
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">暫無資料來源</p>
                )}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">總結摘要</h2>
                {loading && progress?.pendingFinal ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin shrink-0" />
                    載入中
                  </span>
                ) : (
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}>
                    {recommendationText(report.recommendation)}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-700 dark:text-gray-300">{report.summary}</p>
            </section>
          </>
        ) : null}

        <section className="text-xs text-gray-400 dark:text-gray-500 pb-2">
          本頁內容由模型整理提供，僅供研究與資訊參考，不構成任何投資建議。請自行評估風險並審慎決策。
        </section>
      </main>
    </div>
  );
}
