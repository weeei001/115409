import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { LoadingRows } from '@/components/common/Notice';
import { LoginPrompt } from '@/features/auth/LoginPrompt';
import { FavoriteList } from '@/features/favorites/FavoriteList';
import { FavoriteStockSearch } from '@/features/favorites/FavoriteStockSearch';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { useAuthAccount } from '@/lib/auth/account';

export default function FavoritesPage() {
  const router = useRouter();
  const { status } = useFavorites();
  const initializing = status === 'idle';
  const account = useAuthAccount();
  // 舊連結 /favorites#notifications：通知設定已搬到 /notifications。hash 只有瀏覽器端讀得到，在 effect 裡判斷，render 不讀
  useEffect(() => {
    if (!router.isReady) return;
    if (window.location.hash === '#notifications') void router.replace('/notifications');
  }, [router.isReady]);

  return (
    <>
      <Head>
        <title>股海明燈｜收藏股</title>
        <meta name="description" content="管理收藏個股，快速查看關注股票的行情。" />
      </Head>
      <SiteHeader title="收藏股" subtitle="管理關注的個股" />
      <main aria-label="收藏股" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {initializing ? (
          <div className="border-t border-border-strong">
            <LoadingRows label="讀取收藏股中…" className="h-[176px]" />
          </div>
        ) : !account ? (
          <LoginPrompt title="登入後管理收藏股" action="登入並開始收藏" returnUrl="/favorites">
            收藏關注的股票，隨時查看個股行情。
          </LoginPrompt>
        ) : (
          // 桌機：清單在左（7/12）、搜尋在右（5/12）；手機先看清單，再往下加入
          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
            <AnimatedSection className="min-w-0 lg:col-span-7">
              <FavoriteList />
            </AnimatedSection>
            <AnimatedSection delay={0.05} className="min-w-0 lg:col-span-5">
              <FavoriteStockSearch />
            </AnimatedSection>
          </div>
        )}
      </main>
    </>
  );
}
