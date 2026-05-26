import React, { useCallback, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type {
  ChipsVolumeChartRow,
  InstitutionalTradeListResponse,
  InstitutionalTradeResponse,
} from '../../lib/types';
import { fmtInstitutionalShares } from '../../lib/utils/format';
import { InstitutionalFlowChart } from './InstitutionalFlowChart';
import { InstitutionalCumulativeChart } from './InstitutionalCumulativeChart';
import { ChipsVolumeChart } from './ChipsVolumeChart';
import { InstitutionalHistoryTable } from './InstitutionalHistoryTable';

type TabKey = 'flow' | 'cumulative' | 'chips' | 'history' | 'today';

interface TabDef {
  key: TabKey;
  label: string;
  description?: string;
}

const TABS: TabDef[] = [
  { key: 'flow', label: '區間流向', description: '三大法人每日買賣超' },
  { key: 'cumulative', label: '累計淨額', description: '法人累積買賣超走勢' },
  { key: 'chips', label: '量價籌碼', description: '價、量、法人合計整合圖' },
  { key: 'today', label: '今日法人', description: '最新一日法人結構' },
  { key: 'history', label: '歷史明細', description: '最近 30 日逐日明細' },
];

interface Props {
  institutionalRange: InstitutionalTradeListResponse | null;
  institutionalLatest: InstitutionalTradeResponse | null;
  chipsVolumeRows: ChipsVolumeChartRow[] | null;
  loading?: boolean;
  error?: string | null;
}

function TodayCard({ latest }: { latest: InstitutionalTradeResponse | null }) {
  if (!latest) {
    return (
      <p className="text-sm text-[var(--color-text-muted)] py-12 text-center">尚無今日法人資料</p>
    );
  }
  const rows = [
    { label: '外資（不含自營）', net: latest.foreign_excl_dealer_net, buy: latest.foreign_buy, sell: latest.foreign_sell },
    { label: '投信', net: latest.investment_trust_net, buy: latest.investment_trust_buy, sell: latest.investment_trust_sell },
    { label: '自營（合計）', net: latest.dealer_net_total, buy: latest.dealer_buy, sell: latest.dealer_sell },
    { label: '三大法人合計', net: latest.total_net, buy: latest.total_institutional_buy, sell: latest.total_institutional_sell },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)] tabular-nums">最新：{latest.date}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const netCls = row.net == null
            ? 'text-[var(--color-text-muted)]'
            : row.net > 0
              ? 'text-up'
              : row.net < 0
                ? 'text-down'
                : 'text-[var(--color-text-secondary)]';
          return (
            <div
              key={row.label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3"
            >
              <p className="text-xs text-[var(--color-text-muted)] mb-1">{row.label}</p>
              <p className={`text-lg font-mono font-semibold tabular-nums ${netCls}`}>
                {fmtInstitutionalShares(row.net)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--color-text-muted)] tabular-nums">
                <span>買進 <span className="text-up font-mono">{fmtInstitutionalShares(row.buy)}</span></span>
                <span>賣出 <span className="text-down font-mono">{fmtInstitutionalShares(row.sell)}</span></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const InstitutionalTabs: React.FC<Props> = ({
  institutionalRange,
  institutionalLatest,
  chipsVolumeRows,
  loading,
  error,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
        return;
      }
      event.preventDefault();
      let next = activeIdx;
      if (event.key === 'ArrowLeft') next = (activeIdx - 1 + TABS.length) % TABS.length;
      if (event.key === 'ArrowRight') next = (activeIdx + 1) % TABS.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = TABS.length - 1;
      setActiveIdx(next);
      requestAnimationFrame(() => tabRefs.current[next]?.focus());
    },
    [activeIdx]
  );

  const activeTab = TABS[activeIdx];

  return (
    <div>
      <div
        role="tablist"
        aria-label="籌碼面分頁"
        className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab, idx) => {
          const isActive = idx === activeIdx;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              role="tab"
              type="button"
              id={`institutional-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`institutional-panel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIdx(idx)}
              onKeyDown={onKeyDown}
              className={clsx(
                'min-h-[44px] shrink-0 px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-[color,border-color] cursor-pointer',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-card)] rounded-t-md',
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-brand',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab.description ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{activeTab.description}</p>
      ) : null}

      <div className="mt-3 min-h-[360px]">
        {TABS.map((tab, idx) => {
          const isActive = idx === activeIdx;
          return (
            <div
              key={tab.key}
              role="tabpanel"
              id={`institutional-panel-${tab.key}`}
              aria-labelledby={`institutional-tab-${tab.key}`}
              hidden={!isActive}
            >
              {isActive ? (
                <>
                  {tab.key === 'flow' ? (
                    <InstitutionalFlowChart data={institutionalRange} loading={loading} error={error ?? undefined} />
                  ) : null}
                  {tab.key === 'cumulative' ? (
                    <InstitutionalCumulativeChart data={institutionalRange} loading={loading} />
                  ) : null}
                  {tab.key === 'chips' ? (
                    <ChipsVolumeChart rows={chipsVolumeRows} loading={loading} />
                  ) : null}
                  {tab.key === 'today' ? <TodayCard latest={institutionalLatest} /> : null}
                  {tab.key === 'history' ? (
                    <InstitutionalHistoryTable data={institutionalRange} loading={loading} />
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
