import { useSyncExternalStore } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Button } from '@/components/ui/button';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

export default function NotificationsPage() {
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');

  return (
    <>
      <Head>
        <title>股海明燈｜通知中心</title>
        <meta name="description" content="查看收藏股每日摘要、漲跌幅與重大新聞通知，管理推播偏好。" />
      </Head>
      <SiteHeader icon={Bell} title="通知中心" subtitle="查看最新通知與管理推播偏好" />
      <main aria-label="通知中心" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {account ? <NotificationSettings /> : (
          <section aria-labelledby="notifications-login-heading" className="mx-auto max-w-lg rounded-2xl border bg-card p-6 text-center shadow-card sm:p-8">
            <Bell size={32} className="mx-auto mb-4 text-brand" aria-hidden />
            <h2 id="notifications-login-heading" className="text-lg font-semibold">登入後查看通知</h2>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">查看收藏股的重要消息，並設定想接收的通知。</p>
            <Button asChild className="min-h-11">
              <Link href={{ pathname: '/login', query: { returnUrl: '/notifications' } }}>登入並查看通知</Link>
            </Button>
          </section>
        )}
      </main>
    </>
  );
}
