import Head from 'next/head';
import { useTheme } from '@/lib/theme/ThemeContext';

const LIGHT_THEME_COLOR = '#ffa95a';
const DARK_THEME_COLOR = '#0A0A0B';

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
