import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Newspaper,
  ExternalLink,
  Clock,
  Bot,
  Tag,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { SubpageHeader } from '../../components/SubpageHeader';
import { NewsEventAnalysisPanel } from '../../components/news/NewsEventAnalysisPanel';
import { fetchNewsDetail } from '../../lib/api/news';
import type { News } from '../../lib/types';
import { parseNewsDate } from '../../lib/utils/date';
import { getStockDisplayName } from '../../lib/utils/symbolNames';
import { breadcrumbsTrail } from '../../lib/nav';

function formatFullDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseNewsDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseStockCodes(stockId: string | null, tags: string | null): string[] {
  const raw = [stockId ?? '', ...(tags ?? '').split(',')];
  const set = new Set<string>();
  for (const item of raw) {
    const cleaned = item.trim().replace(/\.(?:TW|TWO)$/i, '');
    if (cleaned && /^\d{4,6}$/.test(cleaned)) {
      set.add(cleaned);
    }
  }
  return Array.from(set);
}

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 依據 AI 引用句片段高亮新聞內文文字
 */
function renderHighlightedContent(content: string, quotes: string[]) {
  if (!content) return null;
  const cleanContent = content.replace(/<[^>]*>/g, '').trim();

  const validQuotes = quotes
    .map((q) => q.trim())
    .filter((q) => q.length > 2 && cleanContent.includes(q));

  if (validQuotes.length === 0) {
    return cleanContent.split('\n').map((para, i) =>
      para.trim() ? (
        <p key={i} className="mb-4 leading-relaxed text-sm sm:text-base text-[var(--color-text-secondary)]">
          {para.trim()}
        </p>
      ) : null
    );
  }

  // 排序：長句子優先比對，避免被短句子拆解
  const sortedQuotes = [...validQuotes].sort((a, b) => b.length - a.length);

  // 以正則切割文本
  const escapedQuotes = sortedQuotes.map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedQuotes.join('|')})`, 'g');

  const paragraphs = cleanContent.split('\n');

  return paragraphs.map((para, pIndex) => {
    if (!para.trim()) return null;
    const parts = para.split(regex);

    return (
      <p key={pIndex} className="mb-4 leading-relaxed text-sm sm:text-base text-[var(--color-text-secondary)]">
        {parts.map((part, partIndex) => {
          const isQuote = sortedQuotes.includes(part);
          if (isQuote) {
            return (
              <mark
                key={partIndex}
                className="bg-amber-500/20 text-amber-300 dark:text-amber-200 border-b border-amber-500/50 px-1 py-0.5 rounded font-medium"
                title="新聞分析原文引用依據"
              >
                {part}
              </mark>
            );
          }
          return <React.Fragment key={partIndex}>{part}</React.Fragment>;
        })}
      </p>
    );
  });
}

export default function NewsDetailPage() {
  const router = useRouter();
  const articleId = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';
  const stockParam = (Array.isArray(router.query.stock) ? router.query.stock[0] : router.query.stock) || '';

  const [news, setNews] = useState<News | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<string>('');

  useEffect(() => {
    if (!router.isReady || !articleId) return;

    setLoading(true);
    setError(null);

    fetchNewsDetail(articleId, stockParam || undefined)
      .then((data) => {
        setNews(data);
        setSelectedStock(/^\d{4,6}$/.test(stockParam) ? stockParam : '');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '無法載入新聞文章');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router.isReady, articleId, stockParam]);

  const allQuotes = useMemo(() => {
    if (news?.event_analysis.status !== 'success') return [];
    return [
      ...news.event_analysis.events.flatMap((event) => event.evidence.map((item) => item.quote)),
      ...news.event_analysis.impacts.flatMap((impact) => impact.evidence.map((item) => item.quote)),
    ].filter(Boolean);
  }, [news?.event_analysis]);

  const originalLink = safeUrl(news?.url ?? null);
  const stockCodes = useMemo(() => news?.event_analysis.status === 'success'
    ? [...new Set(news.event_analysis.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id))]
    : [...new Set([...parseStockCodes(news?.stock_id ?? null, news?.tags ?? null),
      ...(/^\d{4,6}$/.test(selectedStock) ? [selectedStock] : [])])],
  [news, selectedStock]);

  const breadcrumbs = useMemo(() => {
    if (selectedStock && /^\d{4,6}$/.test(selectedStock)) {
      const stockName = getStockDisplayName(selectedStock);
      return breadcrumbsTrail(
        { label: `${selectedStock} ${stockName}`, href: `/stock/${selectedStock}` },
        '新聞內容與事件影響'
      );
    }
    return breadcrumbsTrail('新聞內容與事件影響');
  }, [selectedStock]);

  const pageTitle = news?.title
    ? `${news.title} - 新聞事件影響 | 股海明燈`
    : '新聞內容與事件影響 | 股海明燈';

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Head>
        <title>{pageTitle}</title>
        <meta
          name="description"
          content={news?.title ? `新聞：${news.title} 完整內容與事件影響判讀。` : '新聞內容與事件影響判讀'}
        />
      </Head>

      <SubpageHeader
        icon={Newspaper}
        title="新聞內容與事件影響"
        subtitle={news?.title ? `${news.source ?? '新聞'} 報導與大語言模型引證` : '載入中...'}
        breadcrumbs={breadcrumbs}
        autoBreadcrumbs={false}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3" aria-busy="true">
            <Loader2 size={36} className="text-brand animate-spin" />
            <p className="text-sm text-[var(--color-text-muted)]">載入新聞內容與事件影響...</p>
          </div>
        ) : error || !news ? (
          <div className="max-w-md mx-auto my-16 p-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-center space-y-4 shadow-[var(--shadow-card)]">
            <AlertCircle size={40} className="mx-auto text-up-emphasis" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">無法讀取新聞</h2>
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
              {error ?? '找不到指定的新聞文章。'}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
              >
                <ArrowLeft size={14} />
                返回上一頁
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* 左側：新聞主要內容閱讀區 (8 欄) */}
            <article className="lg:col-span-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:p-8 shadow-[var(--shadow-card)]">
              {/* 關聯股票標籤列 */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {stockCodes.map((code) => {
                  const name = getStockDisplayName(code);
                  const isCurrent = code === selectedStock;
                  return (
                    <Link
                      key={code}
                      href={`/stock/${code}`}
                      className={`inline-flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded transition-colors ${
                        isCurrent
                          ? 'text-brand bg-brand/15 border border-brand/30'
                          : 'text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-brand/40'
                      }`}
                    >
                      <Tag size={11} aria-hidden />
                      {code} {name !== code ? name : ''}
                    </Link>
                  );
                })}

                {news.source && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-2 py-0.5 rounded border border-[var(--color-border)]">
                    <Newspaper size={11} aria-hidden />
                    {news.source.toUpperCase()}
                  </span>
                )}

                {news.pub_time && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    <Clock size={11} aria-hidden />
                    {formatFullDateTime(news.pub_time)}
                  </span>
                )}
              </div>

              {/* 新聞標題 */}
              <h1 className="text-xl sm:text-2xl font-bold leading-snug text-[var(--color-text-primary)] mb-4">
                {news.title}
              </h1>

              {/* 原始新聞連結按鈕 */}
              {originalLink && (
                <div className="mb-6 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    本文由第三方媒體報導，點擊右側按鈕可查看原始發布報導。
                  </div>
                  <a
                    href={originalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-brand/40 text-xs font-medium text-brand bg-brand/10 hover:bg-brand/20 transition-colors cursor-pointer"
                  >
                    <span>前往原始新聞來源</span>
                    <ExternalLink size={13} aria-hidden />
                  </a>
                </div>
              )}

              <div className="border-t border-[var(--color-border)]/70 pt-6">
                {news.content ? (
                  <div className="prose prose-invert max-w-none">
                    {renderHighlightedContent(news.content, allQuotes)}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)] italic">此新聞無內文記錄。</p>
                )}
              </div>
            </article>

            {/* 右側：AI 分析情緒側欄 (4 欄，黏性置頂) */}
            <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-[var(--shadow-card)] space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                  <div className="flex items-center gap-2">
                    <Bot size={18} className="text-brand" />
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      AI 新聞事件影響
                    </h2>
                  </div>
                </div>

                <NewsEventAnalysisPanel analysis={news.event_analysis} />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
