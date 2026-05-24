import React from 'react';
import Link from 'next/link';
import { GitCompareArrows, LineChart } from 'lucide-react';

interface Props {
  symbol: string;
  onOpenAI?: () => void;
}

export const StockQuickActions: React.FC<Props> = ({ symbol, onOpenAI }) => {
  const compareHref = `/compare?symbols=${encodeURIComponent(symbol)}`;

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={compareHref}
        className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-brand/40 transition-colors"
      >
        <GitCompareArrows size={16} aria-hidden />
        加入比較
      </Link>
      <button
        type="button"
        onClick={onOpenAI}
        disabled={!onOpenAI}
        className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-brand/40 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <LineChart size={16} aria-hidden />
        AI 分析
      </button>
    </div>
  );
};
