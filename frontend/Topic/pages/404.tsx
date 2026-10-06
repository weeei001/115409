import Head from 'next/head';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { LedgerHeading, NextStep } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import { breadcrumbsTrail } from '@/lib/nav';

/**
 * 找不到頁面：取代 Next 預設的英文 404。
 * 預設頁的 inline style 依系統深淺色上字色，網站主題和系統不同時字會跟底色融在一起；
 * 這裡走全站的頁首、token 與換班主題。
 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>股海明燈｜找不到頁面</title>
        <meta name="robots" content="noindex" />
      </Head>
      <SiteHeader title="找不到這個頁面" subtitle="網址可能打錯，或頁面已經移除" breadcrumbs={breadcrumbsTrail('找不到頁面')} />

      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <section aria-labelledby="not-found-heading" className="max-w-xl">
          <LedgerHeading title="這個網址沒有頁面" headingProps={{ id: 'not-found-heading' }} />
          <div className="border-x border-b bg-card">
            <EmptyState>請確認網址是否正確；要查個股，可以到首頁的觀測台搜尋代號或公司名稱。</EmptyState>
            <div className="grid gap-px border-t bg-border">
              <NextStep href="/">回到首頁</NextStep>
              <NextStep href="/#terminal">到觀測台查看個股</NextStep>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
