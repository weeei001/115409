import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme/ThemeContext';
import { cn } from '@/lib/cn';

/** 亮色／暗色切換（P2-060：不用「換班」比喻，讀螢幕軟體念出來就是功能名稱） */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  // 掛載前不知道目前的主題：放一個同尺寸的空框，頁首才不會跳動
  if (!mounted) return <div className={cn('size-11 shrink-0 rounded-md border border-input bg-card', className)} aria-hidden />;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? '切換為亮色模式' : '切換為暗色模式'}
      title={isDark ? '切換為亮色模式' : '切換為暗色模式'}
      className={cn('text-subtle hover:text-foreground', className)}
    >
      {isDark ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </Button>
  );
}
