import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { cn } from '@/lib/cn';

/** 換班：夜班（夜海，dark）與晨班（晨海，light）是同一天的兩個班 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const base = 'flex size-11 shrink-0 items-center justify-center rounded-md border border-input bg-card text-subtle';

  if (!mounted) return <div className={cn(base, className)} aria-hidden />;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? '換班：切換到晨班（亮色）' : '換班：切換到夜班（暗色）'}
      title={isDark ? '目前夜班，換到晨班' : '目前晨班，換到夜班'}
      className={cn(base, 'transition-colors duration-(--dur-flash) hover:border-border-strong hover:text-foreground', className)}
    >
      {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
