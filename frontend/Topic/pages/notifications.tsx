import { useEffect, useState } from 'react';
import Head from 'next/head';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { LoadingRows } from '@/components/common/Notice';
import { LoginPrompt } from '@/features/auth/LoginPrompt';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { useAuthAccount } from '@/lib/auth/account';

export default function NotificationsPage() {
  const account = useAuthAccount();
  // 伺服器輸出沒有登入狀態：hydrate 之前先顯示讀取列，已登入的人才不會先看到一閃而過的登入提示
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);

  return (
    <>
      <Head>
        <title>股海明燈｜通知中心</title>
        <meta name="description" content="查看收藏股每日摘要、漲跌幅與重大新聞通知，管理推播偏好。" />
      </Head>
      <SiteHeader title="通知中心" subtitle="查看最新通知與管理推播偏好" />
      <main aria-label="通知中心" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {!ready ? (
          <div className="border-t border-border-strong">
            <LoadingRows label="確認登入狀態中…" className="h-[176px]" />
          </div>
        ) : account ? <NotificationSettings /> : (
          <LoginPrompt title="登入後查看通知" action="登入並查看通知" returnUrl="/notifications">
            查看收藏股的重要消息，並設定想接收的通知。
          </LoginPrompt>
        )}
      </main>
    </>
  );
}
