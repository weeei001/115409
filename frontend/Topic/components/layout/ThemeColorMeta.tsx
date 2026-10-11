import { useEffect } from 'react';
import Head from 'next/head';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { useTheme, type Theme } from '@/lib/theme/ThemeContext';

/** 與 styles/main.css 的 --background 同步 */
const LIGHT_THEME_COLOR = '#f3f6f8';
const DARK_THEME_COLOR = '#080b0f';

/**
 * App 的狀態列與手勢列圖示顏色。Capacitor 的命名指的是「底色」：
 * `Dark` 是深色底配淺色圖示（深色主題用），`Light` 是淺色底配深色圖示（淺色主題用）。
 */
export function systemBarsStyle(theme: Theme): SystemBarsStyle {
  return theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
}

/**
 * 手機瀏覽器網址列顏色跟著主題；在 Capacitor App 裡，系統狀態列與手勢列的圖示顏色也跟著主題。
 * App 啟動到這裡執行之前，系統列照 capacitor.config.ts 的預設（跟系統深淺色）；之後以網站主題為準。
 */
export function ThemeColorMeta() {
  const { theme, mounted } = useTheme();
  const content = mounted && theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;

  useEffect(() => {
    if (!mounted || !Capacitor.isNativePlatform()) return;
    // 舊版原生殼沒有 SystemBars 時忽略，不影響頁面
    SystemBars.setStyle({ style: systemBarsStyle(theme) }).catch(() => {});
  }, [theme, mounted]);

  return (
    <Head>
      <meta name="theme-color" content={content} />
    </Head>
  );
}
