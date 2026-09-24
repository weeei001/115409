import React, { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { UseStockTextBriefResult } from '../../../lib/hooks/useStockTextBrief';
import type { Claim } from '../../../lib/types/textBrief';
import { buildEvidenceIndex } from '../../../lib/utils/textBriefEvidence';
import { buildFacets, type Facet, type FacetTone } from '../../../lib/utils/textBriefFacets';
import {
  CONF,
  CONF_HINT,
  FORWARD_VIEWS,
  forwardViewLabel,
  STANCE,
  STANCE_TONE,
  type BriefTone,
} from '../../../lib/utils/textBriefLabels';
import { ClaimTypeBadge, EvidenceTagList, StanceIcon, Tag } from './BriefAtoms';

interface Props {
  symbol: string;
  brief: UseStockTextBriefResult;
  /** 儀表板基準日，載入中時先顯示 */
  endDate?: string | null;
  /** 最新交易日；分析基準日比它早就是過期 */
  latestTradeDate?: string | null;
  /** 證據目錄沒有均線數字時，技術動能面向的備援（本站價量計算） */
  maStructureLabel?: string;
  /** 開啟完整分析；帶 evidenceId 時先亮那一筆證據 */
  onOpenDetail: (evidenceId?: string, claimKey?: string) => void;
}

/** 最多顯示幾項正面／風險 */
const FACTOR_LIMIT = 2;

const FACET_TONE_CLASS: Record<FacetTone, string> = {
  good: 'text-up-emphasis',
  caution: 'text-down-emphasis',
  neutral: 'text-[var(--color-text-primary)]',
  info: 'text-brand',
  unknown: 'text-[var(--color-text-muted)]',
};

function topClaims(items?: Claim[]): Claim[] {
  return [...(items ?? [])]
    .sort((a, b) => Number(b.importance === 'high') - Number(a.importance === 'high'))
    .slice(0, FACTOR_LIMIT);
}

const CardFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <section
    aria-label="AI 投資分析摘要"
    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] sm:p-7"
  >
    {children}
  </section>
);

const CardHeader: React.FC<{
  asOfDate?: string | null;
  right?: React.ReactNode;
}> = ({ asOfDate, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
      <Sparkles size={13} aria-hidden className="text-brand" />
      AI 投資分析
    </span>
    <span className="flex items-center gap-2">
      {asOfDate ? (
        <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
          分析至 {asOfDate}
        </span>
      ) : null}
      {right}
    </span>
  </div>
);

const Divider: React.FC = () => (
  <div aria-hidden className="my-3 h-px w-full bg-[var(--color-border)]" />
);

/** 只重讀一次排程產好的分析，不會觸發 LLM 重跑 */
const RetryButton: React.FC<{ onClick: () => void; busy?: boolean }> = ({ onClick, busy }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
  >
    {busy ? (
      <Loader2 size={13} aria-hidden className="animate-spin" />
    ) : (
      <RefreshCw size={13} aria-hidden />
    )}
    {busy ? '載入中…' : '重試'}
  </button>
);

const FacetCell: React.FC<{ facet: Facet }> = ({ facet }) => (
  <div
    className="rounded-lg bg-[var(--color-bg-elevated)] px-3 py-2"
    title={facet.rule}
  >
    <p className="text-[10px] leading-tight text-[var(--color-text-muted)]">{facet.label}</p>
    <p className={`mt-0.5 text-sm font-bold leading-tight ${FACET_TONE_CLASS[facet.tone]}`}>
      {facet.levelLabel}
    </p>
    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--color-text-muted)]">
      {facet.basis}
    </p>
  </div>
);

/**
 * 股價資訊下方的 AI 摘要卡：不開詳情也能看懂結論、三個時間長度、正面與風險。
 * 每個結論後面都有可讀的來源標籤，點下去會開完整分析並亮出那一筆證據。
 *
 * 刻意不顯示買賣建議與目標價；面向分級來自寫死的門檻（見 textBriefFacets），
 * 不是 LLM 給的分數。
 */
