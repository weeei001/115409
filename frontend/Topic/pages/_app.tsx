import type { AppProps } from 'next/app';
import Head from 'next/head';
// Bundle pinned font assets; production builds must not fetch Google Fonts.
// CJK styles retain unicode-range subsets so browsers load only needed glyphs.
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import '@fontsource/noto-serif-tc/900.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import { MotionConfig } from 'motion/react';
import '../styles/main.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { ThemeColorMeta } from '@/components/layout/ThemeColorMeta';
import { AppShell } from '@/components/layout/AppShell';
import { AppToaster } from '@/components/layout/AppToaster';
import { FavoritesProvider } from '@/lib/favorites/FavoritesContext';
import { PushListener } from '@/features/notifications/PushListener';

const DEFAULT_TITLE = '股海明燈｜台股收盤行情與財經新聞';
const DEFAULT_DESCRIPTION = '台股收盤行情（非即時）、財經新聞、多股比較與模擬投資等展示功能（學習／專題用途）。';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ThemeColorMeta />
        <Head>
          <title>{DEFAULT_TITLE}</title>
          <meta name="description" content={DEFAULT_DESCRIPTION} />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          {/* og 用 property，Next 不會自動去重；加 key 讓各頁的同名標籤蓋掉預設 */}
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
