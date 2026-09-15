import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  Newspaper,
  ExternalLink,
  Clock,
  Quote,
  Bot,
  TrendingUp,
  Tag,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { SubpageHeader } from '../../components/SubpageHeader';
import { fetchNewsDetail } from '../../lib/api/news';
import type { News, NewsSentiment } from '../../lib/types';
import { parseNewsDate } from '../../lib/utils/date';
import { getStockDisplayName } from '../../lib/utils/symbolNames';
import { breadcrumbsTrail } from '../../lib/nav';

const SENTIMENT_META: Record<
  string,
  {
    label: string;
    description: string;
    pillClass: string;
    borderClass: string;
    bgClass: string;
  }
> = {
  positive: {
    label: '正面',
    description: '新聞內容對該公司營運、營收或展望呈現正向效益。',
    pillClass: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
    borderClass: 'border-emerald-500/30',
    bgClass: 'bg-emerald-500/5',
  },
  negative: {
    label: '負面',
    description: '新聞內容提及利空、虧損、賣壓或不利營運之因素。',
    pillClass: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
    borderClass: 'border-rose-500/30',
    bgClass: 'bg-rose-500/5',
  },
  neutral: {
    label: '中性',
    description: '新聞為一般市場客觀事實或例行公告，無明顯多空偏向。',
    pillClass: 'text-slate-300 bg-slate-500/15 border-slate-500/30',
    borderClass: 'border-slate-500/30',
    bgClass: 'bg-slate-500/5',
  },
  mixed: {
    label: '正負混合',
    description: '新聞同時包含正面與負面訊息，兩者均具實質影響。',
    pillClass: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
    borderClass: 'border-amber-500/30',
    bgClass: 'bg-amber-500/5',
  },
  insufficient: {
    label: '資訊不足',
    description: '僅提及公司名稱或代號，未提供實質營運關聯或具體數據。',
    pillClass: 'text-zinc-400 bg-zinc-500/15 border-zinc-500/30',
    borderClass: 'border-zinc-500/30',
    bgClass: 'bg-zinc-500/5',
  },
};

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
    const cleaned = item.trim().replace(/\.TW$/i, '');
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
                title="AI 情緒分析原文引用依據"
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
        const sentiments = data.sentiments ?? [];
        if (stockParam && /^\d{4,6}$/.test(stockParam) && sentiments.some((s) => s.target_stock_id === stockParam)) {
          setSelectedStock(stockParam);
        } else if (sentiments.length > 0 && /^\d{4,6}$/.test(sentiments[0].target_stock_id)) {
          setSelectedStock(sentiments[0].target_stock_id);
        } else if (data.stock_id && /^\d{4,6}$/.test(data.stock_id)) {
          setSelectedStock(data.stock_id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '無法載入新聞文章');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router.isReady, articleId, stockParam]);

  const sentiments = useMemo(() => news?.sentiments ?? [], [news]);
  const activeSentiment: NewsSentiment | undefined = useMemo(() => {
    if (selectedStock) {
      return sentiments.find((s) => s.target_stock_id === selectedStock) ?? sentiments[0];
    }
    return sentiments[0];
  }, [sentiments, selectedStock]);

  const allQuotes = useMemo(() => {
    if (!activeSentiment?.evidence) return [];
    return activeSentiment.evidence.map((e) => e.quote).filter(Boolean);
  }, [activeSentiment]);

  const originalLink = safeUrl(news?.url ?? null);
  const stockCodes = useMemo(
    () => parseStockCodes(news?.stock_id ?? null, news?.tags ?? null),
    [news]
  );

  const metaLabel = activeSentiment ? SENTIMENT_META[activeSentiment.label] : null;

  const breadcrumbs = useMemo(() => {
    if (selectedStock && /^\d{4,6}$/.test(selectedStock)) {
      const stockName = getStockDisplayName(selectedStock);
      return breadcrumbsTrail(
        { label: `${selectedStock} ${stockName}`, href: `/stock/${selectedStock}` },
        '新聞內容與 AI 分析'
      );
    }
    return breadcrumbsTrail('新聞內容與 AI 分析');
  }, [selectedStock]);

  const pageTitle = news?.title
    ? `${news.title} - 新聞與 AI 情緒分析 | 股海明燈`
    : '新聞內容與 AI 情緒分析 | 股海明燈';

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Head>
        <title>{pageTitle}</title>
        <meta
          name="description"
          content={news?.title ? `新聞：${news.title} 完整內容與 AI 金融情緒分析。` : '新聞內容與 AI 情緒分析'}
        />
      </Head>

      <SubpageHeader
        icon={Newspaper}
        title="新聞內容與 AI 情緒分析"
        subtitle={news?.title ? `${news.source ?? '新聞'} 報導與大語言模型引證` : '載入中...'}
        breadcrumbs={breadcrumbs}
        autoBreadcrumbs={false}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3" aria-busy="true">
            <Loader2 size={36} className="text-brand animate-spin" />
            <p className="text-sm text-[var(--color-text-muted)]">載入新聞內容與 AI 分析...</p>
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
                      AI 新聞情緒分析
                    </h2>
                  </div>
                </div>

                {/* 多檔股票情緒切換頁籤（若有多檔股票分析） */}
                {sentiments.length > 1 && (
                  <div>
                    <div className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">
                      分析目標股票：
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {sentiments.map((s) => {
                        const isCurrent = s.target_stock_id === selectedStock;
                        return (
                          <button
                            key={s.target_stock_id}
                            type="button"
                            onClick={() => setSelectedStock(s.target_stock_id)}
                            className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors cursor-pointer ${
                              isCurrent
                                ? 'border-brand text-brand bg-brand/10 font-semibold'
                                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand/40'
                            }`}
                          >
                            {s.target_stock_id} {getStockDisplayName(s.target_stock_id)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeSentiment ? (
                  <div className="space-y-4">
                    {/* 情緒標籤大卡片 */}
                    <div
                      className={`p-3.5 rounded-xl border ${metaLabel?.borderClass ?? 'border-[var(--color-border)]'} ${metaLabel?.bgClass ?? 'bg-[var(--color-bg-elevated)]'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-xs text-[var(--color-text-muted)]">
                          分析目標：{activeSentiment.target_stock_id}{' '}
                          {getStockDisplayName(activeSentiment.target_stock_id)}
                        </span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${metaLabel?.pillClass ?? 'border-zinc-500 text-zinc-300'}`}
                        >
                          {metaLabel?.label ?? activeSentiment.label}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        {metaLabel?.description}
                      </p>
                    </div>

                    {/* 理由 */}
                    <div>
                      <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">
                        判斷理由：
                      </div>
                      <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        {activeSentiment.reason}
                      </div>
                    </div>

                    {/* 原文依據引證 */}
                    {activeSentiment.evidence && activeSentiment.evidence.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
                          <span className="flex items-center gap-1">
                            <Quote size={12} className="text-brand" />
                            原文依據引用：
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            共 {activeSentiment.evidence.length} 處引證
                          </span>
                        </div>
                        <div className="space-y-2">
                          {activeSentiment.evidence.map((ev, i) => (
                            <div
                              key={i}
                              className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 text-xs"
                            >
                              <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] mb-1 font-mono">
                                <span>[{ev.field === 'title' ? '標題' : '內文'}]</span>
                              </div>
                              <blockquote className="border-l-2 border-brand/60 pl-2 text-xs text-[var(--color-text-secondary)] leading-relaxed italic">
                                "{ev.quote}"
                              </blockquote>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 分析時間與免責聲明 */}
                    <div className="pt-2 border-t border-[var(--color-border)]/60 text-[11px] text-[var(--color-text-muted)] space-y-1.5">
                      {activeSentiment.analyzed_at && (
                        <div>分析時間：{formatFullDateTime(activeSentiment.analyzed_at)}</div>
                      )}
                      <div className="flex items-start gap-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]/90">
                        <Info size={12} className="shrink-0 mt-0.5" />
                        <span>情緒反映新聞訊息，不代表股價預測。投資決策請綜合考量基本面與技術面。</span>
                      </div>
                    </div>

                    {/* 跳轉個股儀表板按鈕 */}
                    {/^\d{4,6}$/.test(activeSentiment.target_stock_id) && (
                      <div className="pt-1">
                        <Link
                          href={`/stock/${activeSentiment.target_stock_id}`}
                          className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-brand/40 text-xs font-medium text-[var(--color-text-primary)] hover:text-brand transition-colors"
                        >
                          <TrendingUp size={13} />
                          <span>前往 {activeSentiment.target_stock_id} 個股儀表板</span>
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-[var(--color-text-muted)] space-y-2">
                    <p>此篇新聞目前尚無 AI 情緒分析記錄。</p>
                    {stockCodes.length > 0 && (
                      <Link
                        href={`/stock/${stockCodes[0]}`}
                        className="inline-flex items-center gap-1 text-brand hover:underline font-medium"
                      >
                        查看 {stockCodes[0]} 個股頁面
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
