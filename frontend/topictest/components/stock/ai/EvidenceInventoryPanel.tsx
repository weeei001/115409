import React, { useEffect, useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import type {
  StockBehaviorDataInventory,
  StockBehaviorInventoryItem,
} from '../../../lib/types/stockBehavior';
import { categoryLabel, type InventoryCategory } from '../../../lib/utils/aiInventoryHelpers';
import { EvidenceCard } from './EvidenceCard';

interface Props {
  inventory: StockBehaviorDataInventory;
  highlightedId: string | null;
  registerRef: (id: string, el: HTMLElement | null) => void;
}

// 新聞已在「資料來源」區段獨立顯示，此面板不重複呈現。
const CATEGORY_ORDER: InventoryCategory[] = ['price_volume', 'chip', 'technical'];

function getItems(
  inventory: StockBehaviorDataInventory,
  category: InventoryCategory,
): StockBehaviorInventoryItem[] {
  switch (category) {
    case 'price_volume':
      return inventory.price_volume ?? [];
    case 'chip':
      return inventory.chip ?? [];
    case 'technical':
      return inventory.technical ?? [];
    case 'news':
      return inventory.news ?? [];
    default:
      return [];
  }
}

/** 若分類中所有條目的 date 都相同（且 date_range 都為空），回傳該共用日期；否則回 null。 */
function uniformDate(items: StockBehaviorInventoryItem[]): string | null {
  if (!items.length) return null;
  const first = items[0].date ?? null;
  if (!first) return null;
  for (const item of items) {
    if (item.date_range) return null;
    if ((item.date ?? null) !== first) return null;
  }
  return first;
}

export const EvidenceInventoryPanel: React.FC<Props> = ({
  inventory,
  highlightedId,
  registerRef,
}) => {
  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: getItems(inventory, category),
      })).filter((s) => s.items.length > 0),
    [inventory],
  );

  const missing = inventory.missing_fields ?? [];

  const [activeTab, setActiveTab] = useState<InventoryCategory | null>(
    sections[0]?.category ?? null,
  );

  // sections 變動時，若目前 activeTab 已不存在則 fallback 到第一個
  useEffect(() => {
    if (!sections.length) {
      setActiveTab(null);
      return;
    }
    if (!activeTab || !sections.some((s) => s.category === activeTab)) {
      setActiveTab(sections[0].category);
    }
  }, [sections, activeTab]);

  // 點推演卡片的 ID 時，自動切到該證據所在的 tab
  useEffect(() => {
    if (!highlightedId) return;
    const owner = sections.find((s) => s.items.some((it) => it.id === highlightedId));
    if (owner && owner.category !== activeTab) {
      setActiveTab(owner.category);
    }
  }, [highlightedId, sections, activeTab]);

  if (!sections.length && !missing.length) return null;

  const activeSection = sections.find((s) => s.category === activeTab) ?? sections[0];
  const sharedDate = activeSection ? uniformDate(activeSection.items) : null;
  const totalCount = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <section
      aria-label="AI 參考數據"
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Database size={14} className="text-brand shrink-0" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI 參考數據</h3>
          <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            共 {totalCount} 筆
          </span>
        </div>
        {sharedDate ? (
          <span className="hidden sm:inline-flex items-center rounded-full bg-[var(--color-bg-card)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] tabular-nums">
            {sharedDate}
          </span>
        ) : null}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="證據分類"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {sections.map(({ category, items }) => {
          const isActive = category === activeSection?.category;
          return (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(category)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
              }`}
            >
              <span>{categoryLabel(category)}</span>
              <span
                className={`tabular-nums text-[10px] ${
                  isActive ? 'text-white/80' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {items.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* 行動裝置下若日期統一，補一行小字 */}
      {sharedDate ? (
        <p className="sm:hidden mt-2 text-[10px] text-[var(--color-text-muted)] tabular-nums">
          資料日期 {sharedDate}
        </p>
      ) : null}

      {/* Active tab content */}
      {activeSection ? (
        <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {activeSection.items.map((item) => (
            <EvidenceCard
              key={item.id}
              item={item}
              category={activeSection.category}
              isHighlighted={highlightedId === item.id}
              registerRef={registerRef}
              hideDate={Boolean(sharedDate)}
            />
          ))}
        </div>
      ) : null}

      {missing.length ? (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="font-semibold text-[var(--color-text-secondary)]">資料缺口：</span>
          {missing.join('、')}
        </div>
      ) : null}
    </section>
  );
};
