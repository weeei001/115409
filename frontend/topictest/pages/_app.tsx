import type { ReactNode } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import '../sentry.client.config';
import '../styles/main.css';
import { ThemeProvider } from '../lib/ThemeContext';
import { SiteFooter } from '../components/SiteFooter';
import { ScrollToTop } from '../components/ScrollToTop';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';

/** 改為 `'particle'` 可恢復原本粒子背景 */
const BACKGROUND_MODE: 'particle' | 'money' = 'particle';

const ParticleBackground = dynamic(() => import('../components/ParticleBackground'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[var(--color-bg)]" aria-hidden />,
});

const MoneyBackground = dynamic(() => import('../components/MoneyBackground'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[var(--color-bg)]" aria-hidden />,
});

const DEFAULT_TITLE = '股海明燈｜即時股價與財經新聞';
const DEFAULT_DESCRIPTION =
  '即時股價、財經新聞、多股比較與模擬下單等展示功能（學習／專題用途）。';

/**
 * 粒子與內容分層：用 isolate + 明確 z-index，避免與 body／#__next 堆疊時效應導致背景整層被遮住。
 */
function AppChrome({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-[100dvh] w-full">
      <div
        className="pointer-events-none fixed inset-0 z-[1] h-[100dvh] w-full min-h-[100dvh]"
        aria-hidden
      >
        {BACKGROUND_MODE === 'particle' ? (
          <ParticleBackground />
        ) : (
          <MoneyBackground />
        )}
      </div>
      <div className="relative z-[2] flex min-h-[100dvh] w-full flex-col bg-transparent pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotionClient();

  return (
    <ThemeProvider>
      <Head>
        <title>{DEFAULT_TITLE}</title>
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#ffa95a" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="股海明燈" />
        <meta property="og:title" content={DEFAULT_TITLE} />
        <meta property="og:description" content={DEFAULT_DESCRIPTION} />
        <meta property="og:locale" content="zh_TW" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={DEFAULT_TITLE} />
        <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
      </Head>
      <AppChrome>
        <div
          id="main-content"
          className="flex min-h-0 flex-1 flex-col min-w-0 outline-none"
          tabIndex={-1}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={router.route}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="flex min-h-0 flex-1 flex-col min-w-0 bg-transparent"
            >
              <Component {...pageProps} />
            </motion.div>
          </AnimatePresence>
        </div>
        <SiteFooter />
        <ScrollToTop />
      </AppChrome>
      <Toaster richColors position="top-center" closeButton />
      <Analytics />
    </ThemeProvider>
  );
}
