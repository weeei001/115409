import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { ROUTE_PAGE_LABELS, type BreadcrumbItem } from '@/lib/nav';
import { cn } from '@/lib/cn';
import { safeReturnUrl } from '@/lib/utils/returnUrl';

function breadcrumbHref(raw: unknown) {
  const path = safeReturnUrl(raw);
  if (!path) return null;
  const url = new URL(path, 'https://breadcrumb.local');
  const route = Object.keys(ROUTE_PAGE_LABELS).find((known) => known === url.pathname);
  const pathname = route ?? (/^\/stock\/\d{4,6}$/.test(url.pathname) ? url.pathname : null);
  if (!pathname) return null;
  // Next encodes query values and keeps the destination on an allowed local route.
  return { pathname, query: Object.fromEntries(url.searchParams), hash: url.hash };
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="麵包屑導覽" className={cn('min-w-0', className)}>
      {/* 連結左右各留 8px 觸控範圍（至少 44 寬，P2-056）；整列往左拉 8px，第一項的字仍和標題對齊 */}
      <ol className="-ml-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const href = isLast ? null : breadcrumbHref(item.href);
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden /> : null}
              {href ? (
                <Link href={href} className="inline-flex min-h-11 min-w-11 items-center truncate px-2 underline-offset-4 transition-colors duration-(--dur-flash) hover:text-foreground hover:underline">
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
