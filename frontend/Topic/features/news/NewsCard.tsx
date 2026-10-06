import { memo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, ExternalLink, Quote } from 'lucide-react';
import type { News } from '@/lib/types/api';
import { formatTime } from '@/lib/utils/date';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { newsHref, parseRelatedStocks, stripHtml } from '@/lib/news/newsLinks';
import { newsSourceName } from '@/lib/news/newsSource';
import { IMPORTANCE_LABELS, visibleImpacts } from '@/lib/utils/newsImpact';
import { safeHttpUrl } from '@/lib/utils/url';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { textLinkClass } from '@/components/ui/button';
import { ImpactDirectionTag } from './ImpactTag';
import { groupImpactsByTarget, type ImpactGroup } from './impactGroups';

export type NewsRelation = 'direct' | 'market_context' | 'industry_context';

interface Props {
  news: News;
  targetStock?: string;
  relation?: NewsRelation;
  returnTo?: string;
  onNavigate?: () => void;
  /** stack：一欄疊放（抽屜、個股頁）；ledger：首頁帳頁列，寬版 8／4 切（只在沒有 targetStock 時使用） */
  layout?: 'stack' | 'ledger';
}

function snippet(content: string | null, maxLen = 120): string {
  if (!content) return '';
  const plain = stripHtml(content).replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

/** 影響對象＋一個方向標籤（同方向顯示一次；正負對立顯示中性的「正負並存」）＋事件數＋最高重要性（純文字） */
function ImpactGroupBadge({ group, linkStock, className }: { group: ImpactGroup; linkStock: boolean; className?: string }) {
  const company = group.targetType === 'company';
  const name = company ? (
    <>
      <span className="font-mono tabular-nums">{group.targetId}</span>
      {group.label !== group.targetId ? <span className="max-w-[8em] truncate">{group.label}</span> : null}
    </>
  ) : <span className="max-w-[10em] truncate">{group.label}</span>;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-x-1.5 text-xs whitespace-nowrap', className)}>
      {company && linkStock ? (
        // 觸控目標 44px：連結本身撐滿整行高度，視覺上仍是一段小字
        <Link href={`/stock/${group.targetId}`} className={cn('inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-subtle outline-none hover:text-foreground focus-lamp', textLinkClass)}>
          {name}
        </Link>
      ) : <span className="inline-flex items-center gap-1 font-medium text-subtle">{name}</span>}
      <ImpactDirectionTag direction={group.direction} />
      {group.eventCount > 1 ? <span className="text-muted-foreground"><span className="font-mono tabular-nums">{group.eventCount}</span> 項事件</span> : null}
      <span className="text-muted-foreground">{IMPORTANCE_LABELS[group.importance]}</span>
    </span>
  );
}

/**
 * 一列只放一行標籤：寬版最多 3 個影響對象，手機 1 個，其餘寫「另 N 個」。
 * 沒有事件影響時，改列關聯個股代號（同一行、最多 3 檔），可點進個股頁。
 */
function TagLine({ groups, stocks, linkStock, noAnalysis = false }: { groups: ImpactGroup[]; stocks: string[]; linkStock: boolean; noAnalysis?: boolean }) {
  if (groups.length) {
    const restMobile = groups.length - 1;
    const restWide = groups.length - 3;
    return (
      <div className="flex min-h-11 flex-wrap items-center gap-x-4">
        {groups.slice(0, 3).map((group, index) => (
          <ImpactGroupBadge key={group.key} group={group} linkStock={linkStock} className={index > 0 ? 'hidden sm:inline-flex' : undefined} />
        ))}
        {restMobile > 0 ? <span className="text-xs whitespace-nowrap text-muted-foreground sm:hidden">另 <span className="font-mono tabular-nums">{restMobile}</span> 個</span> : null}
        {restWide > 0 ? <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline">另 <span className="font-mono tabular-nums">{restWide}</span> 個影響對象</span> : null}
      </div>
    );
  }
  if (!stocks.length && !noAnalysis) return null;
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-1">
      {/* 還沒有影響分析（排隊、失敗、略過或沒有分析）：和個股頁卡片同一個「尚無分析」徽章，不留空白 */}
      {noAnalysis ? <Badge className="mr-2">尚無分析</Badge> : null}
      {stocks.length ? <span className="mr-1 text-xs text-muted-foreground">關聯個股</span> : null}
      {stocks.map((stock) => (linkStock ? (
        <Link key={stock} href={`/stock/${stock}`} className="group/chip inline-flex min-h-11 items-center rounded-sm px-0.5 outline-none focus-lamp" aria-label={`查看 ${formatStockLabel(stock)} 個股`}>
          <Badge tone="outline" className="py-0 font-mono text-[11.5px] leading-5 font-normal tabular-nums transition-colors duration-(--dur-flash) group-hover/chip:border-border-strong group-hover/chip:text-foreground">{formatStockLabel(stock)}</Badge>
        </Link>
      ) : (
        <Badge key={stock} tone="outline" className="py-0 font-mono text-[11.5px] leading-5 font-normal tabular-nums">{formatStockLabel(stock)}</Badge>
      )))}
    </div>
  );
}

