import { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { RefreshCw } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { BriefReport } from '@/features/brief/BriefReport';
import { useStockTextBrief } from '@/lib/hooks/useStockTextBrief';
import { breadcrumbsTrail } from '@/lib/nav';
import { formatStockLabel, useStockDisplayName } from '@/lib/utils/symbolNames';
import { isTaiwanStockCode } from '@/lib/utils/stockValidation';

/**
 * 深色主題印在紙上會是淺字配白紙：列印前暫時換回淺色 token，印完還原。
 * 只在這一頁做，不改使用者的主題設定。
 */
function usePrintInLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      // beforeprint 可能連發兩次（例如另存 PDF）；第二次時已經是淺色，不能把記住的深色蓋掉
      if (!root.classList.contains('dark')) return;
      wasDark = true;
      root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
      wasDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, []);
}

function ReportView({ symbol }: { symbol: string }) {
  const brief = useStockTextBrief({ symbol });
  const { run } = brief;
  // 只在換股票時讀一次；run 會隨載入狀態換新，放進依賴會在失敗後一直重打
  useEffect(() => {
    void run();
  }, [symbol]);
  usePrintInLightTheme();

  const label = formatStockLabel(symbol);
  const displayName = useStockDisplayName(symbol);
  const stockName = displayName === label ? null : displayName;
  const reportTitle = `${stockName ? `${symbol} ${stockName}` : label} AI 分析報告`;
  const { data, error, loading } = brief;

  let body: React.ReactNode;
  if (loading || (!data && !error)) {
    body = <LoadingRows label={`載入 ${label} 的已存分析中…`} className="h-[264px] border bg-card" />;
  } else if (error && !data) {
    body = (
      <Notice tone="danger" action={<Button variant="outline" size="sm" onClick={() => void run()}><RefreshCw aria-hidden />重試</Button>}>
        {error}
      </Notice>
    );
  } else if (!data?.brief) {
    body = <EmptyState>這檔股票目前沒有可用的已存 AI 分析，排程更新後才會出現。</EmptyState>;
  } else {
    body = <BriefReport data={data} title={reportTitle} />;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>{`股海明燈｜${reportTitle}`}</title>
        <meta name="description" content={`${label} 的 AI 分析完整報告：產生條件、各段判讀、引用資料與分析限制，可列印或存成 PDF。`} />
      </Head>
      {/* contents：不產生外框，頁首的 sticky 才能以整頁為範圍；列印時整段不印 */}
      <div className="contents print:hidden">
        <SiteHeader
          breadcrumbs={breadcrumbsTrail({ label: stockName ? `${symbol} ${stockName}` : label, href: `/stock/${symbol}` }, 'AI 分析報告')}
          title={`${stockName ?? label} AI 分析報告`}
          subtitle={[stockName ? symbol : null, data?.as_of_date ? `分析基準日 ${data.as_of_date}` : null, '僅供研究參考，不是投資建議'].filter(Boolean).join(' · ')}
        />
      </div>
      <main id="stock-report-main" tabIndex={-1} aria-label="AI 分析報告內容" className="mx-auto w-full max-w-[860px] flex-1 px-4 py-6 outline-none focus-visible:shadow-none sm:px-6 lg:py-10 print:max-w-none print:p-0">
        {body}
        <p className="mt-10 text-sm print:hidden">
          <Link href={`/stock/${symbol}`} className="underline underline-offset-4">回到 {stockName ?? label} 個股頁</Link>
        </p>
      </main>
    </div>
  );
}

export default function StockBriefReportPage() {
  const router = useRouter();
  const raw = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';
  const symbol = raw.trim();

  if (!router.isReady) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-6 lg:py-10" aria-busy="true">
        <LoadingRows label="載入中…" className="h-[132px] w-full max-w-md border bg-card" />
      </div>
    );
  }

  if (!isTaiwanStockCode(symbol)) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <Head>
          <title>股海明燈｜股票代號格式錯誤</title>
        </Head>
        <SiteHeader breadcrumbs={breadcrumbsTrail('個股')} title={symbol ? `${symbol} 無效代號` : 'AI 分析報告'} subtitle="股票代號格式錯誤" titleWrap />
        <main className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-6 lg:py-10">
          <Notice tone="danger">股票代號格式不正確，請輸入 4 至 6 碼股票代號。</Notice>
        </main>
      </div>
    );
  }

  return <ReportView key={symbol} symbol={symbol} />;
}
