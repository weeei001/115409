import React from 'react';
import { AlertTriangle, CalendarClock, Eye, Sparkles } from 'lucide-react';
import { Expandable } from '@/components/common/CollapsibleSection';
import type { Brief, Claim, ForwardViews, KeyDay, Risk, WatchPoint } from '@/lib/types/textBrief';
import { FORWARD_VIEWS, STANCE, STANCE_TONE, type BriefTone } from '@/lib/brief/textBriefLabels';
import { forwardViewKey } from '@/lib/brief/textBriefClaims';
import { ClaimRow } from './BriefHighlight';
import { ClaimTypeBadge, DirectionMark, Empty, SectionCard, StanceIcon, Tag } from './BriefAtoms';

/** 每段預設顯示幾項，其餘收在「展開更多」 */
const SECTION_PREVIEW = 3;

/** importance=high 先排；後端只有 high／medium 兩級 */
function byImportance<T extends { importance?: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => Number(b.importance === 'high') - Number(a.importance === 'high')
  );
}

function ItemGroup<T>({
  items,
  render,
  label,
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
  label: string;
}) {
  if (!items.length) return <Empty />;
  const preview = items.slice(0, SECTION_PREVIEW);
  const rest = items.slice(SECTION_PREVIEW);
  return (
    <>
      <div className="space-y-1">{preview.map(render)}</div>
      {rest.length ? (
        <Expandable
          expandLabel={`展開更多${label}（${rest.length} 項）`}
          collapseLabel="收起"
          className="mt-3"
          contentClassName="mt-1 space-y-1"
        >
          {rest.map(render)}
        </Expandable>
      ) : null}
    </>
  );
}

const DIRECTION_LABEL: Record<string, string> = {
  positive: '正面',
  negative: '負面',
  mixed: '多空交雜',
  neutral: '中性',
  not_applicable: '不適用',
};

const ClaimItems: React.FC<{ items?: Claim[]; label: string }> = ({ items, label }) => (
  <ItemGroup
    items={byImportance(items ?? [])}
    label={label}
    render={(item) => (
      <ClaimRow
        key={item.id}
        claimKey={item.id}
        ids={item.evidence_ids}
        warnWhenEmpty={item.claim_type === 'observation'}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DirectionMark
            direction={item.direction}
            label={DIRECTION_LABEL[item.direction ?? 'neutral']}
          />
          <ClaimTypeBadge claimType={item.claim_type} />
        </div>
        <p className="mt-1 text-sm leading-7 text-foreground">{item.text}</p>
      </ClaimRow>
    )}
  />
);

/** 漲跌幅由後端依 `ref` 回填，不是模型寫的，所以直接照數字上色 */
function moveClass(move?: number | null): string {
  if (move == null) return 'text-muted-foreground';
  if (move > 0) return 'text-up';
  if (move < 0) return 'text-down';
  return 'text-muted-foreground';
}

