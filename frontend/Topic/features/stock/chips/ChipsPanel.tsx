import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UseStockDashboardResult } from '@/lib/hooks/useStockDashboard';
import type { ChipsVolumeData } from '@/lib/types/api';
import type { InstitutionalDay } from '@/lib/types/view';
import { chipsVolumeOption, institutionalCumulativeOption, institutionalFlowOption } from '@/lib/charts/adapters';
import { fmt, fmtInstitutionalShares } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { CollapsibleTableSection, TableScrollHint } from '@/components/common/CollapsibleSection';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/cn';

const Skeleton = ({ h }: { h: string }) => <div className={cn('animate-pulse rounded-lg bg-muted', h)} aria-hidden />;

function KpiCards({ latest, loading }: { latest: InstitutionalDay | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h="h-20" />
        ))}
      </div>
    );
  }
  if (!latest) return <EmptyState className="py-6">暫無法人籌碼資料</EmptyState>;
  const items = [
    { label: '外資（股）', value: latest.foreign_net },
    { label: '投信（股）', value: latest.investment_trust_net },
    { label: '自營（股）', value: latest.dealer_net },
    { label: '合計（股）', value: latest.total_institutional_net },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground tabular-nums">最新：{latest.date}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border bg-muted px-3 py-3">
            <p className="mb-1 text-xs text-muted-foreground">{item.label}</p>
            <p className={cn('font-mono text-sm font-semibold tabular-nums', valueToneText(item.value))}>{fmt(item.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodayCard({ latest }: { latest: InstitutionalDay | null }) {
  if (!latest) return <EmptyState className="py-12">尚無今日法人資料</EmptyState>;
  const rows = [
    { label: '外資（不含自營）', net: latest.foreign_net, buy: latest.foreign_buy, sell: latest.foreign_sell },
    { label: '投信', net: latest.investment_trust_net, buy: latest.investment_trust_buy, sell: latest.investment_trust_sell },
    { label: '自營（合計）', net: latest.dealer_net, buy: latest.dealer_buy, sell: latest.dealer_sell },
    { label: '三大法人合計', net: latest.total_institutional_net, buy: latest.total_institutional_buy, sell: latest.total_institutional_sell },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground tabular-nums">最新：{latest.date}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border bg-muted px-4 py-3">
            <p className="mb-1 text-xs text-muted-foreground">{row.label}</p>
            <p className={cn('font-mono text-lg font-semibold tabular-nums', valueToneText(row.net))}>{fmtInstitutionalShares(row.net)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>
                買進 <span className="font-mono text-subtle">{fmtInstitutionalShares(row.buy)}</span>
              </span>
              <span>
                賣出 <span className="font-mono text-subtle">{fmtInstitutionalShares(row.sell)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryTable({ rows: all }: { rows: InstitutionalDay[] }) {
  const [mode, setMode] = useState<'net' | 'detail'>('net');
  const rows = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const hasBuySell = rows.some((r) => r.foreign_buy != null || r.foreign_sell != null);
  const td = 'px-3 py-2 text-right font-mono tabular-nums';
  const netCell = (v: number | null, bold = false) => <td className={cn(td, bold && 'font-semibold', valueToneText(v))}>{fmt(v)}</td>;
  const plainCell = (v: number | null) => <td className={cn(td, 'text-subtle')}>{fmt(v)}</td>;

  return (
    <CollapsibleTableSection
      title="法人歷史明細"
      subtitle="外資、投信、自營每日買賣超（股）"
      expandLabel={`顯示法人明細（${rows.length} 筆）`}
      collapseLabel="收合法人明細"
    >
      {hasBuySell ? (
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as 'net' | 'detail')} className="mb-2 gap-1" aria-label="明細檢視方式">
          <ToggleGroupItem value="net" className="h-8 rounded-md px-3 text-xs data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
            淨額
          </ToggleGroupItem>
          <ToggleGroupItem value="detail" className="h-8 rounded-md px-3 text-xs data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
            買賣明細
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      <TableScrollHint />
      <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
        {mode === 'net' ? (
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-muted text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">日期</th>
                {['外資（股）', '投信（股）', '自營（股）', '合計（股）'].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-t">
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
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
                <th className="px-3 py-2 text-left font-medium" rowSpan={2}>
                  日期
                </th>
                {['外資', '投信', '自營'].map((h) => (
                  <th key={h} className="border-b px-1 py-1 text-center font-medium" colSpan={3}>
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium" rowSpan={2}>
                  合計
                </th>
              </tr>
              <tr className="bg-muted text-xs text-muted-foreground">
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
                  <td className="px-3 py-2 tabular-nums">{row.date}</td>
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
  { key: 'flow', label: '區間流向', description: '三大法人每日買賣超' },
  { key: 'cumulative', label: '累計淨額', description: '法人累積買賣超走勢' },
  { key: 'chips', label: '量價籌碼', description: '價、量、法人合計整合圖' },
  { key: 'today', label: '今日法人', description: '最新一日法人結構' },
  { key: 'history', label: '歷史明細', description: '最近 30 日逐日明細' },
] as const;

function ChipsTabs({ rows, latest, chipsVolume, loading, error }: {
  rows: InstitutionalDay[] | null;
  latest: InstitutionalDay | null;
  chipsVolume: ChipsVolumeData[] | null;
  loading: boolean;
  error: string | null;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [tab, setTab] = useState<string>('flow');
  const flow = useMemo(() => institutionalFlowOption(rows, isDark), [rows, isDark]);
  const cumulative = useMemo(() => institutionalCumulativeOption(rows, isDark), [rows, isDark]);
  const chips = useMemo(() => chipsVolumeOption(chipsVolume, isDark), [chipsVolume, isDark]);
  const active = TABS.find((t) => t.key === tab);

  const body = (key: string) => {
    if (loading && key !== 'today') return <Skeleton h="h-[300px]" />;
    switch (key) {
      case 'flow':
        if (error) return <EmptyState>{error}</EmptyState>;
        // 只用 ECharts 內建的可點圖例（決議 c61）
        return flow ? (
          <EChart title="三大法人買賣超（股）" option={flow} height={280} />
        ) : (
          <EmptyState>尚無法人買賣超資料</EmptyState>
        );
      case 'cumulative':
        return cumulative ? <EChart title="法人累積買賣超（股）" option={cumulative} height={260} /> : <EmptyState>尚無累積買賣超資料</EmptyState>;
      case 'chips':
        return chips ? <EChart title="股價與法人合計" option={chips} height={300} /> : <EmptyState>尚無價量籌碼整合資料</EmptyState>;
      case 'today':
        return <TodayCard latest={latest} />;
      default:
        return rows?.length ? <HistoryTable rows={rows} /> : <EmptyState>尚無法人歷史明細</EmptyState>;
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList variant="line" aria-label="籌碼面分頁" className="w-full justify-start overflow-x-auto scrollbar-none border-b">
        {TABS.map((t) => (
          <TabsTrigger key={t.key} value={t.key} className="min-h-11 flex-none px-3 data-[state=active]:text-brand-text sm:px-4">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {active ? <p className="mt-3 text-xs text-muted-foreground">{active.description}</p> : null}
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
  const { chipsError, reloadChips, chipsLoading, institutional, institutionalLatest, chipsVolume } = dashboard;
  return (
    <div className="flex flex-col gap-5">
      {chipsError ? (
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="outline" onClick={reloadChips} className="min-h-9">
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {chipsError}
        </Notice>
      ) : null}
      <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
        <KpiCards latest={institutionalLatest} loading={chipsLoading} />
      </section>
      <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
        <ChipsTabs rows={institutional} latest={institutionalLatest} chipsVolume={chipsVolume} loading={chipsLoading} error={chipsError} />
      </section>
    </div>
  );
}
