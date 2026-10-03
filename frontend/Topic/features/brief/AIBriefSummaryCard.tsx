import React, { useMemo } from 'react';
import { ArrowRight, ChevronDown, RefreshCw } from 'lucide-react';
import type { UseStockTextBriefResult } from '@/lib/hooks/useStockTextBrief';
import type { Claim } from '@/lib/types/textBrief';
import { buildEvidenceIndex } from '@/lib/brief/textBriefEvidence';
import { buildFacets, type Facet, type FacetTone } from '@/lib/brief/textBriefFacets';
import {
  CONF,
  CONF_HINT,
  FORWARD_VIEWS,
  forwardViewLabel,
  STANCE,
  STANCE_TONE,
  type BriefTone,
} from '@/lib/brief/textBriefLabels';
import { Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
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
  // 分級是品質高低，不是漲跌方向：不用漲跌色，也不用燈色
  good: 'text-foreground',
  caution: 'text-warning',
  neutral: 'text-foreground',
  info: 'text-subtle',
  unknown: 'text-muted-foreground',
};

/**
 * 法人籌碼的「買超／賣超」是方向，不是品質：買超用 up、賣超用 down（DESIGN.md 第 7 節），
 * 不借用 warning。其餘面向（偏高、弱、風險）維持上面的品質色。
 */
const DIRECTIONAL_FACET_CLASS: Partial<Record<FacetTone, string>> = {
  good: 'text-up',
  caution: 'text-down',
  neutral: 'text-foreground',
};

function facetToneClass(facet: Facet): string {
  if (facet.key === 'chips') return DIRECTIONAL_FACET_CLASS[facet.tone] ?? FACET_TONE_CLASS[facet.tone];
  return FACET_TONE_CLASS[facet.tone];
}

function topClaims(items?: Claim[]): Claim[] {
  return [...(items ?? [])]
    .sort((a, b) => Number(b.importance === 'high') - Number(a.importance === 'high'))
    .slice(0, FACTOR_LIMIT);
}

/** 帳頁外框：襯線標題「AI 投資分析」＋右側分析日戳記，底下一格方角面板 */
const CardFrame: React.FC<{ asOfDate?: string | null; state: LightState; children: React.ReactNode }> = ({ asOfDate, state, children }) => (
  <Ledger
    title="AI 投資分析"
    stamp={
      // 燈質記號：讀取中＝Q、已載入＝F、讀取失敗＝熄燈
      <span className="inline-flex items-center gap-1.5">
        <LightGlyph state={state} />
        {asOfDate ? `分析至 ${asOfDate}` : null}
      </span>
    }
    aria-label="AI 投資分析摘要"
  >
    <LedgerPanel padded={false}>{children}</LedgerPanel>
  </Ledger>
);

/** 只重讀一次排程產好的分析，不會觸發 LLM 重跑 */
const RetryButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button type="button" size="sm" variant="outline" onClick={onClick} className="min-h-11">
    <RefreshCw aria-hidden />
    重試
  </Button>
);

/** 收合段落裡的小標（段落本身是 h3）：sans、字距加寬、次要色 */
const Caption: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <h4 className={`text-[13px] font-medium tracking-[0.04em] ${className ?? 'text-muted-foreground'}`}>{children}</h4>
);

const FacetRow: React.FC<{ facet: Facet }> = ({ facet }) => (
  <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2.5 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]">
    <dt className="text-[13px] leading-tight tracking-[0.04em] text-muted-foreground">{facet.label}</dt>
    <dd className={`text-sm leading-tight font-bold ${facetToneClass(facet)}`}>{facet.levelLabel}</dd>
    <dd className="col-span-2 text-xs leading-5 text-muted-foreground sm:col-span-1">{facet.basis}</dd>
  </div>
);

