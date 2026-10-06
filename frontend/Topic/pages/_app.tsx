import type { AppProps } from 'next/app';
import Head from 'next/head';
import { IBM_Plex_Mono, Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google';
import { MotionConfig } from 'motion/react';
import '../styles/main.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { ThemeColorMeta } from '@/components/layout/ThemeColorMeta';
import { AppShell } from '@/components/layout/AppShell';
import { AppToaster } from '@/components/layout/AppToaster';
import { FavoritesProvider } from '@/lib/favorites/FavoritesContext';
import { PushListener } from '@/features/notifications/PushListener';

// Load only the glyph ranges used on the page instead of preloading every CJK subset.
// Weights follow DESIGN.md: serif display 900, sans 400/500/700, mono 400/500/600.
const notoSansTC = Noto_Sans_TC({ weight: ['400', '500', '700'], display: 'swap', preload: false });
const notoSerifTC = Noto_Serif_TC({ weight: '900', display: 'swap', preload: false });
const ibmPlexMono = IBM_Plex_Mono({ weight: ['400', '500', '600'], display: 'swap', subsets: ['latin'] });

const DEFAULT_TITLE = '股海明燈｜台股收盤行情與財經新聞';
const DEFAULT_DESCRIPTION = '台股收盤行情（非即時）、財經新聞、多股比較與模擬投資等展示功能（學習／專題用途）。';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <MotionConfig reducedMotion="user">
      <style jsx global>{`
        :root {
          --font-app-serif: ${notoSerifTC.style.fontFamily}, "Songti TC", "PMingLiU", serif;
          --font-app-sans: ${notoSansTC.style.fontFamily}, "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
          --font-app-mono: ${ibmPlexMono.style.fontFamily}, ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        }
      `}</style>
      <ThemeProvider>
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
        <FavoritesProvider>
          <AppShell>
            <Component {...pageProps} />
          </AppShell>
        </FavoritesProvider>
        <AppToaster />
        <PushListener />
      </ThemeProvider>
    </MotionConfig>
  );
}
