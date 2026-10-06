import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { News } from '@/lib/types/api';
import { formatDateTime } from '@/lib/utils/date';
import { newsSourceName } from '@/lib/news/newsSource';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { safeHttpUrl } from '@/lib/utils/url';
import { EmptyState } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ArticleModel, ArticleSegment } from './articleParagraphs';
import { taiwanStockHref, UNSUPPORTED_STOCK_MARKET_MESSAGE } from '@/lib/news/newsLinks';

/**
 * 引用句平時只有一條很淡的 1px 點狀底線（約 40% 不透明的 input 色；安靜、不像連結，但仍可用鍵盤到達），
 * 手機（< sm）連這條線都不畫，只有選取中的句子才標出來，內文不會被一條條點線切花。
 * 與目前選取／滑過／聚焦的影響項目對應的句子，換成 2px 實線文字色底線＋中性底色
 * （狀態不只靠顏色；不用燈色，燈只當光用）。
 */
const citeIdle = 'no-underline sm:underline decoration-dotted decoration-input/40 decoration-1 underline-offset-[6px]';
const citeActive =
  'underline underline-offset-[6px] bg-input/20 dark:bg-input/40 text-foreground decoration-solid decoration-foreground decoration-2 box-decoration-clone';
/** 圖說裡示範用的點狀底線：比內文清楚一點，才看得出是在說哪種線 */
const citeSample = 'underline decoration-dotted decoration-input decoration-1 underline-offset-[6px]';

export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** --app-header-height 由頁首寫成 px；尚未寫入時是 main.css 的 rem 預設值 */
export function appHeaderHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 56;
  return raw.endsWith('rem') ? value * 16 : value;
}

/** 已在視窗內（頁首下方）就不捲動 */
export function scrollIntoViewIfNeeded(el: Element, block: ScrollLogicalPosition = 'center') {
  const rect = el.getBoundingClientRect();
  const header = appHeaderHeight();
  if (rect.top >= header + 8 && rect.bottom <= window.innerHeight - 8) return;
  el.scrollIntoView({ block, behavior: scrollBehavior() });
}

interface Props {
  news: News;
  stockCodes: string[];
  selectedStock: string;
  /** 畫面用的分段與引用標示（features/news/articleParagraphs.ts） */
  model: ArticleModel;
  /** 目前對照中的引用句（面板滑過、聚焦或選取的影響項目） */
  activeQuotes: Set<string>;
  /** 已選取（不只是滑過）的引用句，對應 aria-pressed */
  pressedQuotes: Set<string>;
  /** 點內文引用句（由長到短的候選引用句）：選取面板中對應的影響項目；沒有對應時不給 */
  onSelectQuote?: (quotes: string[]) => void;
  /** 每次遞增就把第一個對照中的句子捲進視窗 */
  scrollRequest: number;
}

/** 連續的引用片段合成一個可點的單位（一個 tab 停點），裡面各片段各自判斷是否對照中 */
function groupRuns(segments: ArticleSegment[]) {
  const runs: { cited: boolean; segments: ArticleSegment[] }[] = [];
  for (const segment of segments) {
    const cited = segment.quotes.length > 0;
    const last = runs[runs.length - 1];
    if (last && last.cited === cited && cited) last.segments.push(segment);
    else runs.push({ cited, segments: [segment] });
  }
  return runs;
}

/**
 * 新聞內容頁左欄：燈質列（來源・時間）、關聯個股、原始連結、內文。
 * 標題已是頁面 h1（SiteHeader），這裡的 h2 只留給螢幕報讀器維持文件結構。
 * 內文 17px／行高 1.9、行寬約 34em；沒有換行的長文在畫面上依句尾切成每段 3～4 句（不改任何字）。
 * 引用句平時只有低對比的點狀底線；與面板對照中的句子才換成實線並加中性底色，點一下可選取對應的事件影響。
 */
