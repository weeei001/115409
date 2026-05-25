import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AITrendPanel } from '../AITrendPanel';
import type { UseStockDashboardResult } from '../../lib/hooks/useStockDashboard';
import type { UseAdvisorVerdictResult } from '../../lib/hooks/useAdvisorVerdict';
import {
  actionHintText,
  DATASET_TITLES,
  DisplayDataset,
  getColumns,
  getMaStructureSummary,
  getRiskToneText,
  getSummaryRows,
  recommendationClass,
  recommendationText,
  SNAPSHOT_SECTION_TITLE,
  toDisplayString,
} from '../../lib/utils/advisorUiHelpers';

interface Props {
  symbol: string;
  dashboard: UseStockDashboardResult;
  verdict: UseAdvisorVerdictResult;
  variant?: 'page' | 'drawer';
}

type SignalTone = 'up' | 'down' | 'neutral';

function deriveTone(value: string): SignalTone {
  if (!value || value === '—' || /資料不足|無資料|交錯|接近|盤整|觀望|持平/.test(value)) {
    return 'neutral';
  }
  if (/站上|>|買入|量增|多/.test(value)) return 'up';
  if (/低於|<|賣出|量縮|空|轉弱/.test(value)) return 'down';
  return 'neutral';
}

const TONE_DOT: Record<SignalTone, string> = {
  up: 'bg-up',
  down: 'bg-down',
  neutral: 'bg-[var(--color-text-muted)]/50',
};

const TONE_VALUE: Record<SignalTone, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-[var(--color-text-primary)]',
};

