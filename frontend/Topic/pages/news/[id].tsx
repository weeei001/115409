import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Newspaper, RefreshCw } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Button, textLinkClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { LedgerHeading, LightGlyph, type LightState } from '@/components/common/Ledger';
import { NewsArticle, scrollIntoViewIfNeeded } from '@/features/news/NewsArticle';
import { NewsEventAnalysisPanel, type CitationLink } from '@/features/news/NewsEventAnalysisPanel';
import { buildArticleParagraphs } from '@/features/news/articleParagraphs';
import { buildCitationIndex } from '@/features/news/citations';
import { TitleWithBreaks } from '@/features/news/titleBreaks';
import { fetchNewsDetail } from '@/lib/api/news';
import type { News } from '@/lib/types/api';
import { newsDetailBreadcrumbs, parseRelatedStocks } from '@/lib/news/newsLinks';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { impactTarget } from '@/lib/utils/newsImpact';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { stockNewsReturnHref } from '@/lib/news/stockNewsView';
import { formatDateTime } from '@/lib/utils/date';
import { newsSourceName } from '@/lib/news/newsSource';
import { NEWS_IMPACT_DISCLAIMER } from '@/lib/disclaimers';

const isStockCode = (code: string | null | undefined): code is string => Boolean(code && /^\d{4,6}$/.test(code));
const firstQuery = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

function pickStock(news: News, stockParam: string): string {
  const companies = news.event_analysis?.impacts.filter((impact) => impact.target_type === 'company') ?? [];
  if (isStockCode(stockParam) && companies.some((impact) => impact.target_id === stockParam)) return stockParam;
  if (isStockCode(companies[0]?.target_id)) return companies[0].target_id;
  if (isStockCode(news.stock_id)) return news.stock_id;
  return '';
}

