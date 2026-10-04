import Head from 'next/head';
import { useTheme } from '@/lib/theme/ThemeContext';

/** 與 styles/main.css 的 --background 同步 */
const LIGHT_THEME_COLOR = '#f3f6f8';
const DARK_THEME_COLOR = '#080b0f';

/** 手機瀏覽器網址列顏色跟著主題 */
export function ThemeColorMeta() {
  const { theme, mounted } = useTheme();
  const content = mounted && theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  return (
    <Head>
      <meta name="theme-color" content={content} />
    </Head>
  );
}
