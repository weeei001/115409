import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';

type Theme = 'light' | 'dark';

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

function applyThemeStagger() {
  if (staggerTimer) {
    clearTimeout(staggerTimer);
    staggerTimer = null;
  }

  const body = document.body;
  body.classList.add('theme-transitioning');

  const cells = document.querySelectorAll('.bento-cell');
  cells.forEach((el, i) => {
    (el as HTMLElement).style.transitionDelay = `${i * STAGGER_DELAY_MS}ms`;
  });

  staggerTimer = setTimeout(() => {
    staggerTimer = null;
    body.classList.remove('theme-transitioning');
    cells.forEach((el) => {
      (el as HTMLElement).style.transitionDelay = '';
    });
  }, STAGGER_CLEANUP_MS);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  const isInitRef = useRef(true);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);

    if (isInitRef.current) {
      isInitRef.current = false;
    } else {
      applyThemeStagger();
    }
  }, [theme, mounted]);

  const toggleTheme = useCallback(
    () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  );

  const value = useMemo(
    () => ({ theme, mounted, toggleTheme }),
    [theme, mounted, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