/**
 * 股價資訊下方的 AI 摘要卡：頁面上只放結論（立場、一句標題、三個時間長度）與「查看完整分析」。
 * 正面、風險、分歧、重新評估條件與面向分級收在下方一列（預設收合）；每個結論後面都有可讀的來源標籤，
 * 點下去會開完整分析並亮出那一筆證據。
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
  const { loading, error, data, seconds, run } = brief;
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
      <CardFrame asOfDate={endDate} state="error">
        <div className="p-4 sm:p-6">
          <Notice tone="danger" action={<RetryButton onClick={() => void run()} />}>
            {error}
          </Notice>
        </div>
      </CardFrame>
    );
  }

  if (loading || !data) {
    return (
      <CardFrame asOfDate={endDate} state="loading">
        {/* 載入＝燈質 Q：有線的空白列，光帶掃過，寫出「讀取中」與秒數 */}
        <LoadingRows
          label={`讀取 ${symbol} 的 AI 分析中…${seconds > 0 ? `（${seconds} 秒）` : ''}`}
          className="h-[176px]"
        />
      </CardFrame>
    );
  }

  if (!b) {
    return (
      <CardFrame asOfDate={data.as_of_date} state="ready">
        <div className="p-4 sm:p-6">
          <Notice tone="warning">{data.limitations?.[0] ?? '這次沒有產出分析，AI 寫的內容沒通過系統檢查。'}</Notice>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenDetail()}>
              查看完整分析
              <ArrowRight aria-hidden />
            </Button>
          </div>
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
    accentClass = 'text-muted-foreground'
  ) => (
    <div className="min-w-0">
      <Caption className={accentClass}>{title}</Caption>
      {items.length ? (
        <ul className="mt-1.5 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <p className="flex flex-wrap items-start gap-x-1.5 gap-y-1 text-sm leading-6 text-foreground">

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
        <p className="mt-1.5 text-sm text-muted-foreground">{fallback}</p>
      )}
    </div>
  );

  return (
    <CardFrame asOfDate={data.as_of_date} state="ready">
      <div className="p-4 sm:p-6">
        {stale ? (
          <p role="status" className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
            最新交易日已到 {latestTradeDate}，這份分析的基準日較早，內容可能已經過期。
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={stanceTone} className="text-sm">
            <StanceIcon tone={stanceTone} />
            {STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
          </Tag>
          <span className="text-[13px] text-muted-foreground" title={CONF_HINT}>
            分析信心 {CONF[b.confidence ?? ''] ?? b.confidence}
          </span>
        </div>

        <p className="mt-3 max-w-[40em] text-xl leading-8 font-semibold text-foreground">{b.headline}</p>

        {/* 三個時間長度：一列細線分隔的讀數，不另外框成方塊 */}
        <dl className="mt-4 grid grid-cols-1 gap-px border-y bg-border sm:grid-cols-3">
          {FORWARD_VIEWS.map(([key, label]) => {
            const view = b.forward_views?.[key];
            const tone: BriefTone = STANCE_TONE[view?.stance ?? ''] ?? 'plain';
            return (
              <div key={key} className="flex min-h-11 items-center justify-between gap-2 bg-card py-2 sm:px-3 sm:first:pl-0">
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                  <StanceIcon tone={tone} size={13} />
                  {view ? forwardViewLabel(view) : '—'}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* 這一屏唯一的燈色主要按鈕 */}
          <Button type="button" onClick={() => onOpenDetail()}>
            查看完整分析
            <ArrowRight aria-hidden />
          </Button>
          <span className="text-[13px] leading-5 text-muted-foreground">僅供研究參考，不是投資建議。</span>
        </div>
      </div>

      {/* 正面／風險／分歧／重新評估與面向分級：收在一列裡，頁面上只留結論 */}
      <FoldSection
        title="正面、風險與面向分級"
        summary={`正面 ${positives.length} 項 · 風險 ${negatives.length} 項 · 分歧 ${divergence.length} 項 · 面向分級 ${facets.length} 項，各附來源`}
        className="border-t"
      >
        <div className="space-y-5 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {factorBlock('正面', positives, '沒有通過檢查的依據，暫無法提供正面因素判讀。', 'text-up-emphasis')}
            {factorBlock('風險', negatives, '沒有通過檢查的依據，不代表沒有風險。', 'text-warning')}
          </div>
          <div className="grid grid-cols-1 gap-5 border-t pt-5 sm:grid-cols-2">
            {factorBlock('主要分歧', divergence, '本次未提供主要分歧，並不代表沒有矛盾。')}
            <div>
              <Caption>重新評估條件 · 短線 1–5 日</Caption>
              <p className="mt-1.5 text-sm leading-6">{shortView?.invalidation || '本次未提供短線失效條件。'}</p>
              {shortView?.invalidation ? <EvidenceTagList ids={shortView.evidence_ids} index={evidence}
                onSelect={(id) => onOpenDetail(id, 'iv:short_1_5')} warnWhenEmpty className="mt-1" /> : null}
            </div>
          </div>

          <div className="border-t pt-5">
            <Caption>面向分級</Caption>
            {/* 一面向一列：名稱／分級／依據，用細線分隔 */}
            <dl className="mt-2 divide-y border-y">
              {facets.map((facet) => (
                <FacetRow key={facet.key} facet={facet} />
              ))}
            </dl>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              面向分級由固定門檻套用在上面列出的原始數字上，不是 AI 給的分數。
            </p>
            {/* 規則一律可點開（觸控也能看），不靠滑鼠懸停 */}
            <details className="group mt-1 border-b text-xs text-muted-foreground">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-medium text-subtle [&::-webkit-details-marker]:hidden">
                <ChevronDown size={14} aria-hidden className="shrink-0 text-muted-foreground transition-transform duration-(--dur-sweep) group-open:rotate-180" />
                分級規則
                <span className="characteristic">（{facets.length} 項，點開看門檻）</span>
              </summary>
              <dl className="divide-y border-t pb-1">
                {facets.map((facet) => (
                  <div key={facet.key} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
                    <dt className="font-medium text-subtle">{facet.label}</dt>
                    <dd className="leading-5">{facet.rule}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        </div>
      </FoldSection>
    </CardFrame>
  );
};
