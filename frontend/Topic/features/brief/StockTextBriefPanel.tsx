import React, { useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UseStockTextBriefResult } from '@/lib/hooks/useStockTextBrief';
import { buildEvidenceIndex } from '@/lib/brief/textBriefEvidence';
import { briefStatusNote, CONF, CONF_HINT, STANCE, STANCE_TONE, type BriefTone } from '@/lib/brief/textBriefLabels';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { taipeiDateTime } from '@/lib/utils/date';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/common/Disclosure';
import { tabListClass, tabTriggerActiveClass, tabTriggerClass } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { AI_RESEARCH_ONLY } from '@/lib/disclaimers';
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

/** 後端沒給免責文字時的預設句，和全站的 AI 免責同一句 */
const DEFAULT_DISCLAIMER = `AI 依公開資料整理，${AI_RESEARCH_ONLY}投資前請自行評估風險。`;

const TABS: [TabKey, string][] = [
  ['points', '重點'],
  ['scenario', '情境與風險'],
  ['sources', '證據來源'],
];

/** 只重讀一次排程產好的分析，不會觸發 LLM 重跑 */
const RetryButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button type="button" size="sm" variant="outline" onClick={onClick} className="min-h-11 shrink-0">
    <RefreshCw aria-hidden />
    重試
  </Button>
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
      <Disclosure className="border-t pt-1 text-xs text-muted-foreground" summary="引用檢核與分析限制">
        <p className="mt-2 leading-6">
        引用都能在「證據來源」找到（{evidence.total} 筆），未發現晚於基準日的已知日期。
        {evidence.undatedIds.length ? `另有 ${evidence.undatedIds.length} 筆缺少日期。` : ""}
        引用檢核不代表內容已證實。
        </p>
      </Disclosure>
    );
  }
  return (
    <Notice tone="warning">
      {evidence.undatedIds.length ? `另有 ${evidence.undatedIds.length} 筆缺少日期，無法完成時間核對。` : ""}
      {broken.length ? <>有 {broken.length} 筆引用在證據來源裡找不到，已不顯示為可點擊來源。</> : null}
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
  <div className="flex flex-col gap-4">
    <p className="text-xs text-muted-foreground">載入最新已存的 AI 分析，不會重新產生。</p>
    {/* 載入＝燈質 Q：有線的空白列，光帶掃過，寫出「載入中」與秒數 */}
    <div className="grid grid-cols-1 gap-px border bg-border lg:grid-cols-12">
      <LoadingRows
        label={`載入 ${symbol} 的已存分析中…${seconds > 0 ? `（${seconds} 秒）` : ''}`}
        className="h-[264px] bg-card lg:col-span-7"
      />
      <div className="q-rows hidden h-[264px] bg-card lg:col-span-5 lg:block" aria-hidden />
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
        <Notice tone="danger">{error}</Notice>
        <RetryButton onClick={() => void run()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-2 border bg-card px-4 pb-8">
        <EmptyState>這檔股票還沒有產生 AI 分析，排程更新後才會出現。</EmptyState>
        <Button type="button" variant="outline" onClick={() => void run()}>
          <RefreshCw aria-hidden />
          重新整理
        </Button>
      </div>
    );
  }

  const b = data.brief;

  if (!b) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning">
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
  const statusNote = briefStatusNote(data.status);

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
          <Notice tone="warning">
            這份分析的基準日是 {data.as_of_date}，比最新交易日 {latestTradeDate} 早，內容可能已經過期；排程更新後會自動換成最新的一份。
          </Notice>
        ) : null}
        {statusNote && data.limitations?.length ? (
          <Notice>{statusNote}；原因列在「分析限制」。</Notice>
        ) : statusNote ? (
          <Notice>{statusNote}。</Notice>
        ) : null}

        <p className="text-xs text-muted-foreground">
          行情截至 {data.price_as_of_date ?? '未提供'}；新聞截止 {data.news_cutoff_date ?? data.as_of_date}；產生時間 {data.generated_at ? taipeiDateTime(data.generated_at) : '未提供'}。系統只檢查格式、引用和部分數字，沒有驗證推論是否正確。
        </p>
        {/* 整體結論 */}
        <section
          aria-label="整體結論"
          className="py-2 sm:py-4"
        >
          <div>
            <p className="max-w-3xl border-l-2 border-border-strong pl-3 text-xl font-semibold leading-relaxed text-foreground sm:text-2xl">
              {b.headline}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag tone={stanceTone}>
                <StanceIcon tone={stanceTone} />
                整體 {STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
              </Tag>
              <Tag>分析信心 {CONF[b.confidence ?? ''] ?? b.confidence}</Tag>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">分析信心：{CONF_HINT}</p>
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
          className={cn(tabListClass, 'overflow-x-auto scrollbar-none')}
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
              className={cn(tabTriggerClass, 'focus-lamp-inset', tab === key && tabTriggerActiveClass)}
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
          {data.disclaimer?.text ?? DEFAULT_DISCLAIMER}
        </p>

        <EvidenceSheet />
      </div>
    </BriefHighlightProvider>
  );
};
