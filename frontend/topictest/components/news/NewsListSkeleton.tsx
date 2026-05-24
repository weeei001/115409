import React from 'react';

interface Props {
  count?: number;
}

export const NewsListSkeleton: React.FC<Props> = ({ count = 5 }) => (
  <div className="flex flex-col gap-4" aria-hidden>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
        <div className="h-3 w-full rounded bg-[var(--color-bg-elevated)] animate-pulse" />
      </div>
    ))}
  </div>
);
