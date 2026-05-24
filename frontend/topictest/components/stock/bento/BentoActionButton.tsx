import React from 'react';
import { ArrowRight } from 'lucide-react';

interface Props {
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
}

export const BentoActionButton: React.FC<Props> = ({ onClick, label = '詳細', ariaLabel }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className="group mt-auto inline-flex w-full min-h-[36px] items-center justify-between gap-2 rounded-xl border border-brand/30 bg-[var(--color-bg-elevated)] px-3 py-2 text-xs font-semibold text-brand transition-[color,background-color,border-color,transform] hover:bg-brand/10 hover:border-brand active:scale-[0.98] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-card)]"
    >
      <span>{label}</span>
      <ArrowRight
        size={14}
        aria-hidden
        className="transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
};
