import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { HeaderStockSearch } from '@/components/layout/PrimaryNav';
import { LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { FavoriteToggle } from '@/features/favorites/FavoriteToggle';
import { StockDashboard } from '@/features/stock/StockDashboard';
import { isStockSymbol, useStockDashboard } from '@/lib/hooks/useStockDashboard';
import { formatStockLabel, useStockDisplayName } from '@/lib/utils/symbolNames';
import { breadcrumbsForStock, breadcrumbsTrail } from '@/lib/nav';
import { useLatestCloseDate } from '@/lib/hooks/useLatestCloseDate';

/** 載入失敗（可重試）、查無行情（給搜尋，P1-17）或代號格式錯誤（只能回首頁） */
function BackHome({ message, onRetry, showSearch = false }: { message: string; onRetry?: () => void; showSearch?: boolean }) {
  const router = useRouter();
  return (
    <main id="stock-page-main" className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <Notice tone="danger">{message}</Notice>
        {showSearch ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">換一檔股票查詢：</p>
            <HeaderStockSearch showStatus />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw aria-hidden />
              重試
            </Button>
          ) : null}
          <Button variant={onRetry ? 'ghost' : 'outline'} onClick={() => void router.push('/')} className={onRetry ? 'border border-transparent hover:border-border-strong' : undefined}>
            返回首頁
          </Button>
        </div>
      </div>
    </main>
  );
}

function StockDashboardView({ symbol }: { symbol: string }) {
  const dashboard = useStockDashboard(symbol);
  const label = formatStockLabel(symbol);
  // 頁面標題用公司名稱；查不到名稱時維持代號
  const displayName = useStockDisplayName(symbol);
  const stockName = displayName === label ? null : displayName;
  const title = `股海明燈｜${stockName ? `${label} ${stockName}` : label}`;
  const description = `查詢 ${label} 收盤行情、K 線、籌碼、技術指標、AI 投資分析與新聞（非即時；展示／專題用途）。`;
  // 頁首的「大盤收盤」和副標的個股收盤日不同時，在內容開頭說明原因（04-U6）
  const boardDate = useLatestCloseDate();
  const header = (subtitle: string, titleWrap = false) => (
    <SiteHeader
      icon={TrendingUp}
      breadcrumbs={breadcrumbsForStock(symbol)}
      title={stockName ?? label}
      subtitle={subtitle}
      titleWrap={titleWrap}
      titleAction={<FavoriteToggle symbol={symbol} />}
    />
  );

  const head = (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} key="og:title" />
      <meta property="og:description" content={description} key="og:description" />
      <meta property="og:type" content="article" key="og:type" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Head>
  );

  if (dashboard.loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {head}
        {header('載入中…')}
        <main
          id="stock-page-main"
          className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-10 px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
          aria-busy="true"
          aria-live="polite"
        >
          {/* 載入＝燈質 Q：有線的空白列，光帶掃過，寫出「讀取中」 */}
          <LoadingRows label="載入收盤行情與 K 線中…" className="h-[420px] border bg-card lg:h-[540px]" />
          <LoadingRows label="載入法人與指標中…" className="h-[132px] border-y" />
        </main>
      </div>
    );
  }

  if (dashboard.error || !dashboard.latest) {
    // 404＝本站沒有儲存這個代號的行情（真實股票也可能），不斷言股票不存在；重試沒有用，改給搜尋（P1-17）
    const notFound = dashboard.errorKind === 'not-found';
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {head}
        {header(notFound ? '查無行情資料' : `無法載入 ${label} 的資料`, true)}
        {notFound ? (
          <BackHome message={`目前沒有代號 ${symbol} 的行情資料。`} showSearch />
        ) : (
          <BackHome message={dashboard.error ?? '無法取得報價資料'} onRetry={dashboard.retry} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {head}
      {/* 財經數據旁標明非投資建議（05；skill 免責規則） */}
      {header(
        [stockName ? symbol : null, dashboard.latest.date ? `收盤 ${dashboard.latest.date}` : null, '非即時', '非投資建議'].filter(Boolean).join(' · '),
      )}
      {/* 「跳至個股內容」緊接在頁首後面等於沒跳，已拿掉；全站的「跳至主要內容」落點就在頁首之後（03-F6） */}
      <main id="stock-page-main" tabIndex={-1} aria-label="個股儀表板內容" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 outline-none focus-visible:shadow-none sm:px-6 lg:px-10 lg:py-10">
        {boardDate && dashboard.latest.date && boardDate !== dashboard.latest.date ? (
          <p className="mb-6 text-[13px] text-muted-foreground">
            大盤（<span className="font-mono tabular-nums">{boardDate}</span>）和個股（<span className="font-mono tabular-nums">{dashboard.latest.date}</span>）的最後收盤日不同：兩者分開更新，各自顯示最近一個收盤日。
          </p>
        ) : null}
        <StockDashboard dashboard={dashboard} stockName={stockName} />
      </main>
    </div>
  );
}

export default function StockDetailPage() {
  const router = useRouter();
  const raw = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';
  const symbol = raw.trim();
  // 舊連結相容：16～64 位十六進位字串視為新聞 id（決議 c51 保留）
  const isArticleId = symbol.length > 8 && /^[a-fA-F0-9]{16,64}$/.test(symbol);

  useEffect(() => {
    // 換頁退場期間 router 已經是 /news/[id]（query.id 是新聞 id）：只在個股頁自己的路由轉址，不然會反覆 replace 並剝掉 ?stock=
    if (router.isReady && isArticleId && router.pathname === '/stock/[id]') void router.replace(`/news/${symbol}`);
  }, [router, isArticleId, symbol]);

  if (!router.isReady || isArticleId) {
    return (
      <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10" aria-busy="true">
        <LoadingRows label={isArticleId ? '正在開啟新聞…' : '載入中…'} className="h-[132px] w-full max-w-md border bg-card" />
      </div>
    );
  }

  if (!isStockSymbol(symbol)) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        {/* 格式錯誤的代號也要有自己的網頁標題，不沿用預設標題（01-F9） */}
        <Head>
          <title>股海明燈｜股票代號格式錯誤</title>
        </Head>
        <SiteHeader
          icon={TrendingUp}
          breadcrumbs={breadcrumbsTrail('個股')}
          title={symbol ? `${symbol} 無效代號` : '個股儀表板'}
          subtitle="股票代號格式錯誤"
          titleWrap
        />
        <BackHome message="股票代號格式不正確，請輸入 4 至 6 碼股票代號。" />
      </div>
    );
  }

  return <StockDashboardView key={symbol} symbol={symbol} />;
}
