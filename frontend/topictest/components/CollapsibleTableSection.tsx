import React from 'react';
import { ExpandableRegion } from './ExpandableRegion';

interface Props {
  title: string;
  subtitle?: string;
  /** 顯示於收合按鈕，例如「顯示明細（15 筆）」 */
  rowCount?: number;
  expandLabel?: string;
  collapseLabel?: string;
  defaultExpanded?: boolean;
  defaultExpandedOnDesktop?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const CollapsibleTableSection: React.FC<Props> = ({
  title,
  subtitle,
  rowCount,
  expandLabel,
  collapseLabel,
  defaultExpanded = false,
  defaultExpandedOnDesktop = false,
  children,
  className,
}) => {
  const countSuffix = rowCount != null ? `（${rowCount} 筆）` : '';
  const resolvedExpand = expandLabel ?? `顯示${title}${countSuffix}`;
  const resolvedCollapse = collapseLabel ?? `收合${title}`;

  return (
    <section className={className} aria-label={title}>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {subtitle ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{subtitle}</p> : null}
      <ExpandableRegion
        expandLabel={resolvedExpand}
        collapseLabel={resolvedCollapse}
        defaultExpanded={defaultExpanded}
        defaultExpandedOnDesktop={defaultExpandedOnDesktop}
        toggleClassName="mt-2"
        panelClassName="pt-2 space-y-2"
      >
        {children}
      </ExpandableRegion>
    </section>
  );
};
