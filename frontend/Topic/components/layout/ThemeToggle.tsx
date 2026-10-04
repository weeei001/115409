import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme/ThemeContext';
import { cn } from '@/lib/cn';

/** 換班：夜班（夜海，dark）與晨班（晨海，light）是同一天的兩個班 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  // 掛載前不知道目前是哪一班：放一個同尺寸的空框，頁首才不會跳動
  if (!mounted) return <div className={cn('size-11 shrink-0 rounded-md border border-input bg-card', className)} aria-hidden />;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? '換班：切換到晨班（亮色）' : '換班：切換到夜班（暗色）'}
      title={isDark ? '目前夜班，換到晨班' : '目前晨班，換到夜班'}
      className={cn('text-subtle hover:text-foreground', className)}
    >
      {isDark ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </Button>
  );
}
