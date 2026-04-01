import { Html, Head, Main, NextScript } from 'next/document';

const themeScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function Document() {
  return (
    <Html suppressHydrationWarning>
      <Head />
      <body>
        <a href="#main-content" className="skip-to-main">
          跳至主要內容
        </a>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
