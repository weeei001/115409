import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import Head from 'next/head';
import { MotionConfig } from 'motion/react';
import '../styles/main.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { ThemeColorMeta } from '@/components/layout/ThemeColorMeta';
import { AppShell } from '@/components/layout/AppShell';
import { AppToaster } from '@/components/layout/AppToaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isAuthSessionBoundary } from '@/lib/auth/storage';
import { clearChatSession } from '@/lib/chat/session';

const DEFAULT_TITLE = '股海明燈｜最近儲存收盤行情與財經新聞';
const DEFAULT_DESCRIPTION = '最近儲存收盤行情（非即時）、財經新聞、多股比較與模擬下單等展示功能（學習／專題用途）。';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && isAuthSessionBoundary(event)) clearChatSession();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <ThemeColorMeta />
          <Head>
            <title>{DEFAULT_TITLE}</title>
            <meta name="description" content={DEFAULT_DESCRIPTION} />
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
            {/* og 用 property，Next 不會自動去重；加 key 讓各頁的同名標籤蓋掉預設（決議 c56） */}
            <meta property="og:type" content="website" key="og:type" />
            <meta property="og:site_name" content="股海明燈" />
            <meta property="og:title" content={DEFAULT_TITLE} key="og:title" />
            <meta property="og:description" content={DEFAULT_DESCRIPTION} key="og:description" />
            <meta property="og:locale" content="zh_TW" />
            <meta name="twitter:card" content="summary" />
            <meta name="twitter:title" content={DEFAULT_TITLE} />
            <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
          </Head>
          <AppShell>
            <Component {...pageProps} />
          </AppShell>
          <AppToaster />
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
