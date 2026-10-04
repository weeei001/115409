import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '@/lib/nav';
import { cn } from '@/lib/cn';

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="麵包屑導覽" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden /> : null}
              {item.href && !isLast ? (
                <Link href={item.href} className="inline-flex min-h-11 items-center truncate px-0.5 underline-offset-4 transition-colors duration-(--dur-flash) hover:text-foreground hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={cn('truncate', isLast && 'font-medium text-subtle')} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
