import React from 'react';

export interface ChartLegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

interface Props {
  items: ChartLegendItem[];
  className?: string;
}

export const ChartLegendBar: React.FC<Props> = ({ items, className = '' }) => {
  if (!items.length) return null;
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-text-muted)] ${className}`}
      aria-label="圖例"
    >
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 shrink-0 rounded-full"
            style={{
              backgroundColor: item.color,
              borderStyle: item.dashed ? 'dashed' : 'solid',
            }}
            aria-hidden
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
};
