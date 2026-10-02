import { useEffect, useSyncExternalStore } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Bell, Loader2, Star } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Button } from '@/components/ui/button';
import { FavoriteList } from '@/features/favorites/FavoriteList';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

export default function FavoritesPage() {
  const router = useRouter();
  const { status } = useFavorites();
  const initializing = status === 'idle';
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');
  const notificationsTarget = router.asPath.split('#')[1] === 'notifications';
  const returnUrl = notificationsTarget ? '/favorites#notifications' : '/favorites';

  useEffect(() => {
    if (account && !initializing && notificationsTarget) {
      document.getElementById('notifications')?.scrollIntoView({ block: 'start' });
    }
  }, [account, initializing, notificationsTarget]);

  return (
    <>
      <Head>
        <title>股海明燈｜收藏股</title>
        <meta name="description" content="管理收藏個股，設定每日摘要、漲跌幅與重大新聞通知。" />
      </Head>
      <SiteHeader icon={Star} title="收藏股" subtitle="追蹤關注的個股與重要消息" />
      <main aria-label="收藏股" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {initializing ? (
          <div className="flex justify-center py-20" aria-busy="true" role="status">
            <Loader2 size={32} className="animate-spin text-brand" aria-hidden />
            <span className="sr-only">載入收藏股中…</span>
          </div>
        ) : !account ? (
          <section aria-labelledby="favorites-login-heading" className="mx-auto max-w-lg rounded-2xl border bg-card p-6 text-center shadow-card sm:p-8">
            <Star size={32} className="mx-auto mb-4 text-brand" aria-hidden />
            <h2 id="favorites-login-heading" className="text-lg font-semibold">登入後管理收藏股</h2>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">收藏關注的股票，並選擇要接收的每日摘要、漲跌幅與重大新聞通知。</p>
            <Button asChild className="min-h-11">
              <Link href={{ pathname: '/login', query: { returnUrl } }}>登入並開始收藏</Link>
            </Button>
          </section>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">在個股頁點選星號，即可加入收藏清單。</p>
              <Button asChild variant="outline" className="min-h-11">
                <a href="#notifications"><Bell aria-hidden />通知設定</a>
              </Button>
            </div>
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <FavoriteList />
              <NotificationSettings />
            </div>
          </>
        )}
      </main>
    </>
  );
}
