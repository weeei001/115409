import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { BarChart3, Loader2, Settings2, TrendingUp } from 'lucide-react';
import type { EChartsOption } from 'echarts';

import { SubpageHeader } from '../components/SubpageHeader';
import { CoreModePriceChart } from '../components/core-mode/CoreModePriceChart';
import { CoreModeEChartPanel } from '../components/core-mode/CoreModeEChartPanel';
import { VirtualTradeTable } from '../components/core-mode/VirtualTradeTable';
import {
  activateCoreModePreset,
  fetchCoreModeDecision,
  fetchCoreModePresets,
  fetchCoreModeSchema,
  runCoreModeBacktest,
  saveCoreModePreset,
} from '../lib/api/coreMode';
import type {
  CoreModeDecisionResponse,
  CoreModeParams,
  CoreModePreset,
  CoreModeRunResponse,
  CoreModeSchemaResponse,
} from '../lib/types/coreMode';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatPct(unit: number): string {
  return `${(unit * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '--';
}

function cloneParams(params: CoreModeParams): CoreModeParams {
  return {
    breakout_lookback: params.breakout_lookback,
    momentum_window: params.momentum_window,
    state_threshold: params.state_threshold,
    shape_threshold: params.shape_threshold,
    trend_threshold: params.trend_threshold,
    max_pullback_depth: params.max_pullback_depth,
    hard_stop_pct: params.hard_stop_pct,
    trailing_stop_pct: params.trailing_stop_pct,
  };
}

type TrendTone = 'bull' | 'bear' | 'sideways' | 'unclear';

function resolveTrendTone(conclusion?: string | null): TrendTone {
  if (!conclusion) return 'unclear';
  if (conclusion.includes('偏多')) return 'bull';
  if (conclusion.includes('偏空')) return 'bear';
  if (conclusion.includes('偏震盪')) return 'sideways';
  return 'unclear';
}

function toneClassByTrend(tone: TrendTone): string {
  if (tone === 'bull') return 'border-up/30 bg-up-muted';
  if (tone === 'bear') return 'border-down/30 bg-down-muted';
  if (tone === 'sideways') return 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-900/15';
  return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
}

function confidenceClass(confidence: string | null | undefined): string {
  if (!confidence) return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
  if (confidence.includes('高')) return 'border-up/35 bg-up-muted';
  if (confidence.includes('中')) return 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-900/15';
  if (confidence.includes('低')) return 'border-down/35 bg-down-muted';
  return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
}

function buildConclusionSentence(conclusion: string, confidence: string): string {
  if (conclusion === '偏多') return `目前結構偏多，整體屬於${confidence}信心；建議優先觀察量能是否持續擴張。`;
  if (conclusion === '偏空') return `目前結構偏空，整體屬於${confidence}信心；建議先等待趨勢分數修復再評估。`;
  if (conclusion === '偏震盪') return `目前在區間震盪，整體屬於${confidence}信心；建議等待突破或拉回品質改善。`;
  return `目前趨勢不明，整體屬於${confidence}信心；建議先觀察關鍵條件是否轉為一致。`;
}

export default function CoreModePage() {
  const [schema, setSchema] = useState<CoreModeSchemaResponse | null>(null);
  const [params, setParams] = useState<CoreModeParams | null>(null);
  const [presets, setPresets] = useState<CoreModePreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const [symbol, setSymbol] = useState('2330');
  const [startDate, setStartDate] = useState(isoDaysAgo(800));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));

  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CoreModeRunResponse | null>(null);

  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [presetMessage, setPresetMessage] = useState<string>('');

  const [analysisSymbol, setAnalysisSymbol] = useState('2330');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<CoreModeDecisionResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchCoreModeSchema(), fetchCoreModePresets()])
      .then(([schemaRes, presetRes]) => {
        if (!mounted) return;
        setSchema(schemaRes);
        setParams(cloneParams(schemaRes.default_params));
        setPresets(presetRes.presets);
        setActivePresetId(presetRes.active_preset_id);
        setSelectedPresetId(presetRes.active_preset_id);
      })
      .catch((error) => {
        if (!mounted) return;
        setRunError(error instanceof Error ? error.message : '載入核心模式設定失敗');
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedPreset = useMemo(
    () => presets.find((item) => item.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );

  const activePreset = useMemo(() => presets.find((item) => item.id === activePresetId) ?? null, [presets, activePresetId]);

  const updateParam = (key: keyof CoreModeParams, value: number) => {
    setParams((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [key]: value,
      };
    });
  };

  const handleLoadPreset = () => {
    if (!selectedPreset) return;
    setParams(cloneParams(selectedPreset.params));
    setPresetMessage(`已載入 preset：${selectedPreset.name}`);
  };

  const handleResetParams = () => {
    if (!schema) return;
    setParams(cloneParams(schema.default_params));
    setPresetMessage('已重設為核心模式預設參數');
  };

  const handleActivatePreset = async () => {
    if (!selectedPresetId) return;
    try {
      const data = await activateCoreModePreset(selectedPresetId);
      setPresets(data.presets);
      setActivePresetId(data.active_preset_id);
      setSelectedPresetId(data.active_preset_id);
      setPresetMessage('已設定 active preset');
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : '設定 active preset 失敗');
    }
  };

  const handleSavePreset = async () => {
    if (!params) return;
    const name = presetName.trim();
    if (!name) {
      setPresetMessage('請先輸入 preset 名稱');
      return;
    }

    setSavingPreset(true);
    setPresetMessage('');
    try {
      const data = await saveCoreModePreset({
        name,
        description: presetDescription.trim(),
        params,
      });
      setPresets(data.presets);
      setActivePresetId(data.active_preset_id);
      setSelectedPresetId(data.active_preset_id);
      setPresetName('');
      setPresetDescription('');
      setPresetMessage('preset 已儲存');
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : '儲存 preset 失敗');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleRunBacktest = async () => {
    if (!params) return;
    setRunLoading(true);
    setRunError(null);

    try {
      const data = await runCoreModeBacktest({
        symbol: symbol.trim().toUpperCase(),
        date_range: {
          start_date: startDate,
          end_date: endDate,
        },
        params,
        validation_mode: 'rolling_walk_forward',
        run_optimization: true,
      });
      setRunResult(data);

      const presetData = await fetchCoreModePresets();
      setPresets(presetData.presets);
      setActivePresetId(presetData.active_preset_id);
      setSelectedPresetId(presetData.active_preset_id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '回測執行失敗');
      setRunResult(null);
    } finally {
      setRunLoading(false);
    }
  };

  const handleApplyActivePreset = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const data = await fetchCoreModeDecision({ symbol: analysisSymbol.trim().toUpperCase() });
      setAnalysisResult(data);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '核心趨勢分析失敗');
      setAnalysisResult(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const candidateScatterOption = useMemo<EChartsOption>(() => {
    if (!runResult) return {};
    const list = runResult.comparison_candidates;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const data = params.data as [number, number, number, string];
          return `${data[3]}<br/>AC：${(data[0] * 100).toFixed(2)}%<br/>最大回撤：${(data[1] * 100).toFixed(2)}%<br/>平衡目標：${data[2].toFixed(3)}`;
        },
      },
      grid: { left: 56, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: 'value',
        name: 'AC',
        axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` },
      },
      yAxis: {
        type: 'value',
        name: '最大回撤',
        axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 12,
          data: list.map((item, index) => [
            item.summary.ac,
            item.summary.max_drawdown,
            item.balanced_objective,
            `候選 ${index + 1}`,
          ]),
          itemStyle: { color: '#ea580c' },
        },
      ],
    };
  }, [runResult]);
  const trendTone = useMemo(() => resolveTrendTone(runResult?.summary.trend_conclusion), [runResult]);
  const highlightedReasons = useMemo(
    () => runResult?.summary.reasoning.reason_points.slice(0, 3) ?? [],
    [runResult]
  );

  return (
    <div className="min-h-screen text-[var(--color-text-primary)]">
      <Head>
        <title>核心模式參數實驗室｜股海明燈</title>
        <meta
          name="description"
          content="台股趨勢分析核心模式：8 參數調整、歷史回測、walk-forward 驗證、最佳參數搜尋與 active preset 套用。"
        />
      </Head>

      <SubpageHeader
        icon={Settings2}
        title="回測核心模式參數實驗室"
        subtitle="趨勢分析＋回測＋最佳參數搜尋＋active preset 套用"
      />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        {runResult ? (
          <section className={`bento-cell p-4 sm:p-5 ${toneClassByTrend(trendTone)}`}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs font-semibold">
                    趨勢判斷：{runResult.summary.trend_conclusion}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(runResult.summary.confidence_level)}`}>
                    信心：{runResult.summary.confidence_level}
                  </span>
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs font-semibold">
                    預估期間：未來 10~20 個交易日
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-tight">
                  {buildConclusionSentence(runResult.summary.trend_conclusion, runResult.summary.confidence_level)}
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
                    <p className="text-xs text-[var(--color-text-muted)]">早期訊號</p>
                    <p className="mt-1 text-sm font-semibold">{runResult.summary.signal_status.early_signal ?? '無'}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
                    <p className="text-xs text-[var(--color-text-muted)]">正式訊號</p>
                    <p className="mt-1 text-sm font-semibold">{runResult.summary.signal_status.formal_signal ?? '無'}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3">
                    <p className="text-xs text-[var(--color-text-muted)]">目前 active preset</p>
                    <p className="mt-1 text-sm font-semibold">{activePreset?.name ?? '尚未設定'}</p>
                  </div>
                </div>
              </div>
              <aside className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
                <h3 className="text-sm font-bold">關鍵理由（最多 3 點）</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {highlightedReasons.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </section>
        ) : (
          <section className="bento-cell border-dashed p-6 text-center sm:p-8">
            <TrendingUp className="mx-auto mb-3 text-[var(--color-text-muted)]" size={28} />
            <h2 className="text-lg font-bold">先跑一次回測，重點就會出現</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
              完成回測後，頁面會先顯示趨勢判斷、信心與理由，再往下看合理性、主圖與交易細節。
            </p>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <article className="bento-cell p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">回測執行</h2>
                <p className="text-xs text-[var(--color-text-muted)]">先選標的與區間，再執行回測與參數搜尋。</p>
              </div>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1 text-xs font-semibold">
                主要操作區
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">股票代號</span>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="ui-input"
                  placeholder="例如 2330"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">起始日期</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="ui-input"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">結束日期</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="ui-input"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleRunBacktest}
                  disabled={runLoading || !params}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {runLoading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                  執行回測與參數搜尋
                </button>
              </div>
            </div>
            {runError ? <p className="mt-3 rounded-lg border border-up/25 bg-up-muted px-3 py-2 text-sm text-up">{runError}</p> : null}
          </article>

          <article className="bento-cell p-4 sm:p-5">
            <h2 className="text-base font-bold">Preset 操作</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">載入、啟用與儲存常用參數組合。</p>
            <div className="mt-3 space-y-2">
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="ui-input"
              >
                {presets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleLoadPreset}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium"
                >
                  載入
                </button>
                <button
                  type="button"
                  onClick={handleActivatePreset}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium"
                >
                  設為 active
                </button>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
                目前 active：{activePreset?.name ?? '尚未設定'}
              </div>
            </div>
          </article>
        </section>

        <section className="bento-cell p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">核心參數面板（8 項）</h2>
              <p className="text-xs text-[var(--color-text-muted)]">先用這 8 個關鍵旋鈕做調參，避免過度擬合。</p>
            </div>
            <button
              type="button"
              onClick={handleResetParams}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              重設為預設值
            </button>
          </div>

          {!schema || !params ? (
            <div className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              參數載入中...
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {(Object.keys(schema.params) as Array<keyof CoreModeParams>).map((key) => {
                  const cfg = schema.params[key];
                  const value = params[key];
                  const isInt = Number.isInteger(cfg.step);
                  return (
                    <div key={key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{cfg.label}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{cfg.description}</p>
                        </div>
                        <span className="rounded bg-[var(--color-bg-card)] px-2 py-1 text-xs tabular-nums">
                          {isInt ? Number(value).toFixed(0) : Number(value).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={cfg.min}
                        max={cfg.max}
                        step={cfg.step}
                        value={value}
                        onChange={(e) => updateParam(key, Number(e.target.value))}
                        className="mt-3 w-full accent-[var(--color-brand)]"
                      />
                      <div className="mt-1 flex justify-between text-xs text-[var(--color-text-muted)]">
                        <span>最小 {cfg.min}</span>
                        <span>預設 {cfg.default}</span>
                        <span>最大 {cfg.max}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="新 preset 名稱"
                  className="ui-input"
                />
                <input
                  value={presetDescription}
                  onChange={(e) => setPresetDescription(e.target.value)}
                  placeholder="說明（可選）"
                  className="ui-input md:col-span-2"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={savingPreset}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {savingPreset ? '儲存中...' : '儲存 preset'}
                </button>
              </div>
              {presetMessage ? <p className="mt-2 text-sm text-emerald-700">{presetMessage}</p> : null}
            </>
          )}
        </section>

        {runResult ? (
          <>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
              <article className="bento-cell p-4 sm:p-5 xl:col-span-3">
                <h2 className="text-base font-bold">趨勢合理性面板</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">重點檢查是否「真的像趨勢」，不是短期反彈。</p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {runResult.summary.reasoning.checks.map((check) => (
                    <div
                      key={check.key}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        check.passed ? 'border-up/30 bg-up-muted' : 'border-down/30 bg-down-muted'
                      }`}
                    >
                      <p className="font-semibold">{check.label}</p>
                      <p className="text-xs">{check.passed ? '通過' : '未通過'}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="bento-cell p-4 sm:p-5 xl:col-span-2">
                <h2 className="text-base font-bold">回測摘要卡</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">先看 AC、風險與穩定性，再看報酬。</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">準確度（AC）</p>
                    <p className="text-lg font-semibold">{formatPct(runResult.summary.ac)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">勝率</p>
                    <p className="text-lg font-semibold">{formatPct(runResult.summary.win_rate)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">期望值</p>
                    <p className="text-lg font-semibold">{formatNumber(runResult.summary.expectancy)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">獲利因子</p>
                    <p className="text-lg font-semibold">{formatNumber(runResult.summary.profit_factor)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">最大回撤</p>
                    <p className="text-lg font-semibold">{formatPct(runResult.summary.max_drawdown)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">穩定性</p>
                    <p className="text-lg font-semibold">{formatPct(runResult.summary.stability)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">累積報酬</p>
                    <p className="text-lg font-semibold">{formatPct(runResult.summary.cumulative_return)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5">
                    <p className="text-[11px] text-[var(--color-text-muted)]">交易次數</p>
                    <p className="text-lg font-semibold">{runResult.summary.trade_count}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">AC 定義：{runResult.meta.ac_definition}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  成交規則：{runResult.meta.tail_execution_policy ?? '訊號日 n，成交日 n+1'}
                </p>
                {runResult.meta.tail_position_excluded ? (
                  <p className="mt-1 text-xs text-amber-700">尾端有未平倉部位因無 n+1 交易日，已自正式績效排除。</p>
                ) : null}
              </article>
            </section>

            <CoreModePriceChart data={runResult.price_chart} />
            <section className="grid grid-cols-1 gap-3">
              <CoreModeEChartPanel title="參數候選比較（AC vs 最大回撤）" option={candidateScatterOption} height={320} />
            </section>
            <VirtualTradeTable trades={runResult.trades} />

            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">分析套用畫面（active preset）</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">目前 active preset：{activePreset?.name ?? '尚未設定'}</p>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <input
                  value={analysisSymbol}
                  onChange={(e) => setAnalysisSymbol(e.target.value)}
                  className="ui-input"
                  placeholder="股票代號，例如 2330"
                />
                <button
                  type="button"
                  onClick={handleApplyActivePreset}
                  disabled={analysisLoading}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {analysisLoading ? '分析中...' : '套用 active preset 分析'}
                </button>
              </div>

              {analysisError ? <p className="mt-2 text-sm text-rose-600">{analysisError}</p> : null}

              {analysisResult ? (
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className={`rounded-lg border p-3 ${toneClassByTrend(resolveTrendTone(analysisResult.trend_conclusion))}`}>
                    <h3 className="text-sm font-semibold">分析摘要</h3>
                    <p className="mt-2 text-sm">標的：{analysisResult.symbol}</p>
                    <p className="text-sm">結論：{analysisResult.trend_conclusion}</p>
                    <p className="text-sm">信心：{analysisResult.confidence_level}</p>
                    <p className="text-sm">基準日：{analysisResult.as_of_date}</p>
                    <p className="text-sm">操作建議：{analysisResult.action_suggestion ?? '觀望'}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                    <h3 className="text-sm font-semibold">分數與訊號</h3>
                    <p className="mt-2 text-sm">state_score：{formatNumber(analysisResult.state_score)}</p>
                    <p className="text-sm">trend_shape_score：{formatNumber(analysisResult.trend_shape_score)}</p>
                    <p className="text-sm">trend_score：{formatNumber(analysisResult.trend_score)}</p>
                    <p className="text-sm">early_signal：{analysisResult.early_signal_status ?? '無'}</p>
                    <p className="text-sm">formal_signal：{analysisResult.formal_signal_status ?? '無'}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] p-3">
                    <h3 className="text-sm font-semibold">理由</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                      {analysisResult.reason_points.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

