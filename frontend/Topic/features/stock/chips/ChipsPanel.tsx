import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import type { ChipsVolumeData } from '@/lib/types/api';
import type { InstitutionalDay } from '@/lib/types/view';
import {
  chipsVolumeOption,
  institutionalCumulativeOption,
  institutionalFlowOption,
  plottedSpan,
  plottedSpanText,
  recentChipsRows,
  recentInstitutionalRows,
} from '@/lib/charts/adapters';
import { fmtInstitutionalShares as fmtShares } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { CollapsibleTableSection, TableScrollHint } from '@/components/common/CollapsibleSection';
import { DataStamp, Ledger, LedgerPanel } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/cn';
import { signedShares, signedWanShares, wanShares } from '../signedShares';
import { EmptyRangeActions, type EmptyRangeActionsProps as EmptyActions } from '../EmptyRangeActions';

/** 最近交易日四格：用 1px 線分隔，標籤靠左、數字靠右，只有淨額上漲跌色 */
function KpiCards({ latest, loading, actions }: { latest: InstitutionalDay | null; loading: boolean; actions: EmptyActions }) {
  if (loading) return <LoadingRows className="h-[88px] bg-card" />;
  if (!latest) {
    return (
      <EmptyState className="bg-card py-6" action={<EmptyRangeActions {...actions} />}>
        暫無法人籌碼資料
      </EmptyState>
    );
  }
  const items = [
    { label: '外資', value: latest.foreign_net },
    { label: '投信', value: latest.investment_trust_net },
    { label: '自營', value: latest.dealer_net },
    { label: '合計', value: latest.total_institutional_net },
  ];
  return (
    <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 bg-card px-4 py-2.5 sm:px-5">
          <dt className="text-[13px] text-subtle">{item.label}</dt>
          <dd className={cn('ml-auto font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums', valueToneText(item.value))}>{signedShares(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function LatestCard({ latest, actions }: { latest: InstitutionalDay | null; actions: EmptyActions }) {
  if (!latest) {
    return (
      <EmptyState className="py-12" action={<EmptyRangeActions {...actions} />}>
        尚無最近交易日的法人資料
      </EmptyState>
    );
  }
  const rows = [
    { label: '外資（不含自營）', net: latest.foreign_net, buy: latest.foreign_buy, sell: latest.foreign_sell },
    { label: '投信', net: latest.investment_trust_net, buy: latest.investment_trust_buy, sell: latest.investment_trust_sell },
    { label: '自營（合計）', net: latest.dealer_net, buy: latest.dealer_buy, sell: latest.dealer_sell },
    { label: '三大法人合計', net: latest.total_institutional_net, buy: latest.total_institutional_buy, sell: latest.total_institutional_sell },
  ];
  return (
    <div className="space-y-3">
      <p className="characteristic">最近交易日 {latest.date} · 單位 萬股（買進、賣出不上漲跌色）</p>
      <div className="grid gap-px border bg-border sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0 bg-card px-4 py-3">
            <p className="text-[13px] text-muted-foreground">{row.label}</p>
            <p className={cn('mt-1 font-mono text-lg font-semibold whitespace-nowrap tabular-nums', valueToneText(row.net))}>{signedShares(row.net)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>
                買進 <span className="font-mono whitespace-nowrap text-subtle tabular-nums">{fmtShares(row.buy)}</span>
              </span>
              <span>
                賣出 <span className="font-mono whitespace-nowrap text-subtle tabular-nums">{fmtShares(row.sell)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 歷史明細表列出的列：由新到舊最多 30 筆 */
const historyRows = (all: InstitutionalDay[]) => [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

function HistoryTable({ rows: all }: { rows: InstitutionalDay[] }) {
  const [mode, setMode] = useState<'net' | 'detail'>('net');
  const rows = historyRows(all);
  const hasBuySell = rows.some((r) => r.foreign_buy != null || r.foreign_sell != null);
  const td = 'h-11 px-3 py-2 text-right font-mono text-[13.5px] tabular-nums';
  const netCell = (v: number | null, bold = false) => <td className={cn(td, bold && 'font-semibold', valueToneText(v))}>{signedWanShares(v)}</td>;
  const plainCell = (v: number | null) => <td className={cn(td, 'text-subtle')}>{wanShares(v)}</td>;

  return (
    <CollapsibleTableSection
      title="法人歷史明細"
      subtitle="外資、投信、自營每日買賣超；單位 萬股"
      expandLabel={`顯示法人明細（${rows.length} 筆）`}
      collapseLabel="收合法人明細"
    >
      {hasBuySell ? (
        <ToggleGroup type="single" variant="square" spacing={1} value={mode} onValueChange={(v) => v && setMode(v as 'net' | 'detail')} className="mb-2" aria-label="明細檢視方式">
          <ToggleGroupItem value="net" className="text-xs">
            淨額
          </ToggleGroupItem>
          <ToggleGroupItem value="detail" className="text-xs">
            買賣明細
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      <TableScrollHint />
      <div className="overflow-x-auto overscroll-x-contain border">
        {mode === 'net' ? (
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border-strong bg-muted text-xs text-muted-foreground">
                <th className="h-11 px-3 py-2.5 text-left font-medium">日期</th>
                {['外資（萬股）', '投信（萬股）', '自營（萬股）', '合計（萬股）'].map((h) => (
                  <th key={h} className="h-11 px-3 py-2 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t">
                  <td className="h-11 px-3 py-2 font-mono text-[13.5px] tabular-nums">{row.date}</td>
                  {netCell(row.foreign_net)}
                  {netCell(row.investment_trust_net)}
                  {netCell(row.dealer_net)}
                  {netCell(row.total_institutional_net, true)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-muted text-xs text-muted-foreground">
                <th className="h-11 px-3 py-2.5 text-left font-medium" rowSpan={2}>
                  日期
                </th>
                {['外資（萬股）', '投信（萬股）', '自營（萬股）'].map((h) => (
                  <th key={h} className="border-b px-1 py-1 text-center font-medium" colSpan={3}>
                    {h}
                  </th>
                ))}
                <th className="h-11 px-3 py-2 text-right font-medium" rowSpan={2}>
                  合計（萬股）
                </th>
              </tr>
              <tr className="border-b border-border-strong bg-muted text-xs text-muted-foreground">
                {Array.from({ length: 3 }).flatMap((_, i) =>
                  ['買進', '賣出', '淨額'].map((h) => (
                    <th key={`${i}-${h}`} className="px-2 py-1 text-right font-normal">
                      {h}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t">
                  <td className="h-11 px-3 py-2 font-mono text-[13.5px] tabular-nums">{row.date}</td>
                  {plainCell(row.foreign_buy)}
                  {plainCell(row.foreign_sell)}
                  {netCell(row.foreign_net, true)}
                  {plainCell(row.investment_trust_buy)}
                  {plainCell(row.investment_trust_sell)}
                  {netCell(row.investment_trust_net, true)}
                  {plainCell(row.dealer_buy)}
                  {plainCell(row.dealer_sell)}
                  {netCell(row.dealer_net, true)}
                  {netCell(row.total_institutional_net, true)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </CollapsibleTableSection>
  );
}

const TABS = [
  { key: 'flow', label: '每日流向', description: '三大法人每日買賣超 · 縱軸單位 萬股／億股' },
  { key: 'cumulative', label: '累計淨額', description: '法人累積買賣超走勢 · 縱軸單位 萬股／億股' },
  { key: 'chips', label: '量價籌碼', description: '收盤價（左軸）與三大法人合計買賣超（右軸，萬股／億股）' },
  { key: 'today', label: '最近交易日', description: '最近交易日（最近一筆已儲存資料）的法人結構，非即時' },
  { key: 'history', label: '歷史明細', description: '逐日明細（由新到舊）· 單位 萬股' },
] as const;

function ChipsTabs({ rows, latest, chipsVolume, loading, error, actions }: {
  rows: InstitutionalDay[] | null;
  latest: InstitutionalDay | null;
  chipsVolume: ChipsVolumeData[] | null;
  loading: boolean;
  error: string | null;
  actions: EmptyActions;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [tab, setTab] = useState<string>('flow');
  const flow = useMemo(() => institutionalFlowOption(rows, isDark), [rows, isDark]);
  const cumulative = useMemo(() => institutionalCumulativeOption(rows, isDark), [rows, isDark]);
  const chips = useMemo(() => chipsVolumeOption(chipsVolume, isDark), [chipsVolume, isDark]);
  const active = TABS.find((t) => t.key === tab);
  // 圖說的時間窗：取自圖上實際畫出的列（和 option 用同一個切片函式），不是查詢的日期區間
  const flowSpan = plottedSpan(recentInstitutionalRows(rows).map((r) => r.date));
  const chipsSpan = plottedSpan(recentChipsRows(chipsVolume).map((r) => r.date));
  // 歷史明細表列出的列（由新到舊最多 30 筆），圖說也用這些列
  const historySpan = plottedSpan(historyRows(rows ?? []).map((r) => r.date));
  const activeSpan =
    tab === 'flow'
      ? plottedSpanText(flowSpan)
      : tab === 'cumulative'
        ? flowSpan ? `${plottedSpanText(flowSpan)}；自 ${flowSpan.first} 起累計` : null
        : tab === 'chips'
          ? plottedSpanText(chipsSpan)
          : tab === 'history'
            ? plottedSpanText(historySpan)
            : null;

  const body = (key: string) => {
    if (loading && key !== 'today') return <LoadingRows className="h-[300px] border-y" />;
    const empty = (text: string) => <EmptyState action={<EmptyRangeActions {...actions} />}>{text}</EmptyState>;
    switch (key) {
      case 'flow':
        if (error) return empty(error);
        // 只用 ECharts 內建的可點圖例（決議 c61）
        return flow ? <EChart title="三大法人每日買賣超（萬股）" option={flow} height={280} /> : empty('尚無法人買賣超資料');
      case 'cumulative':
        return cumulative ? <EChart title="法人累積買賣超（萬股）" option={cumulative} height={260} /> : empty('尚無累積買賣超資料');
      case 'chips':
        return chips ? <EChart title="股價與法人合計" option={chips} height={300} /> : empty('尚無價量籌碼整合資料');
      case 'today':
        return <LatestCard latest={latest} actions={actions} />;
      default:
        return rows?.length ? <HistoryTable rows={rows} /> : empty('尚無法人歷史明細');
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      {/* 手機分頁換行、不截字；sm 以上一列 */}
      <TabsList aria-label="籌碼面分頁" className="w-full flex-wrap">
        {TABS.map((t) => (
          <TabsTrigger key={t.key} value={t.key} className="px-2.5 sm:px-4">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {active ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {active.description}
          {activeSpan ? (
            <span className="characteristic mt-0.5 block" data-plotted-span>
              {tab === 'history' ? '表列 ' : '圖上 '}
              {activeSpan}
            </span>
          ) : null}
        </p>
      ) : null}
      {TABS.map((t) => (
        <TabsContent key={t.key} value={t.key} className="mt-3 min-h-[360px]">
          {tab === t.key ? body(t.key) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** 「籌碼面詳細」抽屜內容 */
export function ChipsPanel({ dashboard }: { dashboard: UseStockDashboardResult }) {
  const { chipsError, reloadChips, chipsLoading, institutional, institutionalLatest, chipsVolume, widenDateRange } = dashboard;
  const actions: EmptyActions = { onRetry: reloadChips, onWidenRange: widenDateRange };
  return (
    <div className="flex flex-col gap-10">
      {chipsError ? (
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="outline" onClick={reloadChips} className="min-h-11">
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {chipsError}
        </Notice>
      ) : null}
      <Ledger
        as="h3"
        title="最近交易日法人買賣超"
        stamp={
          <>
            單位 萬股
            {' · '}
            <DataStamp
              date={institutionalLatest?.date}
              label="法人"
              state={chipsLoading ? 'loading' : chipsError ? 'error' : 'ready'}
              className="align-middle"
            />
          </>
        }
      >
        <KpiCards latest={institutionalLatest} loading={chipsLoading} actions={actions} />
      </Ledger>
      <Ledger as="h3" title="法人籌碼走勢" stamp="單位 萬股／億股">
        <LedgerPanel>
          <ChipsTabs rows={institutional} latest={institutionalLatest} chipsVolume={chipsVolume} loading={chipsLoading} error={chipsError} actions={actions} />
        </LedgerPanel>
      </Ledger>
    </div>
  );
}
