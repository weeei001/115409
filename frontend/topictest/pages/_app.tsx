import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../sentry.client.config';
import '../styles/main.css';
import { ThemeProvider } from '../lib/ThemeContext';
import { SiteFooter } from '../components/SiteFooter';
import { ScrollToTop } from '../components/ScrollToTop';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';

const DEFAULT_TITLE = '股海明燈｜即時股價與財經新聞';
const DEFAULT_DESCRIPTION =
  '即時股價、財經新聞、多股比較與模擬下單等展示功能（學習／專題用途）。';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <Head>
        <title>{DEFAULT_TITLE}</title>
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen flex flex-col">
        <div id="main-content" className="flex-1 flex flex-col min-w-0 outline-none" tabIndex={-1}>
          <Component {...pageProps} />
        </div>
        <SiteFooter />
        <ScrollToTop />
      </div>
      <Toaster richColors position="top-center" closeButton />
      <Analytics />
    </ThemeProvider>
  );
}