const KeyDayItems: React.FC<{ items?: KeyDay[] }> = ({ items }) => (
  <ItemGroup
    items={items ?? []}
    label="交易日"
    render={(item) => (
      <ClaimRow key={item.id} claimKey={item.id} ids={item.evidence_ids}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-xs tabular-nums text-subtle">
            {item.date}
          </span>
          <span className={`text-sm font-bold tabular-nums ${moveClass(item.move_pct)}`}>
            {item.move_pct == null
              ? '—'
              : `${item.move_pct > 0 ? '漲 ' : item.move_pct < 0 ? '跌 ' : ''}${Math.abs(item.move_pct).toFixed(2)}%`}
          </span>
          {item.volume_ratio == null ? null : (
            <span className="text-xs tabular-nums text-muted-foreground">
              量能 {item.volume_ratio.toFixed(2)} 倍
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-7 text-foreground">{item.what}</p>
      </ClaimRow>
    )}
  />
);

const RiskItems: React.FC<{ items?: Risk[] }> = ({ items }) => (
  <ItemGroup
    items={items ?? []}
    label="風險"
    render={(item) => (
      <ClaimRow key={item.id} claimKey={item.id} ids={item.evidence_ids}>
        <span className="block text-xs font-bold text-muted-foreground">
          {item.risk_type}
        </span>
        <p className="mt-1 text-sm leading-7 text-foreground">{item.description}</p>
        <p className="mt-1 text-xs leading-6 text-subtle">
          <span className="font-semibold">觸發條件：</span>
          {item.trigger}
        </p>
      </ClaimRow>
    )}
  />
);

const WatchItems: React.FC<{ items?: WatchPoint[] }> = ({ items }) => (
  <ItemGroup
    items={items ?? []}
    label="觀察點"
    render={(item) => (
      <ClaimRow key={item.id} claimKey={item.id} ids={item.evidence_ids}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">
            {item.what_to_watch}
          </span>
          <span className="text-xs text-muted-foreground">{item.when}</span>
        </div>
        <p className="mt-1 text-sm leading-7 text-subtle">
          {item.why_it_matters}
        </p>
      </ClaimRow>
    )}
  />
);

const ForwardViewCards: React.FC<{ views?: ForwardViews }> = ({ views }) => {
  const shown = FORWARD_VIEWS.filter(([key]) => views?.[key]);
  if (!shown.length) return <Empty />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {shown.map(([key, label]) => {
        const view = views![key]!;
        const tone: BriefTone = STANCE_TONE[view.stance] ?? 'plain';
        return (
          <div
            key={key}
            className="border-l border-border pl-3"
          >
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-2">
              <Tag tone={tone}>
                <StanceIcon tone={tone} size={13} />
                {STANCE[view.stance] ?? view.stance}
              </Tag>
            </div>
            <ClaimRow claimKey={forwardViewKey(key)} ids={view.evidence_ids} className="mt-2 -mx-1">
              <p className="text-sm leading-7 text-foreground">{view.reason}</p>
            </ClaimRow>
            <p className="mt-2 text-xs leading-6 text-subtle">
              <span className="font-semibold">什麼情況就不成立：</span>
              {view.invalidation}
            </p>
          </div>
        );
      })}
    </div>
  );
};

/** 分頁一：重點 */
export const KeyPointsTab: React.FC<{ brief: Brief }> = ({ brief }) => (
  <div className="flex flex-col gap-4">
    <SectionCard
      title="現在是什麼狀態"
      icon={<Sparkles size={15} className="text-brand" aria-hidden />}
      hint="這一段是對目前價量、籌碼與基本面的描述，每一句都可以點開看依據。"
    >
      <ClaimItems items={brief.current_status} label="狀態" />
    </SectionCard>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SectionCard title="正面因素">
        <ClaimItems items={brief.positive_factors} label="正面因素" />
      </SectionCard>
      <SectionCard title="負面因素">
        <ClaimItems items={brief.negative_factors} label="負面因素" />
      </SectionCard>
    </div>

    {brief.source_divergences?.length ? (
      <SectionCard
        title="資料互相矛盾的地方"
        hint="不同來源講的不一樣，AI 沒有硬選一邊，判讀時要自己權衡。"
      >
        <ClaimItems items={brief.source_divergences} label="矛盾" />
      </SectionCard>
    ) : null}
  </div>
);

/** 分頁二：情境與風險 */
export const ScenarioTab: React.FC<{ brief: Brief }> = ({ brief }) => (
  <div className="flex flex-col gap-4">
    <SectionCard
      title="不同時間長度的看法"
      icon={<CalendarClock size={15} className="text-brand" aria-hidden />}
      hint="只講方向與什麼情況下不成立，不給買賣建議與目標價；天數以交易日計算。"
    >
      <ForwardViewCards views={brief.forward_views} />
    </SectionCard>

    <SectionCard
      title="需要留意的風險"
      icon={<AlertTriangle size={15} className="text-warning-icon" aria-hidden />}
      hint="每一項都附上觸發條件，也就是「什麼情況下這個風險會真的發生」。"
    >
      <RiskItems items={brief.risks} />
    </SectionCard>

    <SectionCard
      title="接下來觀察什麼"
      icon={<Eye size={15} className="text-brand" aria-hidden />}
    >
      <WatchItems items={brief.watch_points} />
    </SectionCard>

    <SectionCard title="關鍵交易日" hint="漲跌幅與量能倍數由後端依當日資料回填，不是 AI 寫的。">
      <KeyDayItems items={brief.key_days} />
    </SectionCard>

    {brief.limitations?.length ? (
      <SectionCard title="這份分析看不到的部分">
        <ul className="list-disc space-y-1 pl-5 text-sm leading-7 text-subtle">
          {brief.limitations.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </SectionCard>
    ) : null}
  </div>
);
