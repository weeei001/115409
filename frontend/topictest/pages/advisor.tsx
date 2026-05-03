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
  summarizeAdvisorSignals,
  type AdvisorSignalPoint,
  type AdvisorBacktestView,
  type AdvisorFetchProgress,
} from '../lib/api/advisor';
import { CoreModePriceChart } from '../components/core-mode/CoreModePriceChart';
import { fetchSymbols } from '../lib/api/stock';
import { formatVolumeShares } from '../lib/utils/format';
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
  if (action === 'buy') return '買入｜趨勢轉強，可考慮分批布局';
  if (action === 'sell') return '賣出｜趨勢轉弱，建議降低部位';
  return '持平｜建議先觀察，不急著進場';
}

function recommendationClass(action: AdvisorAction): string {
  if (action === 'buy') {
    return 'bg-rose-50 text-rose-700 border border-rose-200';
  }
  if (action === 'sell') {
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  }
  return 'bg-amber-50 text-amber-700 border border-amber-200';
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
  if (typeof value === 'boolean') return value ? '是' : '否';
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
  if (action === 'buy') return '買入';
  if (action === 'sell') return '賣出';
  return '持平';
}

function signalPointLabel(point: AdvisorSignalPoint | null): string {
  if (!point) return '—';
  if (point.action === 'buy') return '買入';
  if (point.action === 'sell') return '賣出';
  if (point.action === 'hold') return '持平';
  return '—';
}

function signalPointTime(point: AdvisorSignalPoint | null): string {
  return point?.time ?? '—';
}

function buildReasonList(report: AdvisorReport): string[] {
  const raw = [report.reasoning, report.summary, report.recommendation_text]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
  const picked = raw.slice(0, 3);
  if (picked.length >= 2) return picked;
  if (picked.length === 1) return [picked[0], '—'];
  return ['—', '—'];
}

function buildMaPositionSummary(params: {
  relativeToMA20: 'above' | 'below' | 'equal' | 'unknown';
  relativeToMA60: 'above' | 'below' | 'equal' | 'unknown';
}): string {
  const toText = (target: string, relation: 'above' | 'below' | 'equal' | 'unknown'): string => {
    if (relation === 'above') return `站上 ${target}`;
    if (relation === 'below') return `低於 ${target}`;
    if (relation === 'equal') return `等於 ${target}`;
    return `${target} 資料不足`;
  };

  const t20 = toText('MA20', params.relativeToMA20);
  const t60 = toText('MA60', params.relativeToMA60);
  return `目前收盤相對均線：${t20}，${t60}`;
}

function getTrendLabel(recommendation: AdvisorAction): string {
  if (recommendation === 'buy') return '持平偏多';
  if (recommendation === 'sell') return '持平偏空';
  return '持平整理';
}

function getTrendSummaryText(signalSummary: ReturnType<typeof summarizeAdvisorSignals>): string {
  if (signalSummary.relativeToMA20 === 'above' && signalSummary.relativeToMA60 === 'above') {
    return '股價 > MA20 > MA60，短中期趨勢偏多。';
  }
  if (signalSummary.relativeToMA20 === 'below' && signalSummary.relativeToMA60 === 'below') {
    return '股價 < MA20 < MA60，短中期趨勢偏空。';
  }
  return '股價與均線位置交錯，短中期趨勢偏整理。';
}

function getMaStructureSummary(signalSummary: ReturnType<typeof summarizeAdvisorSignals>): string {
  if (signalSummary.relativeToMA20 === 'above' && signalSummary.relativeToMA60 === 'above') {
    return '股價 > MA20 > MA60';
  }
  if (signalSummary.relativeToMA20 === 'below' && signalSummary.relativeToMA60 === 'below') {
    return '股價 < MA20 < MA60';
  }
  return '股價與均線交錯';
}