export default function NewsDetailPage() {
  const router = useRouter();
  const articleId = firstQuery(router.query.id);
  const stockParam = firstQuery(router.query.stock);
  const revisionId = firstQuery(router.query.revision_id);
  const newsReturn = stockNewsReturnHref(firstQuery(router.query.returnTo), stockParam);
  const [news, setNews] = useState<News | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState('');
  // 內文引用句 ↔ 事件影響面板的對照狀態（只影響畫面）
  const [citeSelected, setCiteSelected] = useState<{ id: string; quote?: string } | null>(null);
  const [citePreview, setCitePreview] = useState<string | null>(null);
  const [articleScroll, setArticleScroll] = useState(0);
  const [panelReveal, setPanelReveal] = useState<{ id: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!router.isReady || !articleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNews(null);
    fetchNewsDetail(articleId, stockParam || undefined, revisionId || undefined)
      .then((data) => {
        if (cancelled) return;
        setNews(data);
        setSelectedStock(pickStock(data, stockParam));
        setCiteSelected(null);
        setCitePreview(null);
      })
      .catch((err) => { if (!cancelled) setError(userFacingMessage(err, '無法載入新聞文章')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [router.isReady, articleId, stockParam, revisionId]);

  const analysis = news?.event_analysis;
  // 燈質記號：後端說分析還在排隊（pending）才算讀取中＝Q；分析失敗＝熄燈；其餘（成功、略過、沒有分析）＝F
  const analysisState: LightState = analysis?.status === 'pending' ? 'loading' : analysis?.status === 'failed' ? 'error' : 'ready';
  const quotes = useMemo(() => {
    if (!analysis || analysis.status !== 'success') return [];
    return [...analysis.events.flatMap((event) => event.evidence), ...analysis.impacts.flatMap((impact) => impact.evidence)]
      .map((evidence) => evidence.quote)
      .filter(Boolean);
  }, [analysis]);
  const articleModel = useMemo(() => buildArticleParagraphs(news?.content, quotes), [news?.content, quotes]);
  const citations = useMemo(() => buildCitationIndex(analysis), [analysis]);
  const activeQuotes = useMemo(() => {
    const focus = citePreview ? { id: citePreview } : citeSelected;
    return new Set(!focus ? [] : 'quote' in focus && focus.quote ? [focus.quote] : citations.quotesOf(focus.id));
  }, [citePreview, citeSelected, citations]);
  const pressedQuotes = useMemo(
    () => new Set(!citeSelected ? [] : citeSelected.quote ? [citeSelected.quote] : citations.quotesOf(citeSelected.id)),
    [citeSelected, citations],
  );
  const selectFromArticle = useCallback((candidates: string[]) => {
    const quote = candidates.find((item) => citations.ownerOf(item));
    const owner = quote ? citations.ownerOf(quote) : null;
    if (!quote || !owner) return;
    setCitePreview(null);
    if (citeSelected?.id === owner && citeSelected.quote === quote) {
      setCiteSelected(null);
      return;
    }
    setCiteSelected({ id: owner, quote });
    setPanelReveal((prev) => ({ id: owner, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [citations, citeSelected]);
  const locatable = useMemo(() => {
    const present = new Set(articleModel.quotes);
    return (quote: string) => present.has(quote.trim());
  }, [articleModel.quotes]);
  const citationLink: CitationLink = {
    activeId: citePreview ?? citeSelected?.id ?? null,
    selected: citeSelected,
    locatable,
    onPreview: setCitePreview,
    onSelect: (target, scroll) => {
      setCitePreview(null);
      setCiteSelected(target);
      if (target && scroll) setArticleScroll((n) => n + 1);
    },
    reveal: panelReveal,
  };
  const stockCodes = useMemo(() => {
    if (!news) return [];
    return Array.from(new Set([
      ...parseRelatedStocks(news, true),
      ...(analysis?.impacts.filter((impact) => impact.target_type === 'company').map((impact) => impact.target_id) ?? []),
    ]));
  }, [analysis, news]);

  // 「國巨*」的星號是資料中公司簡稱的一部分；畫面上有這種名稱時才加一行註腳
  const hasStarredName = useMemo(() => {
    if (analysis?.status !== 'success') return false;
    return analysis.impacts.some((impact) => /[*＊]$/.test(impactTarget(impact).trim()));
  }, [analysis]);

  const breadcrumbs = useMemo(() => newsDetailBreadcrumbs(stockParam, newsReturn), [stockParam, newsReturn]);
  // 新聞卡的「查看事件影響分析」帶 #analysis：資料到了才有分析欄，手機版分析在全文之後，要自己捲過去
  const analysisReady = Boolean(news);
  useEffect(() => {
    if (!analysisReady || window.location.hash !== '#analysis') return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById('analysis');
      if (target) scrollIntoViewIfNeeded(target, 'start');
    });
    return () => cancelAnimationFrame(frame);
  }, [analysisReady]);
  const goBack = () => {
    // 直接開這個網址時沒有上一頁，退回首頁（和頁首的返回鈕一致）
    if (window.history.length > 1) router.back();
    else void router.push('/');
  };
  const sourceStatus = news?.source_state?.status;
  const specialSource = sourceStatus === 'historical' || sourceStatus === 'conflict' || sourceStatus === 'superseded';
  const pageTitle = `股海明燈｜${news?.title ?? '新聞內容與事件影響'}`;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={news?.title ? `新聞：${news.title} 完整內容與事件影響分析。` : '新聞內容與事件影響分析'} />
      </Head>

      <SiteHeader
        icon={Newspaper}
        title={news?.title || '新聞內容與事件影響'}
        titleNode={news?.title ? <TitleWithBreaks title={news.title} /> : undefined}
        titleWrap={Boolean(news?.title)}
        subtitle={news?.title ? `${newsSourceName(news.source) ?? '新聞'}報導與事件影響分析` : !loading && (error || !news) ? '無法讀取新聞' : '載入中…'}
        breadcrumbs={breadcrumbs}
      />

      <main aria-label="新聞內容" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {newsReturn && <Button variant="outline" className="mb-4" onClick={() => void router.push(newsReturn)}><ArrowLeft aria-hidden className="text-muted-foreground" />返回相關新聞列表</Button>}
        {loading ? (
          // 載入＝燈質 Q：與完成後同一張帳頁的形狀，左文右分析，並寫出「載入中」
          <div className="grid grid-cols-1 border bg-card lg:grid-cols-12">
            <LoadingRows label="載入新聞內容與事件分析中…" className="h-[440px] lg:col-span-8 lg:border-r" />
            <div className="q-rows hidden h-[440px] lg:col-span-4 lg:block" aria-hidden />
          </div>
        ) : error || !news ? (
          // 錯誤＝熄燈：不動的錯誤提示，附重試與返回
          <section className="max-w-xl">
            <LedgerHeading title="無法讀取新聞" className="mb-3" />
            <Notice tone="danger">{error ?? '找不到指定的新聞文章。'}</Notice>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => router.reload()}><RefreshCw aria-hidden />重試</Button>
              <Button variant="ghost" onClick={goBack} className="border border-transparent hover:border-border-strong"><ArrowLeft aria-hidden />返回上一頁</Button>
            </div>
          </section>
        ) : (
          <div className="space-y-4">
            {/* 一般版本的擷取說明在內文 meta 列下方（NewsArticle）；這裡只提示舊版本、衝突、被取代 */}
            {news.source_state && (specialSource || revisionId) && (
              <Notice tone={sourceStatus === 'conflict' ? 'warning' : 'info'}>
                {specialSource ? <span className="block">{sourceStatus === 'historical'
                  ? '這是舊版本的原文，不是目前的版本；這個版本不顯示 AI 影響分析。'
                  : sourceStatus === 'conflict'
                    ? '來源有多個內容互相矛盾的版本，尚未確認哪一版有效；暫不顯示 AI 影響分析。'
                    : '來源已更新，這是舊版本，保留原文供對照；暫不顯示 AI 影響分析。'}</span> : null}
                {specialSource && news.source_state.observed_at && <span className="mt-1 block font-mono text-xs tabular-nums opacity-90">這個版本的擷取時間：{formatDateTime(news.source_state.observed_at)}</span>}
                {revisionId && <a className={cn('mt-1 inline-flex min-h-11 items-center outline-none focus-lamp', textLinkClass)} href={`/news/${encodeURIComponent(articleId)}${stockParam ? `?stock=${encodeURIComponent(stockParam)}` : ''}`}>查看目前文章與來源狀態</a>}
              </Notice>
            )}
            {/* 一張帳頁：左欄內文、右欄事件影響，中間一條細線，不用陰影 */}
            <div className="grid grid-cols-1 items-start border bg-card lg:grid-cols-12">
              <NewsArticle
                news={news}
                stockCodes={stockCodes}
                selectedStock={selectedStock}
                model={articleModel}
                activeQuotes={activeQuotes}
                pressedQuotes={pressedQuotes}
                onSelectQuote={analysis?.status === 'success' ? selectFromArticle : undefined}
                scrollRequest={articleScroll}
              />
              {/*
                寬版：分析欄 sticky 在頁首下方（頁首高度＋1rem），高度不超過視窗剩餘高度。
                標題列固定在欄頂、只有下面的內容在欄內捲動，標題不會被捲走或被頁首切掉。
              */}
              <aside id="analysis" className="min-w-0 scroll-mt-[calc(var(--app-header-height)+1rem)] border-t p-4 sm:p-5 lg:sticky lg:top-[calc(var(--app-header-height)+1rem)] lg:col-span-4 lg:flex lg:max-h-[calc(100dvh-var(--app-header-height)-2rem)] lg:flex-col lg:border-t-0" aria-label="新聞事件影響分析">
                <LedgerHeading
                  title="新聞事件影響分析"
                  className="shrink-0"
                  stamp={
                    <span className="inline-flex items-center gap-1.5">
                      <LightGlyph state={analysisState} />
                      {selectedStock ? formatStockLabel(selectedStock) : null}
                    </span>
                  }
                />
                {/* 免責放在標題層：寬版不隨欄內捲走，分類收合時也看得到 */}
                <p className="mt-2 mb-4 shrink-0 text-xs leading-relaxed text-muted-foreground">{NEWS_IMPACT_DISCLAIMER}</p>
                {/* 欄內捲動區左右各留 4px，focus 圈不會被裁掉 */}
                <div className="min-w-0 lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:pb-1">
                  {analysis ? <NewsEventAnalysisPanel analysis={analysis} link={citationLink} /> : <EmptyState className="py-6 text-[13px]">尚無事件影響分析。</EmptyState>}
                </div>
                {hasStarredName ? (
                  <p className="mt-3 shrink-0 border-t pt-2 text-[12px] leading-relaxed text-muted-foreground">名稱中的＊為證交所公告的公司簡稱的一部分。</p>
                ) : null}
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
