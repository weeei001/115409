import { Head, Html, Main, NextScript } from 'next/document';

/** 首次繪製前決定主題，避免閃爍：先看 localStorage，沒有就跟系統 */
const themeScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function Document() {
  return (
    <Html lang="zh-Hant" suppressHydrationWarning>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
      </Head>
      <body>
        <a href="#main-content" className="skip-link">
          跳至主要內容
        </a>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