function getVolumeInsight(backtestResult: AdvisorBacktestView | null): {
  latest: number | null;
  ma20: number | null;
  ma60: number | null;
  ma20DiffPct: number | null;
  status: string;
} {
  const priceChart = backtestResult?.price_chart;
  if (!priceChart?.volume?.length) {
    return { latest: null, ma20: null, ma60: null, ma20DiffPct: null, status: '無資料' };
  }
  const latestTime = priceChart.candles[priceChart.candles.length - 1].time;
  const volumePoint = priceChart.volume.find((item) => item.time === latestTime);
  const latest = volumePoint && Number.isFinite(volumePoint.value) ? volumePoint.value : null;
  const volumes = priceChart.volume.map((item) => item.value).filter((value) => Number.isFinite(value));
  const avg = (windowSize: number): number | null => {
    const segment = volumes.slice(-windowSize);
    if (!segment.length) return null;
    return segment.reduce((acc, curr) => acc + curr, 0) / segment.length;
  };
  const ma20 = avg(20);
  const ma60 = avg(60);
  const ma20DiffPct = latest !== null && ma20 !== null && ma20 > 0 ? ((latest - ma20) / ma20) * 100 : null;
  let status = '無資料';
  if (ma20DiffPct !== null) {
    if (Math.abs(ma20DiffPct) <= 5) {
      status = '接近均量';
    } else {
      status = ma20DiffPct >= 0 ? '量增' : '量縮';
    }
  }
  return { latest, ma20, ma60, ma20DiffPct, status };
}

function normalizeReasonText(text: string): string {
  if (text.includes('型態分數是否達標未通過')) return '目前突破力道不足，趨勢還沒有明確延續。';
  if (text.includes('綜合趨勢分數是否達標未通過')) return '訊號信心偏低，價格可能仍在盤整區間。';
  if (text.includes('有效趨勢訊號不足')) return '尚未出現明確買盤確認，建議先觀察。';
  if (text.includes('尚未成有效突破結構')) return '尚未形成明確突破，建議等待更清楚的趨勢訊號。';
  return text;
}

function getRiskToneText(report: AdvisorReport, signalSummary: ReturnType<typeof summarizeAdvisorSignals>): string {
  if (report.risk_notes && report.risk_notes.trim()) return normalizeReasonText(report.risk_notes);
  const maRisk =
    signalSummary.relativeToMA20 === 'below' && signalSummary.relativeToMA60 === 'below'
      ? '目前已跌破 MA20 與 MA60，中期結構轉弱風險較高。'
      : '若股價跌破 MA20，短線可能轉弱；若進一步跌破 MA60，代表中期結構轉差。';

  if (report.recommendation === 'buy') {
    return `訊號雖偏多，但仍需留意追價風險。${maRisk}因此建議分批布局，不宜一次重倉。`;
  }

  if (report.recommendation === 'sell') {
    return `目前結構偏弱，反彈若無法站回 MA20，弱勢延續機率較高。${maRisk}`;
  }

  return `目前訊號信心偏低，價格可能仍在盤整區間。${maRisk}因此目前不建議重倉，較適合觀察或小部位測試。`;
}

function mapActionToLabel(action: AdvisorAction): '買入' | '賣出' | '持平' {
  if (action === 'buy') return '買入';
  if (action === 'sell') return '賣出';
  return '持平';
}