/** 文字連結：中性細底線，hover 轉墨色（全站的 textLinkClass） */
const textLink = cn('inline-flex min-h-11 items-center gap-1 rounded-sm outline-none focus-lamp', textLinkClass);

/** 新聞列（航船布告）：燈質列寫時間與來源，下方是標題、事件影響、摘要；列與列之間用細線分隔 */
export const NewsCard = memo(function NewsCard({ news, targetStock, relation = 'direct', returnTo, onNavigate, layout = 'stack' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sourceStatus = news.source_state?.status;
  const sourceLabel = sourceStatus === 'conflict' ? '來源有多個版本，尚未確認哪一版有效'
    : sourceStatus === 'superseded' ? '來源已更新，這是舊版本'
      : sourceStatus === 'historical' ? '這是舊版本的原文' : null;
  const noAnalysis = !sourceLabel && news.event_analysis?.status !== 'success';
  const stocks = Array.from(
    new Set([
      ...(!sourceLabel && news.event_analysis?.status === 'success'
        ? news.event_analysis.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id)
        : []),
      ...parseRelatedStocks(news),
    ]),
  ).slice(0, 3);
  const hasContent = Boolean(news.content?.trim());
  const originUrl = safeHttpUrl(news.url);
  const panelId = `news-content-${news.article_id}`;
  const impacts = sourceLabel ? [] : visibleImpacts(news, targetStock, relation);
  const groups = groupImpactsByTarget(impacts);
  const allGroups = sourceLabel ? [] : groupImpactsByTarget(visibleImpacts(news));
  const baseHref = newsHref(news.article_id, targetStock);
  const versionHref = sourceStatus === 'historical' && /^[0-9a-f]{64}$/.test(news.source_state?.revision_id ?? '')
    ? `${baseHref}${baseHref.includes('?') ? '&' : '?'}revision_id=${news.source_state!.revision_id}` : baseHref;
  const href = returnTo ? `${versionHref}${versionHref.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}` : versionHref;
  // 有分析時直接跳到新聞頁的分析區（手機版分析在全文之後）
  const actionHref = sourceLabel || noAnalysis ? href : `${href}#analysis`;
  // 來源只顯示對照得到的中文名稱，對照不到就不寫（不顯示後端代碼）
  const meta = [news.pub_time ? formatTime(news.pub_time) : null, newsSourceName(news.source)].filter(Boolean).join(' · ');

  const ledger = layout === 'ledger';
  const metaLine = meta ? <p className="characteristic mb-1.5">{meta}</p> : null;
  const heading = (
    <>
      <h3 className={cn('leading-[1.55] font-bold text-foreground', ledger ? 'text-[17px]' : 'text-base')}>
        <Link href={href} onNavigate={onNavigate} className="-my-2.5 block rounded-sm py-2.5 underline-offset-4 outline-none hover:underline hover:decoration-foreground focus-lamp">
          <span className="line-clamp-2">{news.title}</span>
        </Link>
      </h3>
      {sourceLabel ? <p className="mt-1 text-xs font-medium text-muted-foreground">{sourceLabel}；這個版本不顯示 AI 影響分析。</p> : null}
      {news.event_analysis?.content_truncated ? (
        <p className="mt-1 text-xs text-muted-foreground">分析僅使用部分內文，可能未涵蓋後段資訊。</p>
      ) : null}
    </>
  );
  // 摘要與展開的內文都限制行寬（約 40 個全形字），不隨面板拉到整列
  const excerpt = (
    <>
      {!expanded && snippet(news.content) ? <p className={cn('line-clamp-2 max-w-[40em] text-[13px] leading-relaxed text-muted-foreground', (ledger || (!targetStock && !allGroups.length && !stocks.length && !noAnalysis)) && 'mt-1')}>{snippet(news.content)}</p> : null}
      {hasContent && expanded ? <p id={panelId} className="mt-1 max-w-[40em] text-[13px] leading-relaxed whitespace-pre-line text-subtle">{stripHtml(news.content ?? '').trim()}</p> : null}
    </>
  );
  const actions = (
    // 每個動作只有一個入口，而且都有文字：站內用 → 、展開用 ⌄、離站才用外連圖示
    <div className="flex flex-wrap items-center gap-x-5 text-xs">
      <Link href={actionHref} onNavigate={onNavigate} className={cn(textLink, 'font-medium text-foreground')}>
        {sourceLabel ? '查看原文與版本狀態' : noAnalysis ? '查看內文' : '查看事件影響分析'}
        <ArrowRight size={13} className="text-muted-foreground" aria-hidden />
      </Link>
      {hasContent ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={cn(textLink, 'text-muted-foreground hover:text-foreground')}
        >
          {expanded ? '收起內文' : '展開內文'}
          <ChevronDown size={13} aria-hidden className={cn('transition-transform duration-(--dur-sweep)', expanded && 'rotate-180')} />
        </button>
      ) : null}
      {originUrl ? (
        <a href={originUrl} target="_blank" rel="noopener noreferrer" className={cn(textLink, 'text-muted-foreground hover:text-foreground')}>
          查看原始來源
          <ExternalLink size={12} aria-hidden />
          <span className="sr-only">（另開新視窗）</span>
        </a>
      ) : null}
    </div>
  );

  if (ledger && !targetStock) {
    // 帳頁列：寬版 8／4 切，左欄是燈質列（時間・來源）→ 標題（最醒目）→ 摘要；右欄是影響標籤與動作，上下疊放。手機單欄。
    return (
      <article data-news-article={news.article_id} className="lamp-row -mx-3 border-b px-3 pt-4 pb-1 last:border-b-0 lg:grid lg:grid-cols-12 lg:gap-x-8 lg:pb-3">
        <div className="min-w-0 lg:col-span-8">
          {metaLine}
          {heading}
          {excerpt}
        </div>
        <div className="min-w-0 lg:col-span-4 lg:pt-5">
          <TagLine groups={allGroups} stocks={stocks} linkStock noAnalysis={noAnalysis} />
          {actions}
        </div>
      </article>
    );
  }

  return (
    // 列尾不留線；左右負邊距讓 hover 底色貼齊面板內距（父層內距至少 12px）
    // 層級：燈質列（時間・來源，小字）→ 標題（最醒目）→ 一行標籤 → 摘要 → 文字動作列
    <article data-news-article={news.article_id} className="lamp-row -mx-3 border-b px-3 pt-4 pb-1 last:border-b-0">
      {metaLine}
      {heading}

      {targetStock ? (
        <div className="my-2 border bg-card px-3 py-1 text-xs">
          {impacts.length ? (
            <>
              <TagLine groups={groups} stocks={[]} linkStock={false} />
              {impacts[0]?.reason ? <p className="mb-1.5 text-xs leading-relaxed text-subtle"><span className="font-medium text-foreground">理由：</span>{impacts[0].reason}</p> : null}
            </>
          ) : (
            <p className="py-1.5 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{formatStockLabel(targetStock)}</span> · {noAnalysis ? '尚無分析' : '這則新聞沒有對應的事件影響'}
            </p>
          )}
          {expanded && impacts.some((impact) => impact.evidence?.length) ? (
            <div className="mt-1 mb-1.5 space-y-1.5 border-t pt-2">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Quote size={12} aria-hidden />
                原文依據
              </p>
              {impacts.flatMap((impact) => impact.evidence ?? []).map((ev, i) => (
                <p key={i} className="border-l-2 border-input pl-2.5 text-xs leading-relaxed text-subtle">
                  <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">[{ev.field === 'title' ? '標題' : '內文'}]</span>
                  「{ev.quote}」
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <TagLine groups={allGroups} stocks={stocks} linkStock noAnalysis={noAnalysis} />
      )}

      {excerpt}
      {actions}
    </article>
  );
});
