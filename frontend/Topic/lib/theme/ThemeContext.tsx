import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  mounted: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  mounted: false,
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STAGGER_DELAY_MS = 25;
const STAGGER_CLEANUP_MS = 600;
let staggerTimer: ReturnType<typeof setTimeout> | null = null;

/** 切換主題時卡片依序過渡；卡片以 data-stagger 標記 */
function applyThemeStagger() {
  if (staggerTimer) clearTimeout(staggerTimer);
  document.body.classList.add('theme-transitioning');
  const cells = document.querySelectorAll<HTMLElement>('[data-stagger]');
  cells.forEach((el, i) => {
    el.style.transitionDelay = `${i * STAGGER_DELAY_MS}ms`;
  });
  staggerTimer = setTimeout(() => {
    staggerTimer = null;
    document.body.classList.remove('theme-transitioning');
    cells.forEach((el) => {
      el.style.transitionDelay = '';
    });
  }, STAGGER_CLEANUP_MS);
}

/** html.dark 由 _document 的 inline script 在首次繪製前設定，這裡接手之後的切換 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  const isInitRef = useRef(true);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* 私密視窗等情況寫不進去就算了 */
    }
    if (isInitRef.current) isInitRef.current = false;
    else applyThemeStagger();
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, mounted, toggleTheme }), [theme, mounted, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