export function NewsArticle({ news, stockCodes, selectedStock, model, activeQuotes, pressedQuotes, onSelectQuote, scrollRequest }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasHighlights = model.quotes.length > 0;
  const originalLink = safeHttpUrl(news.url);
  // 來源只顯示對照得到的中文名稱，對照不到就不寫（不顯示後端代碼）
  const meta = [newsSourceName(news.source), news.pub_time ? formatDateTime(news.pub_time) : null].filter(Boolean).join(' · ');
  // 一般版本（active／untracked）的擷取說明：縮成 meta 下的一行小字，不佔首屏；舊版本、衝突、被取代由頁面的提示框說明
  const sourceStatus = news.source_state?.status;
  const observedAt = news.source_state?.observed_at ? formatDateTime(news.source_state.observed_at) : '';
  const versionNote = sourceStatus === 'active' || sourceStatus === 'untracked'
    ? `${observedAt ? `這是 ${observedAt} 擷取的版本` : '這是擷取當時的版本'}，來源之後可能修改過。` : null;

  useEffect(() => {
    if (!scrollRequest) return;
    const frame = requestAnimationFrame(() => {
      const target = bodyRef.current?.querySelector('[data-cite-active="true"]');
      if (target) scrollIntoViewIfNeeded(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  const quoteText = (segment: ArticleSegment) => segment.quotes.map((index) => model.quotes[index]);

  return (
    <article className="min-w-0 bg-card p-5 sm:p-8 lg:col-span-8 lg:border-r">
      {meta ? <p className={cn('characteristic', versionNote ? 'mb-1' : 'mb-3')}>{meta}</p> : null}
      {versionNote ? <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{versionNote}</p> : null}

      <h2 className="sr-only">{news.title}</h2>

      {stockCodes.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="characteristic mr-1">關聯個股</span>
          {stockCodes.map((code) => {
            const current = code === selectedStock;
            const stockHref = taiwanStockHref(code);
            if (!stockHref) return <span key={code} title={UNSUPPORTED_STOCK_MARKET_MESSAGE} className="font-mono text-[13px] tabular-nums">{formatStockLabel(code)}<span className="sr-only">（{UNSUPPORTED_STOCK_MARKET_MESSAGE}）</span></span>;
            return (
              <Link
                key={code}
                href={stockHref}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-sm border px-2.5 font-mono text-[13px] font-medium tabular-nums outline-none transition-colors duration-(--dur-flash) focus-lamp',
                  current ? 'border-border-strong bg-accent text-foreground underline-offset-4 hover:underline' : 'border-input bg-card text-subtle hover:border-border-strong hover:text-foreground',
                )}
              >
                {formatStockLabel(code)}
              </Link>
            );
          })}
        </div>
      ) : null}

      {originalLink ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y py-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground">本文由第三方媒體報導，原始發布內容請見原始新聞來源。</p>
          <Button asChild variant="outline">
            <a href={originalLink} target="_blank" rel="noopener noreferrer">
              前往原始新聞來源
              <ExternalLink aria-hidden className="text-muted-foreground" />
            </a>
          </Button>
        </div>
      ) : (
        <div className="mb-6 border-t" />
      )}

      {model.paragraphs.length ? (
        <>
          {hasHighlights ? (
            <p className="mb-5 max-w-[min(34em,68ch)] text-[13px] leading-relaxed text-muted-foreground">
              <span className="hidden sm:inline">
                <span className={citeSample}>點狀底線</span>是事件分析引用的原文，點一下可對照事件影響。
              </span>
              {/* 手機的內文不畫點狀底線：改說明從下方的原文依據標出引用句 */}
              <span className="sm:hidden">事件分析引用的原文列在下方「原文依據」，點選即可在內文標出。</span>
            </p>
          ) : null}
          <div ref={bodyRef} className="max-w-[min(34em,68ch)] space-y-[1.15em] text-[17px] leading-[1.9] text-foreground">
            {model.paragraphs.map((segments, i) => (
              <p key={i}>
                {groupRuns(segments).map((run, j) => {
                  if (!run.cited) return <React.Fragment key={j}>{run.segments[0].text}</React.Fragment>;
                  const runQuotes = Array.from(new Set(run.segments.flatMap(quoteText)));
                  const active = runQuotes.some((quote) => activeQuotes.has(quote));
                  const pressed = runQuotes.some((quote) => pressedQuotes.has(quote));
                  // 由長到短：最長的通常是影響項目直接引用的那句
                  const candidates = [...runQuotes].sort((a, b) => b.length - a.length);
                  const pieces = run.segments.map((segment, k) => {
                    const on = quoteText(segment).some((quote) => activeQuotes.has(quote));
                    return (
                      <span key={k} data-cite-active={on ? 'true' : undefined} className={cn('transition-colors duration-(--dur-flash)', on ? citeActive : citeIdle)}>
                        {segment.text}
                      </span>
                    );
                  });
                  if (!onSelectQuote) return <mark key={j} className="bg-transparent text-inherit">{pieces}</mark>;
                  // 引用句是行內文字（會跨行），用 span＋role="button"；原生 button 在 Chrome 不能跨行斷行
                  return (
                    <span
                      key={j}
                      role="button"
                      tabIndex={0}
                      aria-pressed={pressed}
                      title="對照事件影響分析"
                      data-cite-run={active ? 'active' : 'idle'}
                      onClick={() => onSelectQuote(candidates)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectQuote(candidates);
                        }
                      }}
                      className="cursor-pointer rounded-sm outline-none focus-lamp hover:[&>span]:decoration-border-strong focus-visible:[&>span]:decoration-border-strong"
                    >
                      {pieces}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        </>
      ) : (
        <EmptyState>此新聞無內文記錄。</EmptyState>
      )}
    </article>
  );
}