export const AIBriefSummaryCard: React.FC<Props> = ({
  symbol,
  brief,
  endDate,
  latestTradeDate,
  maStructureLabel,
  onOpenDetail,
}) => {
  const { loading, refreshing, error, data, seconds, run } = brief;
  const b = data?.brief;

  const evidence = useMemo(
    () => buildEvidenceIndex(data?.evidence_catalog, data?.as_of_date),
    [data]
  );
  const facets = useMemo(
    () =>
      buildFacets(data?.evidence_catalog, {
        brief: b,
        asOfDate: data?.as_of_date,
        maStructureLabel,
      }),
    [data, b, maStructureLabel]
  );

  // data 為 null 只有「還沒發動」與「發動失敗」兩種情況；前者當載入中，避免閃一下空狀態
  if (error && !data) {
    return (
      <CardFrame>
        <CardHeader asOfDate={endDate} />
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-up/25 bg-up-muted px-3 py-2 text-sm leading-6 text-up-emphasis"
        >
          <AlertTriangle size={15} aria-hidden className="mt-1 shrink-0" />
          <span>{error}</span>
        </div>
        <div className="mt-3">
          <RetryButton onClick={() => void run()} />
        </div>
      </CardFrame>
    );
  }

  if (loading || !data) {
    return (
      <CardFrame>
        <CardHeader asOfDate={endDate} />
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          正在載入 {symbol} 的分析
          {seconds > 0 ? (
            <span className="tabular-nums text-[var(--color-text-muted)]">{seconds} 秒</span>
          ) : null}
        </p>
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-4 max-w-[85%] animate-pulse rounded-full bg-[var(--color-bg-elevated)]" />
          <div className="h-4 max-w-[60%] animate-pulse rounded-full bg-[var(--color-bg-elevated)]" />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--color-bg-elevated)]" />
          ))}
        </div>
        <span className="sr-only">AI 分析載入中</span>
      </CardFrame>
    );
  }

  if (!b) {
    return (
      <CardFrame>
        <CardHeader asOfDate={data.as_of_date} />
        <div className="ui-alert-warning mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm leading-6">
          <AlertTriangle size={15} aria-hidden className="mt-1 shrink-0 text-warning-icon" />
          <span>{data.limitations?.[0] ?? '這次沒有產出分析，AI 寫的內容沒通過系統檢查。'}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenDetail()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 px-2.5 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 cursor-pointer"
          >
            查看完整分析
            <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      </CardFrame>
    );
  }

  const stanceTone: BriefTone = STANCE_TONE[b.overall_stance ?? ''] ?? 'plain';
  const positives = topClaims(b.positive_factors);
  const negatives = topClaims(b.negative_factors);
  const divergence = topClaims(b.source_divergences?.filter(item => !item.claim_type || item.claim_type === 'conflict')).slice(0, 1);
  const shortView = b.forward_views?.short_1_5;
  const stale = Boolean(latestTradeDate && data.as_of_date && data.as_of_date < latestTradeDate);

  const factorBlock = (
    title: string,
    items: Claim[],
    fallback: string,
    accentClass = 'text-[var(--color-text-muted)]'
  ) => (
    <div className="min-w-0">
      <p className={`text-xs font-bold ${accentClass}`}>{title}</p>
      {items.length ? (
        <ul className="mt-1.5 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <p className="flex flex-wrap items-start gap-x-1.5 gap-y-1 text-sm leading-6 text-[var(--color-text-primary)]">

                <span className="min-w-0">{item.text}</span>
                <ClaimTypeBadge claimType={item.claim_type} />
              </p>
              <EvidenceTagList
                ids={item.evidence_ids}
                index={evidence}
                onSelect={(id) => onOpenDetail(id, item.id)}
                warnWhenEmpty={item.claim_type === 'observation'}
                className="mt-1"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{fallback}</p>
      )}
    </div>
  );

  return (
    <CardFrame>
      <CardHeader asOfDate={data.as_of_date} />

      {refreshing ? (
        <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
          正在更新分析，顯示的仍是上一次的結果，新的載入完成才會換掉。
        </p>
      ) : null}
      {error ? (
        <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
          更新失敗（{error}），顯示的是上一次成功的結果。
        </p>
      ) : null}
      {stale && !refreshing ? (
        <p role="status" className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
          最新交易日已到 {latestTradeDate}，這份分析的基準日較早，內容可能已經過期。
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Tag tone={stanceTone} className="text-sm">
          <StanceIcon tone={stanceTone} />
          {STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
        </Tag>
        <span className="text-[11px] text-[var(--color-text-muted)]" title={CONF_HINT}>
          分析信心 {CONF[b.confidence ?? ''] ?? b.confidence}
        </span>
      </div>

      <p className="mt-3 border-l-2 border-brand/50 pl-3 font-display text-xl font-semibold leading-8 tracking-tight text-[var(--color-text-primary)]">
        {b.headline}
      </p>

      <Divider />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {FORWARD_VIEWS.map(([key, label]) => {
          const view = b.forward_views?.[key];
          const tone: BriefTone = STANCE_TONE[view?.stance ?? ''] ?? 'plain';
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bg-elevated)] px-3 py-2"
            >
              <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text-primary)]">
                <StanceIcon tone={tone} size={13} />
                {view ? forwardViewLabel(view) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <Divider />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {factorBlock('正面', positives, '這次沒有列出正面因素。', 'text-up-emphasis')}
        {factorBlock('風險', negatives, '這次沒有列出風險因素。', 'text-down-emphasis')}
      </div>

      <Divider />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {factorBlock('主要分歧', divergence, '本次未提供主要分歧，並不代表沒有矛盾。')}
        <div>
          <p className="text-xs font-bold text-[var(--color-text-muted)]">重新評估條件 · 短線 1–5 日</p>
          <p className="mt-1.5 text-sm leading-6">{shortView?.invalidation || '本次未提供短線失效條件。'}</p>
          {shortView?.invalidation ? <EvidenceTagList ids={shortView.evidence_ids} index={evidence}
            onSelect={(id) => onOpenDetail(id, 'iv:short_1_5')} warnWhenEmpty className="mt-1" /> : null}
        </div>
      </div>

      <Divider />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {facets.map((facet) => (
          <FacetCell key={facet.key} facet={facet} />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-[var(--color-text-muted)]">
        面向分級由固定門檻套用在上面列出的原始數字上，不是 AI 給的分數；滑到標題可看規則。
      </p>

      <Divider />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenDetail()}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-card)] transition-opacity hover:opacity-90 cursor-pointer"
          style={{ background: 'var(--brand-gradient)' }}
        >
          查看完整分析
          <ArrowRight size={14} aria-hidden />
        </button>
        <span className="text-[11px] leading-5 text-[var(--color-text-muted)]">
          僅供研究參考，不是投資建議。
        </span>
      </div>
    </CardFrame>
  );
};
