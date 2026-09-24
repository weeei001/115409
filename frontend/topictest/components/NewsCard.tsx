import React, { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, ExternalLink, Tag, ChevronDown, ArrowUpRight } from 'lucide-react';
import type { News } from '../lib/types';
import { formatTime } from '../lib/utils/date';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { DIRECTION_CLASSES, DIRECTION_LABELS, IMPORTANCE_LABELS, impactTarget, visibleImpacts } from '../lib/utils/newsImpact';

interface Props {
  news: News;
  index?: number;
  defaultExpanded?: boolean;
  targetStock?: string;
  relation?: 'direct' | 'market_context' | 'industry_context';
}

/** 主要關聯股票放 stock_id，其餘關聯股票放 tags（逗號分隔） */
function parseStocks(stockId: string | null, tags: string | null): string[] {
  const raw = [stockId ?? '', ...(tags ?? '').split(',')];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = item.trim().replace(/\.(?:TW|TWO)$/i, '');
    if (/^\d{4,6}$/.test(s)) seen.add(s);
  }
  return [...seen];
}

function truncateContent(content: string | null, maxLen = 120): string {
  if (!content) return '';
  const plain = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
}

function safeExternalUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const NewsCard = React.memo<Props>(function NewsCard({
  news,
  index = 0,
  defaultExpanded = false,
  targetStock,
  relation = 'direct',
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const reduceMotion = usePrefersReducedMotionClient();
  const stocks = news.event_analysis?.status === 'success'
    ? [...new Set(news.event_analysis.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id))]
    : parseStocks(news.stock_id, news.tags);
  const hasContent = !!news.content?.trim();
  const snippet = truncateContent(news.content);
  const safeUrl = safeExternalUrl(news.url);
  const contentPanelId = `news-content-${news.article_id ?? index}`;
  const expandLabel = expanded ? '收合新聞內文' : '展開新聞內文';

  const impacts = visibleImpacts(news, targetStock, relation);
  const visibleEvents = targetStock
    ? news.event_analysis.events.filter((event) => impacts.some((impact) => impact.event_key === event.key))
    : news.event_analysis.events;

  return (
    <motion.article
      className="group border-b border-[var(--color-border)] last:border-b-0 py-4 first:pt-0
                 relative pl-4 hover:-translate-y-0.5 transition-transform duration-200"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.25, delay: index * 0.04, ease: [0.25, 0.46, 0.45, 0.94] }
      }
    >
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-gradient-to-b from-brand to-brand-light opacity-0 group-hover:opacity-100 transition-opacity duration-300" aria-hidden />
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {stocks.length > 0 && stocks.slice(0, 3).map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-0.5 text-[11px] font-mono font-medium
                           text-brand bg-brand/8 px-1.5 py-0.5 rounded"
              >
                <Tag size={9} aria-hidden />
                {s}
              </span>
            ))}
            {news.pub_time && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                <Clock size={10} aria-hidden />
                {formatTime(news.pub_time)}
              </span>
            )}
          </div>

          <h3 className="text-sm font-semibold leading-snug mb-1
                         group-hover:text-brand transition-colors line-clamp-2">
            <Link
              href={`/news/${encodeURIComponent(news.article_id)}${targetStock ? `?stock=${targetStock}` : ''}`}
              className="hover:underline"
            >
              {news.title}
            </Link>
          </h3>

          {(
            <div className="my-2 space-y-1.5 text-xs">
              {news.event_analysis.status === 'success' ? (
                <>
                  {visibleEvents.slice(0, 2).map((event) => (
                    <p key={event.key} className="text-[var(--color-text-secondary)] leading-relaxed">
                      {event.summary}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-1.5">
                    {impacts.slice(0, 4).map((impact, i) => (
                      <span key={`${impact.event_key}-${impact.target_type}-${impact.target_id}-${i}`}
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${DIRECTION_CLASSES[impact.direction]}`}>
                        {impactTarget(impact)}｜{DIRECTION_LABELS[impact.direction]}｜{IMPORTANCE_LABELS[impact.importance]}
                      </span>
                    ))}
                    {impacts.length > 4 && <span className="text-[var(--color-text-muted)]">另有 {impacts.length - 4} 項影響</span>}
                    {impacts.length === 0 && <span className="text-[var(--color-text-muted)]">無可確認的{targetStock ? '此範圍' : '台股'}影響</span>}
                  </div>
                </>
              ) : (
                <span className="text-[var(--color-text-muted)]">
                  事件影響分析{news.event_analysis.status === 'failed' ? '失敗，等待重試' : news.event_analysis.status === 'skipped' ? '資料不足' : '尚待處理'}
                </span>
              )}
            </div>
          )}

          {snippet && !expanded && (
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed line-clamp-2">{snippet}</p>
          )}


          {hasContent && (
            <div id={contentPanelId} hidden={!expanded} className={expanded ? 'mt-1' : undefined}>
              {expanded &&
                (reduceMotion ? (
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
                    {news.content?.replace(/<[^>]*>/g, '').trim()}
                  </p>
                ) : (
                  <AnimatePresence initial={false}>
                    <motion.div
                      key="expanded"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                    >
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
                        {news.content?.replace(/<[^>]*>/g, '').trim()}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                ))}
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap text-xs">
            <Link
              href={`/news/${encodeURIComponent(news.article_id)}${targetStock ? `?stock=${targetStock}` : ''}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
            >
              <span>查看新聞全文與事件影響</span>
              <ArrowUpRight size={12} aria-hidden />
            </Link>
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-brand hover:underline"
              >
                <span>原始新聞來源</span>
                <ExternalLink size={10} aria-hidden />
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
          {hasContent && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={contentPanelId}
              aria-label={expandLabel}
              className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-elevated)] transition-colors
                         text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`開啟原文：${news.title ?? '新聞'}（新分頁）`}
              className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-elevated)] transition-colors
                         text-[var(--color-text-muted)] hover:text-brand
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </motion.article>
  );
});
