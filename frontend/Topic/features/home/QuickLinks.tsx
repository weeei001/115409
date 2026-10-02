import React from 'react';
import { useRouter } from 'next/router';
import { Bot, GitCompareArrows, ShoppingCart, Sparkles, Star, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const LINKS: Array<{ path: string; title: string; hint: string; icon: LucideIcon; primary?: boolean }> = [
  { path: '/ai', title: 'AI 對話', hint: '市場參考對話', icon: Bot, primary: true },
  { path: '/favorites', title: '收藏股', hint: '追蹤個股與通知設定', icon: Star },
  { path: '/compare', title: '多股比較', hint: '交叉分析走勢', icon: GitCompareArrows },
  { path: '/order', title: '模擬下單', hint: '練習下單流程', icon: ShoppingCart },
];

/** Primary task shortcuts on the home page. */
export function QuickLinks() {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-brand" aria-hidden />
        <h2 className="text-sm font-bold tracking-tight">快速功能</h2>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {LINKS.map(({ path, title, hint, icon: Icon, primary }) => (
          <button
            key={path}
            type="button"
            onClick={() => void router.push(path)}
            className="group flex min-h-11 items-center gap-2.5 rounded-lg border p-3 text-left transition-colors hover:border-border-strong hover:bg-accent"
          >
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', primary ? 'bg-brand-gradient' : 'bg-muted')}>
              <Icon size={16} className={primary ? 'text-on-brand' : 'text-brand'} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold transition-colors group-hover:text-brand-text">{title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