export const StockAdvisorSection: React.FC<Props> = ({ symbol, dashboard, verdict, variant = 'page' }) => {
  const [expanded, setExpanded] = useState<Record<DisplayDataset, boolean>>({
    institutional: false,
    prices: false,
    indicators: false,
  });

  const {
    loading,
    error,
    report,
    progress,
    partialCards,
    aiTrendAnalysis,
    runAnalysis,
    generatedAtLabel,
    pricePosition,
    keyReasons,
    maPositionLabel,
    maStructureLabel,
    volumeConfirmLabel,
  } = verdict;

  const isDrawer = variant === 'drawer';
  const showPartialCards =
    loading || Object.values(partialCards).some((card) => card?.preview?.length || card?.summary);
  const snapshotDatasets: DisplayDataset[] = ['institutional', 'prices', 'indicators'];

  const renderSnapshotCards = () => (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      {snapshotDatasets.map((dataset) => {
        const card = partialCards[dataset];
        const rows = card?.preview ?? [];
        const columns = getColumns(dataset);
        const summaryRows = getSummaryRows(dataset, card);
        return (
          <div key={dataset} className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg-card)]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{DATASET_TITLES[dataset]}</h3>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Circle size={8} className="fill-current" />
                {rows.length > 0 ? `${rows.length} 筆` : '等待資料'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-2 gap-2 text-xs">
              {summaryRows.map((s) => (
                <div key={s.label} className="rounded-lg bg-[var(--color-bg-elevated)] px-2.5 py-2">
                  <p className="text-[var(--color-text-muted)]">{s.label}</p>
                  <p className="mt-0.5 font-medium text-[var(--color-text-primary)] break-all">
                    {toDisplayString(s.value)}
                  </p>
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

  // -------- DRAWER VARIANT --------
  if (isDrawer) {
    const maStructureValue = getMaStructureSummary(pricePosition);
    const signals: Array<{ label: string; value: string; tone: SignalTone }> = [
      { label: '均線結構', value: maStructureValue, tone: deriveTone(maStructureValue) },
      { label: '股價位置', value: maPositionLabel, tone: deriveTone(maPositionLabel) },
      { label: '量能確認', value: volumeConfirmLabel, tone: deriveTone(volumeConfirmLabel) },
    ];

    return (
      <div className="space-y-6">
        {error ? (
          <div className="bg-up-muted border border-up/20 rounded-2xl p-4 text-sm text-up-emphasis flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {loading && !report ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-10 flex flex-col items-center justify-center gap-4 text-center">
            <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
            <div>
              <p className="text-base font-semibold">正在分析 {symbol}</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)] max-w-md">
                整合新聞、三大法人與技術面，RAG 約數秒，AI 常需 1～3 分鐘。
              </p>
            </div>
          </div>
        ) : null}

        {report ? (
          <>
            {/* [1] Hero Verdict */}
            <section
              aria-label="最終建議"
              className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:p-6 shadow-[var(--shadow-card)]"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-1"
                style={{ background: 'var(--brand-gradient)' }}
              />
              <div className="pl-2 sm:pl-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-brand uppercase tracking-wider">
                  <Sparkles size={14} aria-hidden />
                  最終建議
                </div>

                {loading && progress?.pendingFinal ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                      <Loader2 size={14} className="animate-spin shrink-0 text-brand" aria-hidden />
                      正在整理最終觀點…
                    </div>
                    <div className="space-y-2" aria-hidden>
                      <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-xl" />
                      <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-lg" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex w-fit rounded-full px-4 py-1.5 text-sm font-semibold ${recommendationClass(
                          report.recommendation
                        )}`}
                        aria-label={`建議：${recommendationText(report.recommendation)}`}
                      >
                        建議：{recommendationText(report.recommendation)}
                      </span>
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {actionHintText(report.recommendation)}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 sm:divide-x sm:divide-[var(--color-border)]">
                      {signals.map((s, idx) => (
                        <div key={s.label} className={idx === 0 ? '' : 'sm:pl-6'}>
                          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                            <span aria-hidden className={`h-2 w-2 rounded-full ${TONE_DOT[s.tone]}`} />
                            {s.label}
                          </div>
                          <p className={`mt-1 text-sm font-semibold ${TONE_VALUE[s.tone]} break-words`}>
                            {s.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                      <span className="text-[var(--color-text-muted)]">趨勢偏向</span>
                      <span className="font-medium text-[var(--color-text-primary)]">{maStructureLabel}</span>
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* [2] AI 趨勢推測 - full width */}
            {aiTrendAnalysis && !progress?.pendingFinal ? (
              <AITrendPanel analysis={aiTrendAnalysis} sourcesSectionTitle="AI 分析與新聞參考" />
            ) : null}

            {/* [3] 兩欄：關鍵理由 + 風險提醒 */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:p-6 shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <FileText size={16} className="text-brand" aria-hidden />
                  關鍵理由
                </div>
                {keyReasons.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">尚無關鍵理由。</p>
                ) : (
                  <ol className="mt-4 divide-y divide-[var(--color-border)]/60">
                    {keyReasons.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-brand text-xs font-semibold tabular-nums">
                          {index + 1}
                        </span>
                        <span className="text-sm leading-7 text-[var(--color-text-secondary)]">{item}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="lg:col-span-2 rounded-2xl border border-amber-300/40 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/20 p-5 sm:p-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                  <AlertTriangle size={16} aria-hidden />
                  風險提醒
                </div>
                <p className="mt-3 text-sm leading-7 text-amber-900/85 dark:text-amber-100/85">
                  {getRiskToneText(report, pricePosition)}
                </p>
              </div>
            </div>

            {/* [4] 資料快照 - 折疊 */}
            <details className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-[var(--shadow-card)]">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 p-5 transition-colors hover:bg-[var(--color-bg-elevated)]/50">
                <div className="min-w-0">
                  <h3 className="text-base font-bold">{SNAPSHOT_SECTION_TITLE}</h3>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)] truncate">
                    法人籌碼 · 股價表現 · 技術指標（點擊展開）
                  </p>
                </div>
                <ChevronDown
                  size={18}
                  className="shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-[var(--color-border)] p-5">
                <p className="text-xs text-[var(--color-text-muted)]">
                  以下整理本次判斷會參考的主要資料，幫助你了解模型為什麼得出這個看法。
                </p>
                {renderSnapshotCards()}
              </div>
            </details>

            {/* [6] 資料來源 - 折疊 */}
            <details className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden shadow-[var(--shadow-card)]">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 p-5 transition-colors hover:bg-[var(--color-bg-elevated)]/50">
                <div className="min-w-0">
                  <h3 className="text-base font-bold">資料來源</h3>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)] truncate">
                    {report.sources?.length
                      ? `共 ${report.sources.length} 筆參考來源（點擊展開）`
                      : '暫無資料來源'}
                  </p>
                </div>
                <ChevronDown
                  size={18}
                  className="shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-[var(--color-border)] p-5">
                {loading && progress?.pendingFinal ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" aria-hidden />
                    新聞與參考來源載入中…
                  </div>
                ) : report.sources?.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {report.sources.map((source, index) => (
                      <div
                        key={`${source.title}-${index}`}
                        className="rounded-xl border border-[var(--color-border)] p-3 text-sm bg-[var(--color-bg-elevated)]/40"
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
                            <ExternalLink size={12} aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">暫無資料來源</p>
                )}
              </div>
            </details>
          </>
        ) : null}

        {showPartialCards && !report ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">{SNAPSHOT_SECTION_TITLE}</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              先整理目前已取得的法人、股價與技術資料，方便快速掌握重點。
            </p>
            {renderSnapshotCards()}
          </div>
        ) : null}

        <p className="text-xs text-[var(--color-text-muted)]">
          本區內容由系統依據公開資料與模型整理產生，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。
        </p>
      </div>
    );
  }

  // -------- PAGE VARIANT (unchanged) --------
  return (
    <section
      id="ai-advisor"
      className="scroll-mt-[calc(var(--app-header-height,5.5rem)+5.5rem)] relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 overflow-hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: 'var(--brand-gradient)' }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-bold text-[var(--color-text-primary)]">AI 投資分析</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            整合法人籌碼、股價趨勢、技術指標與新聞脈絡，產生 AI 情境分析（RAG → AI）。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runAnalysis(true)}
            disabled={loading || dashboard.loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold shadow-lg transition-[opacity,box-shadow,transform] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
            {loading ? '分析中…' : '重新分析'}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/5 to-brand/8 dark:from-brand/15 dark:to-brand/10 px-3 py-1.5 text-xs text-[var(--color-text-primary)]">
            <span className="text-[var(--color-text-muted)] shrink-0">分析時間</span>
            <span className="font-semibold tabular-nums">{generatedAtLabel}</span>
          </span>
          {report?.date_start && report?.date_end ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-gradient-to-r from-brand/5 to-brand/8 dark:from-brand/15 dark:to-brand/10 px-3 py-1.5 text-xs text-[var(--color-text-primary)]">
              <span className="text-[var(--color-text-muted)] shrink-0">資料區間</span>
              <span className="font-semibold tabular-nums">
                {report.date_start} ～ {report.date_end}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {loading && !report ? (
        <p className="text-brand text-sm font-medium flex items-center gap-2 mb-4">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          {report && progress?.pendingFinal
            ? `部分內容已顯示，完整分析載入中…（${symbol}）`
            : `正在分析 ${symbol}…（RAG 約數秒，AI 常需 1～3 分鐘，最長請耐心等候）`}
        </p>
      ) : null}

      {error ? (
        <div className="bg-up-muted border border-up/20 rounded-2xl p-4 text-sm text-up-emphasis flex items-start gap-2 mb-5">
          <AlertTriangle size={16} className="mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !report ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-8 sm:p-10 flex flex-col items-center justify-center gap-4 text-center">
          <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
          <div>
            <p className="text-base font-semibold">分析中</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)] max-w-md">
              正在整合新聞、三大法人與技術面，請稍候。
            </p>
          </div>
        </div>
      ) : null}

      {report ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-5">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-5">
              <h3 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">最終建議</h3>
              {loading && progress?.pendingFinal ? (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                    <Loader2 size={14} className="animate-spin shrink-0 text-brand" aria-hidden />
                    正在整理最終觀點…
                  </div>
                  <div className="space-y-2" aria-hidden>
                    <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-xl" />
                    <div className="h-3 rounded-full bg-[var(--color-bg-elevated)] animate-pulse max-w-lg" />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span
                      className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${recommendationClass(
                        report.recommendation
                      )}`}
                      aria-label={`建議：${recommendationText(report.recommendation)}`}
                    >
                      建議：{recommendationText(report.recommendation)}
                    </span>
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {actionHintText(report.recommendation)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">均線結構</p>
                      <p className="mt-1 font-semibold">{getMaStructureSummary(pricePosition)}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">股價位置</p>
                      <p className="mt-1 font-semibold">{maPositionLabel}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm">
                      <p className="text-xs text-[var(--color-text-muted)]">量能確認</p>
                      <p className="mt-1 font-semibold">{volumeConfirmLabel}</p>
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    趨勢偏向：{maStructureLabel}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">關鍵理由</h4>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
                      {keyReasons.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)]">風險提醒</p>
                    <p className="mt-1 text-sm leading-7 text-[var(--color-text-secondary)]">
                      {getRiskToneText(report, pricePosition)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-5">
            {aiTrendAnalysis && !progress?.pendingFinal ? (
              <AITrendPanel analysis={aiTrendAnalysis} sourcesSectionTitle="AI 分析與新聞參考" />
            ) : null}
          </div>

          <div className="lg:col-span-12 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-5">
            <h3 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">{SNAPSHOT_SECTION_TITLE}</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              以下整理本次判斷會參考的主要資料，幫助你了解模型為什麼得出這個看法。
            </p>
            {renderSnapshotCards()}
          </div>

          <div className="lg:col-span-12 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-5">
            <h3 className="text-base sm:text-lg font-bold">資料來源</h3>
            <div className="mt-3 space-y-2">
              {loading && progress?.pendingFinal ? (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                  <Loader2 size={14} className="animate-spin shrink-0 text-brand" aria-hidden />
                  新聞與參考來源載入中…
                </div>
              ) : report.sources?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.sources.map((source, index) => (
                    <div
                      key={`${source.title}-${index}`}
                      className="rounded-xl border border-[var(--color-border)] p-3 text-sm bg-[var(--color-bg-card)]"
                    >
                      <p className="font-semibold">{source.title}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {source.type ? ` ｜ ${source.type}` : ''}
                        {source.published_at ? ` ｜ ${source.published_at}` : ''}
                      </p>
                      {source.summary ? (
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">{source.summary}</p>
                      ) : null}
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                        >
                          前往來源
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">暫無資料來源</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showPartialCards && !report ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-5">
          <h3 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">{SNAPSHOT_SECTION_TITLE}</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            先整理目前已取得的法人、股價與技術資料，方便快速掌握重點。
          </p>
          {renderSnapshotCards()}
        </div>
      ) : null}

      <p className="text-xs text-[var(--color-text-muted)] mt-5">
        本區內容由系統依據公開資料與模型整理產生，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。
      </p>
    </section>
  );
};
