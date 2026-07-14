import Head from 'next/head';
import { useTheme } from '../lib/ThemeContext';

const LIGHT_THEME_COLOR = '#ffa95a';
const DARK_THEME_COLOR = '#0A0A0B';

export function ThemeColorMeta() {
  const { theme, mounted } = useTheme();
  const content = !mounted ? LIGHT_THEME_COLOR : theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;

  return (
    <Head>
      <meta name="theme-color" content={content} />
    </Head>
  );
}