function buildSignalConflictText(params: {
  recommendation: AdvisorAction;
  signalLabel: string;
  volumeStatus: string;
}): string | null {
  const recommendationLabel = mapActionToLabel(params.recommendation);
  const signalLabel = params.signalLabel === '—' ? '持平' : params.signalLabel;
  if (signalLabel === recommendationLabel) return null;

  if (signalLabel === '買入' && recommendationLabel === '持平') {
    return '策略訊號偏買入，但最終建議仍為持平，原因是目前尚未出現明確追價確認，進場信心仍不足。';
  }
  if (signalLabel === '賣出' && recommendationLabel === '持平') {
    return '策略訊號偏賣出，但最終建議仍為持平，代表系統判斷雖有轉弱跡象，仍需等待進一步跌破確認。';
  }
  if (signalLabel === '持平' && recommendationLabel === '買入') {
    return params.volumeStatus === '量增'
      ? '策略訊號目前仍為持平，但最終建議轉為買入，主因是均線與價格結構偏多，且量能放大提供了額外確認。'
      : '策略訊號目前仍為持平，但最終建議轉為買入，主因是均線與價格結構改善，系統評估可先採分批進場。';
  }
  if (signalLabel === '持平' && recommendationLabel === '賣出') {
    return '策略訊號目前仍為持平，但最終建議轉為賣出，主因是價格與均線結構轉弱，系統優先建議降低部位風險。';
  }
  return `策略訊號為${signalLabel}，但最終建議為${recommendationLabel}；系統綜合均線結構、股價位置與量能後，採取較保守的操作建議。`;
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

  const signalSummary = useMemo(
    () => summarizeAdvisorSignals(backtestResult?.price_chart ?? null),
    [backtestResult?.price_chart]
  );
  const keyReasons = useMemo(
    () => (report ? buildReasonList(report).map((item) => normalizeReasonText(item)) : []),
    [report]
  );
  const maPositionSummary = useMemo(
    () =>
      buildMaPositionSummary({
        relativeToMA20: signalSummary.relativeToMA20,
        relativeToMA60: signalSummary.relativeToMA60,
      }),
    [signalSummary.relativeToMA20, signalSummary.relativeToMA60]
  );
  const volumeInsight = useMemo(() => getVolumeInsight(backtestResult), [backtestResult]);
  const signalLabel = useMemo(() => signalPointLabel(signalSummary.currentSignal), [signalSummary.currentSignal]);
  const maStructureLabel = useMemo(() => {
    const trendSummary = getTrendSummaryText(signalSummary);
    if (trendSummary.includes('偏多')) return '偏多';
    if (trendSummary.includes('偏空')) return '偏空';
    return '盤整';
  }, [signalSummary]);
  const maPositionLabel = useMemo(
    () => maPositionSummary.replace('目前收盤相對均線：', ''),
    [maPositionSummary]
  );
  const volumeConfirmLabel = useMemo(() => {
    if (volumeInsight.status === '量增') return '充足';
    if (volumeInsight.status === '量縮') return '不足';
    if (volumeInsight.status === '接近均量') return '中性';
    return '無資料';
  }, [volumeInsight.status]);
  const signalConflictText = useMemo(
    () =>
      buildSignalConflictText({
        recommendation: report?.recommendation ?? 'wait',
        signalLabel,
        volumeStatus: volumeInsight.status,
      }),
    [report?.recommendation, signalLabel, volumeInsight.status]
  );

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
                <div>
                  <h2 className="text-base sm:text-lg font-bold">股價走勢圖</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    收盤線 + MA20 + MA60｜買入訊號 / 賣出訊號 / 實際買進 / 實際賣出 / 持平
                  </p>
                </div>
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
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">此區間沒有可用三線走勢資料。</p>
                    )}
                  </div>
                </>
              ) : null}
            </section>
            <section className="bento-cell p-5">
              <div>
                <h2 className="mt-1 text-base sm:text-lg font-bold text-[var(--color-text-primary)]">
                  最終建議
                </h2>
              </div>

              {loading && progress?.pendingFinal ? (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" />
                    正在整理最終觀點…
                  </div>

                  <div className="space-y-2">
                    <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-xl" />
                    <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-lg" />
                    <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-md" />
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span
                      className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${recommendationClass(
                        report.recommendation
                      )}`}
                    >
                      {recommendationText(report.recommendation)}
                    </span>

                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {actionHintText(report.recommendation)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">均線結構</p>
                      <p className="mt-1 font-semibold text-[var(--color-text-primary)]">{maStructureLabel}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">股價位置</p>
                      <p className="mt-1 font-semibold text-[var(--color-text-primary)]">{maPositionLabel}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">量能確認</p>
                      <p className="mt-1 font-semibold text-[var(--color-text-primary)]">{volumeConfirmLabel}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">策略訊號</p>
                      <p className="mt-1 font-semibold text-[var(--color-text-primary)]">{signalLabel}</p>
                    </div>
                  </div>

                  {signalConflictText ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
                      {signalConflictText}
                    </div>
                  ) : null}

                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">關鍵理由</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
                      {keyReasons.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/30 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                          風險提醒
                        </p>
                        <p className="mt-1 text-sm leading-7 text-[var(--color-text-secondary)]">
                          {getRiskToneText(report, signalSummary)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
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
