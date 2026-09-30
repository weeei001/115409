import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { UseStockTextBriefResult } from '@/lib/hooks/useStockTextBrief';
import { buildEvidenceIndex } from '@/lib/brief/textBriefEvidence';
import { CONF, CONF_HINT, STANCE, STANCE_TONE, type BriefTone } from '@/lib/brief/textBriefLabels';
import { BriefHighlightProvider, useBriefHighlight } from './BriefHighlight';
import { SectionCard, StanceIcon, Tag } from './BriefAtoms';
import { KeyPointsTab, ScenarioTab } from './BriefSections';
import { EvidenceCatalog, EvidenceRail, EvidenceSheet } from './EvidencePanel';

interface Props {
  symbol: string;
  brief: UseStockTextBriefResult;
  /** 從摘要卡的來源標籤點進來時要先亮的證據 */
  initialEvidenceId?: string | null;
  initialClaimKey?: string | null;
  /** 儀表板最新交易日，用來判斷分析是不是過期了 */
  latestTradeDate?: string | null;
}

type TabKey = 'points' | 'scenario' | 'sources';

const TABS: [TabKey, string][] = [
  ['points', '重點'],
  ['scenario', '情境與風險'],
  ['sources', '證據來源'],
];

const Notice: React.FC<{
  tone: 'warn' | 'error' | 'info';
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone, children, action }) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2 text-sm leading-6 ${
      tone === 'error'
        ? 'border-danger-border bg-danger-muted text-danger'
        : tone === 'warn'
          ? 'border-warning-border bg-warning-muted text-warning'
          : 'border-border-strong bg-accent text-subtle'
    }`}
  >
    <span className="flex min-w-0 items-start gap-2">
      <AlertTriangle size={15} aria-hidden className="mt-1 shrink-0" />
      <span className="min-w-0">{children}</span>
    </span>
    {action}
  </div>
);

/** 只重讀一次排程產好的分析，不會觸發 LLM 重跑 */
const RetryButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-brand hover:text-brand-text"
  >
    <RefreshCw size={13} aria-hidden />
    重試
  </button>
);

/** 引用檢核：目錄查不到、或日期晚於基準日的引用要講出來，不能默默吃掉 */
const BriefAudit: React.FC = () => {
  const { claims, evidence } = useBriefHighlight();
  const broken = useMemo(() => {
    const missing = new Set<string>();
    for (const ref of claims.values()) {
      for (const id of ref.evidenceIds) {
        if (!evidence.resolve(id)) missing.add(id);
      }
    }
    return [...missing];
  }, [claims, evidence]);

  if (!broken.length && !evidence.futureDatedIds.length) {
    return (
      <details className="border-t border-border pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">引用檢核與分析限制</summary>
        <p className="mt-2 leading-6">
        引用可在證據目錄找到（{evidence.total} 筆），未發現晚於基準日的已知日期。
        {evidence.undatedIds.length ? `另有 ${evidence.undatedIds.length} 筆缺少日期。` : ""}
        引用檢核不代表內容已證實。
        </p>
      </details>
    );
  }
  return (
    <Notice tone="warn">
      {evidence.undatedIds.length ? `另有 ${evidence.undatedIds.length} 筆缺少日期，無法完成時間核對。` : ""}
      {broken.length ? <>有 {broken.length} 筆引用在證據目錄裡找不到（{broken.join('、')}），已不顯示為可點擊來源。</> : null}
      {evidence.futureDatedIds.length ? (
        <>
          {broken.length ? '　' : null}
          有 {evidence.futureDatedIds.length} 筆證據日期晚於分析基準日，已停用。
        </>
      ) : null}
    </Notice>
  );
};

const Skeleton: React.FC<{ symbol: string; seconds: number }> = ({ symbol, seconds }) => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
    <p className="inline-flex items-center gap-2 text-sm font-medium text-brand-text">
      <Loader2 size={15} className="animate-spin shrink-0" aria-hidden />
      正在載入 {symbol} 的最新已存分析
      {seconds > 0 ? <span className="tabular-nums text-muted-foreground">{seconds} 秒</span> : null}
    </p>
    <p className="text-xs text-muted-foreground">
      讀取最新已存的 AI 分析。
    </p>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-hidden>
      <div className="space-y-3 lg:col-span-7">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="h-3.5 w-24 animate-pulse rounded-full bg-muted" />
            <div className="mt-3 space-y-2">
              <div className="h-3.5 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-muted" />
              <div className="h-3.5 w-3/5 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden lg:col-span-5 lg:block">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="h-3.5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-10 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/**
 * 完整分析。桌機雙欄（左：分析內容、右：證據詳情且 sticky），
 * 手機單欄＋底部證據抽屜；三個分頁：重點／情境與風險／證據來源。
 */
export const StockTextBriefPanel: React.FC<Props> = ({
  symbol,
  brief,
  initialEvidenceId,
  initialClaimKey,
  latestTradeDate,
}) => {
  const { loading, error, data, seconds, run } = brief;
  const [tab, setTab] = useState<TabKey>('points');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const evidence = useMemo(
    () => buildEvidenceIndex(data?.evidence_catalog, data?.as_of_date),
    [data]
  );

  if (loading) return <Skeleton symbol={symbol} seconds={seconds} />;

  if (error && !data) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="error">{error}</Notice>
        <RetryButton onClick={() => void run()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-muted/40 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          這檔股票還沒有產生 AI 分析，排程更新後才會出現。
        </p>
        <button
          type="button"
          onClick={() => void run()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-on-brand shadow-card"
        >
          <Sparkles size={14} aria-hidden />
          重新載入
        </button>
      </div>
    );
  }

  const b = data.brief;

  if (!b) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warn">
          目前沒有可用的已存 AI 分析，排程更新後才會出現。
        </Notice>
        {data.limitations?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-7 text-subtle">
            {data.limitations.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const stanceTone: BriefTone = STANCE_TONE[b.overall_stance ?? ''] ?? 'plain';
  const stale = Boolean(latestTradeDate && data.as_of_date && data.as_of_date < latestTradeDate);

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[next]?.focus();
  };

  return (
    <BriefHighlightProvider brief={b} evidence={evidence} initialEvidenceId={initialEvidenceId} initialClaimKey={initialClaimKey}>
      <div className="flex min-w-0 flex-col gap-4">
        {stale ? (
          <Notice tone="warn">
            這份分析的基準日是 {data.as_of_date}，比最新交易日 {latestTradeDate} 早，內容可能已經過期；
            排程更新後會自動換成最新的一份。
          </Notice>
        ) : null}

        <p className="text-xs text-muted-foreground">
          行情截至 {data.price_as_of_date ?? '未提供'}；新聞截止 {data.news_cutoff_date ?? data.as_of_date}；
          產生時間 {data.generated_at ?? '未提供'}。檢查涵蓋結構、引用及部分數值，未完整核實語義或預測準確率。
        </p>
        {/* 整體結論 */}
        <section
          aria-label="整體結論"
          className="py-4 sm:py-6"
        >
          <div>
            <p className="max-w-3xl border-l-2 border-brand/50 pl-3 text-xl font-semibold leading-relaxed tracking-tight text-foreground sm:text-2xl">
              {b.headline}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag tone={stanceTone}>
                <StanceIcon tone={stanceTone} />
                整體 {STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
              </Tag>
              <Tag title={CONF_HINT}>分析信心 {CONF[b.confidence ?? ''] ?? b.confidence}</Tag>
            </div>
            {b.confidence_reason ? (
              <p className="mt-3 text-sm leading-7 text-subtle">
                {b.confidence_reason}
              </p>
            ) : null}

          </div>
        </section>

        {/* 分頁 */}
        <div
          role="tablist"
          aria-label="分析內容分頁"
          className="flex min-w-0 gap-6 overflow-x-auto border-b border-border"
        >
          {TABS.map(([key, label], index) => (
            <button
              key={key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`brief-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`brief-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`min-h-[44px] whitespace-nowrap border-b-2 px-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand ${
                tab === key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 右欄要 sticky，所以格線不能用 items-start——欄位高度必須撐滿整列才有滑動空間 */}
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
          <div
            role="tabpanel"
            id={`brief-panel-${tab}`}
            aria-labelledby={`brief-tab-${tab}`}
            tabIndex={0}
            className="min-w-0 lg:col-span-7"
          >
            {tab === 'points' ? <KeyPointsTab brief={b} /> : null}
            {tab === 'scenario' ? <ScenarioTab brief={b} /> : null}
            {tab === 'sources' ? (
              <SectionCard
                title="引用資料"
                hint="選取資料，查看數值與引用它的結論。"
              >
                <EvidenceCatalog limitations={data.limitations} />
              </SectionCard>
            ) : null}
          </div>

          <div className="min-w-0 lg:col-span-5">
            <EvidenceRail limitations={data.limitations} showCatalog={false} />
          </div>
        </div>

        <BriefAudit />
        <p className="text-xs leading-6 text-muted-foreground">
          {data.disclaimer?.text ??
            '本區內容由系統依據公開資料與模型整理產生，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。'}
        </p>

        <EvidenceSheet />
      </div>
    </BriefHighlightProvider>
  );
};
