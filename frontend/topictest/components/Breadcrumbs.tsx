import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import type { BreadcrumbItem } from '../lib/nav';

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className }) => {
  if (items.length === 0) return null;

  return (
    <nav aria-label="麵包屑導覽" className={clsx('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <ChevronRight size={12} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden />
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="truncate rounded px-0.5 font-medium text-[var(--color-text-secondary)]
                    transition-colors hover:text-brand focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={clsx(
                    'truncate',
                    isLast ? 'font-medium text-[var(--color-text-secondary)]' : '',
                  )}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
