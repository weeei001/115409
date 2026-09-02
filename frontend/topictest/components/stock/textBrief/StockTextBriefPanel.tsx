import React from 'react';
import {
  AlertTriangle,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  Claim,
  DailyEvidenceValue,
  Direction,
  EvidenceItem,
  ForwardViews,
  KeyDay,
  Risk,
  TextBriefResponse,
  WatchPoint,
} from '../../../lib/types/textBrief';
import {
  CONF,
  FIELD,
  FORWARD_VIEWS,
  GROUP,
  STANCE,
  STANCE_TONE,
  STATUS,
  type BriefTone,
} from '../../../lib/utils/textBriefLabels';
import { forwardViewKey } from '../../../lib/utils/textBriefClaims';
import type { UseStockTextBriefResult } from '../../../lib/hooks/useStockTextBrief';
import { BriefHighlightProvider, ClaimRow, useBriefHighlight } from './BriefHighlight';

interface Props {
  symbol: string;
  brief: UseStockTextBriefResult;
}

/* ── 小元件 ───────────────────────────────────────── */

const TONE_CLASS: Record<BriefTone, string> = {
  ok: 'border-up/25 bg-up-muted text-up-emphasis',
  bad: 'border-down/25 bg-down-muted text-down-emphasis',
  warn: 'ui-alert-warning',
  info: 'border-brand/30 bg-brand/10 text-brand',
  plain:
    'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]',
};

const Tag: React.FC<{ tone?: BriefTone; children: React.ReactNode }> = ({
  tone = 'plain',
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}
  >
    {children}
  </span>
);

const Section: React.FC<{
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, icon, children }) => (
  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
        {icon}
        {title}
      </h3>
      {hint ? <span className="text-xs text-[var(--color-text-muted)]">{hint}</span> : null}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

const Empty: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-[var(--color-text-muted)]">{children ?? '（無）'}</p>
);

const DIRECTION_DOT: Record<Direction, string> = {
  positive: 'bg-up',
  negative: 'bg-down',
  mixed: 'bg-[var(--color-warning-icon)]',
  neutral: 'bg-[var(--color-text-muted)]/50',
  not_applicable: 'bg-[var(--color-text-muted)]/50',
};

/* ── 各段內容 ─────────────────────────────────────── */

const ClaimList: React.FC<{ items?: Claim[] }> = ({ items }) => {
  if (!items?.length) return <Empty />;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <ClaimRow key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <p className="text-sm leading-7 text-[var(--color-text-primary)]">
            <span
              aria-hidden
              className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                DIRECTION_DOT[it.direction ?? 'neutral']
              }`}
            />
            {it.text}
          </p>
        </ClaimRow>
      ))}
    </div>
  );
};

/** 漲跌幅由後端依 `ref` 回填，不是模型寫的，所以直接照數字上色 */
function moveClass(move?: number | null): string {
  if (move == null) return 'text-[var(--color-text-muted)]';
  if (move > 0) return 'text-up';
  if (move < 0) return 'text-down';
  return 'text-[var(--color-text-muted)]';
}

const KeyDays: React.FC<{ items?: KeyDay[] }> = ({ items }) => {
  if (!items?.length) return <Empty />;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <ClaimRow key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
              {it.date}
            </span>
            <span className={`text-sm font-bold tabular-nums ${moveClass(it.move_pct)}`}>
              {it.move_pct == null
                ? '—'
                : `${it.move_pct > 0 ? '+' : ''}${it.move_pct.toFixed(2)}%`}
            </span>
            {it.volume_ratio == null ? null : (
              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                量 {it.volume_ratio.toFixed(2)}×
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-7 text-[var(--color-text-primary)]">{it.what}</p>
        </ClaimRow>
      ))}
    </div>
  );
};

const RiskList: React.FC<{ items?: Risk[] }> = ({ items }) => {
  if (!items?.length) return <Empty />;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <ClaimRow key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <span className="block text-xs font-bold text-[var(--color-text-muted)]">
            {it.risk_type}
          </span>
          <p className="mt-1 text-sm leading-7 text-[var(--color-text-primary)]">
            {it.description}
          </p>
          <p className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
            什麼情況會發生：{it.trigger}
          </p>
        </ClaimRow>
      ))}
    </div>
  );
};

const WatchList: React.FC<{ items?: WatchPoint[] }> = ({ items }) => {
  if (!items?.length) return <Empty />;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <ClaimRow key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <span className="block text-xs font-bold text-[var(--color-text-muted)]">
            {it.what_to_watch}　·　{it.when}
          </span>
          <p className="mt-1 text-sm leading-7 text-[var(--color-text-primary)]">
            {it.why_it_matters}
          </p>
        </ClaimRow>
      ))}
    </div>
  );
};

const ForwardViewCards: React.FC<{ views?: ForwardViews }> = ({ views }) => {
  const shown = FORWARD_VIEWS.filter(([key]) => views?.[key]);
  if (!shown.length) return <Empty />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {shown.map(([key, label]) => {
        const v = views![key]!;
        return (
          <div
            key={key}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-3"
          >
            <div className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</div>
            <div className="mt-2">
              <Tag tone={STANCE_TONE[v.stance] ?? 'plain'}>{STANCE[v.stance] ?? v.stance}</Tag>
            </div>
            <ClaimRow claimKey={forwardViewKey(key)} ids={v.evidence_ids} className="mt-2 -mx-1">
              <p className="text-sm leading-7 text-[var(--color-text-primary)]">{v.reason}</p>
            </ClaimRow>
            <p className="mt-2 text-xs leading-6 text-[var(--color-text-secondary)]">
              什麼情況就不成立：{v.invalidation}
            </p>
          </div>
        );
      })}
    </div>
  );
};

/** 一筆證據要顯示成什麼字；交易日是物件，其餘是純量加註記 */
function evidenceValue(item: EvidenceItem): string {
  const v = item.value;
  if (v && typeof v === 'object') {
    const d = v as DailyEvidenceValue;
    const bits: string[] = [];
    if (d.close != null) bits.push(`收 ${d.close}`);
    if (d.chg_pct != null) bits.push(`${d.chg_pct > 0 ? '+' : ''}${d.chg_pct}%`);
    if (d.vol_lots != null) bits.push(`${Number(d.vol_lots).toLocaleString()} 張`);
    if (d.vol_vs_ma5_pct != null)
      bits.push(`量能 ${d.vol_vs_ma5_pct > 0 ? '+' : ''}${d.vol_vs_ma5_pct}%`);
    if (d.foreign_net_lots != null)
      bits.push(`外資 ${Number(d.foreign_net_lots).toLocaleString()} 張`);
    return bits.join('　');
  }
  const extra: string[] = [];
  if (item.period) extra.push(item.period);
  if (item.yoy_pct != null) extra.push(`年增 ${item.yoy_pct}%`);
  if (item.mom_pct != null) extra.push(`月增 ${item.mom_pct}%`);
  if (item.qoq_pct != null) extra.push(`季增 ${item.qoq_pct}%`);
  if (item.pct_rank_1y != null) extra.push(`近一年第 ${item.pct_rank_1y} 百分位`);
  const base = item.field === 'news' ? String(item.title ?? v ?? '') : String(v ?? '');
  return base + (extra.length ? `（${extra.join('、')}）` : '');
}

const EvidenceCatalog: React.FC<{ catalog?: EvidenceItem[] }> = ({ catalog }) => {
  const { isEvidenceOn, toggleEvidence, bindEvidence, hasFocus } = useBriefHighlight();
  if (!catalog?.length) return <Empty>（這次沒有用到任何原始資料）</Empty>;
  return (
    <div className="space-y-4">
      {GROUP.map(([label, test]) => {
        const rows = catalog.filter((i) => test(i.id));
        if (!rows.length) return null;
        return (
          <div key={label}>
            <div className="text-xs font-bold text-[var(--color-text-muted)]">{label}</div>
            <div className="mt-1.5 space-y-1">
              {rows.map((item) => {
                const on = isEvidenceOn(item.id);
                return (
                  <div
                    key={item.id}
                    ref={bindEvidence(item.id)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    onClick={() => toggleEvidence(item.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      toggleEvidence(item.id);
                    }}
                    className={`rounded-lg border px-2.5 py-2 text-sm cursor-pointer transition-[background-color,border-color,opacity] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                      on
                        ? 'border-brand/40 bg-brand/10'
                        : `border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 ${
                            hasFocus ? 'opacity-55' : ''
                          }`
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] text-brand">{item.id}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {FIELD[item.field] ?? item.field}
                        {item.date ? ` · ${item.date}` : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 leading-6 text-[var(--color-text-primary)] break-words">
                      {evidenceValue(item)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ── 主面板 ───────────────────────────────────────── */

const StanceIcon: React.FC<{ tone: BriefTone }> = ({ tone }) => {
  if (tone === 'ok') return <TrendingUp size={14} aria-hidden />;
  if (tone === 'bad') return <TrendingDown size={14} aria-hidden />;
  return <Sparkles size={14} aria-hidden />;
};

export const StockTextBriefPanel: React.FC<Props> = ({ symbol, brief }) => {
  const { loading, error, data, seconds, run } = brief;

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-10 flex flex-col items-center justify-center gap-4 text-center">
        <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
        <div>
          <p className="text-base font-semibold">正在分析 {symbol}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)] max-w-md">
            整合價量、籌碼、技術面與新聞後交由 AI 撰寫，第一次大約需要 90 秒；已等待{' '}
            <span className="tabular-nums font-semibold">{seconds}</span> 秒。
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-up-muted border border-up/20 rounded-2xl p-4 text-sm text-up-emphasis flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
        <button
          type="button"
          onClick={() => void run(true)}
          className="self-start inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg cursor-pointer"
          style={{ background: 'var(--brand-gradient)' }}
        >
          <RefreshCw size={14} aria-hidden />
          重新分析
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 p-10 flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">尚未產生分析。</p>
        <button
          type="button"
          onClick={() => void run(false)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg cursor-pointer"
          style={{ background: 'var(--brand-gradient)' }}
        >
          <Sparkles size={14} aria-hidden />
          開始分析
        </button>
      </div>
    );
  }

  const b = data.brief;
  const [, statusNote] = STATUS[data.status] ?? (['plain', data.status] as const);

  if (!b) {
    return (
      <div className="flex flex-col gap-4">
        <div className="ui-alert-warning rounded-2xl border p-4 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-icon" aria-hidden />
          <span>這次沒有產出分析：AI 寫出來的內容沒通過系統檢查，已經被擋下來（{statusNote}）。</span>
        </div>
        <button
          type="button"
          onClick={() => void run(true)}
          className="self-start inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg cursor-pointer"
          style={{ background: 'var(--brand-gradient)' }}
        >
          <RefreshCw size={14} aria-hidden />
          重新分析
        </button>
      </div>
    );
  }

  const stanceTone: BriefTone = STANCE_TONE[b.overall_stance ?? ''] ?? 'plain';

  return (
    <BriefHighlightProvider brief={b}>
      <div className="flex flex-col gap-4">
        {/* [0] 結論：現在是什麼狀態 */}
        <section
          aria-label="整體結論"
          className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-[var(--shadow-card)]"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1"
            style={{ background: 'var(--brand-gradient)' }}
          />
          <div className="pl-2 sm:pl-3">
            <p className="text-base sm:text-lg font-bold leading-8 text-[var(--color-text-primary)]">
              {b.headline}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag tone={stanceTone}>
                <StanceIcon tone={stanceTone} />
                整體 {STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
              </Tag>
              <Tag>資料充分度 {CONF[b.confidence ?? ''] ?? b.confidence}</Tag>
            </div>
            {b.confidence_reason ? (
              <p className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                {b.confidence_reason}
              </p>
            ) : null}
          </div>
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">
          點任一句結論，右側會亮出它根據的原始資料；點原始資料，則反查有哪些結論用到它（Esc 取消）。
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 flex flex-col gap-4">
            <Section title="現在是什麼狀態" icon={<Sparkles size={15} className="text-brand" aria-hidden />}>
              <ClaimList items={b.current_status} />
            </Section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Section title="正面因素">
                <ClaimList items={b.positive_factors} />
              </Section>
              <Section title="負面因素">
                <ClaimList items={b.negative_factors} />
              </Section>
            </div>

            {b.source_divergences?.length ? (
              <Section title="不同資料互相矛盾的地方">
                <ClaimList items={b.source_divergences} />
              </Section>
            ) : null}

            <Section title="關鍵交易日" hint="漲跌幅與量能倍數由後端回填，不是 AI 寫的">
              <KeyDays items={b.key_days} />
            </Section>

            <Section
              title="需要留意的風險"
              icon={<AlertTriangle size={15} className="text-warning-icon" aria-hidden />}
            >
              <RiskList items={b.risks} />
            </Section>

            <Section title="接下來觀察什麼" icon={<Eye size={15} className="text-brand" aria-hidden />}>
              <WatchList items={b.watch_points} />
            </Section>

            <Section title="未來看法" hint="只講方向與什麼情況下不成立，不給價格">
              <ForwardViewCards views={b.forward_views} />
            </Section>

            {b.limitations?.length ? (
              <Section title="這份分析看不到的部分">
                <ul className="list-disc space-y-1 pl-5 text-sm leading-7 text-[var(--color-text-secondary)]">
                  {b.limitations.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>

          {/* [1] 為什麼：所有結論引用的原始資料 */}
          <div className="lg:col-span-5 lg:sticky lg:top-0">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
              <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
                <FileText size={15} className="text-brand" aria-hidden />
                用到的原始資料
              </h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                AI 只看得到這些數字與新聞，看不到的都寫在「這份分析看不到的部分」。
              </p>
              <div className="mt-3 lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto lg:pr-1">
                <EvidenceCatalog catalog={data.evidence_catalog} />
              </div>
            </div>
          </div>
        </div>

        {data.limitations?.length ? (
          <Section title="這次執行的限制">
            <ul className="list-disc space-y-1 pl-5 text-sm leading-7 text-[var(--color-text-secondary)]">
              {data.limitations.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        <p className="text-xs leading-6 text-[var(--color-text-muted)]">
          {data.disclaimer?.text ??
            '本區內容由系統依據公開資料與模型整理產生，僅供研究與參考，不代表保證獲利。投資前請自行評估風險。'}
        </p>
      </div>
    </BriefHighlightProvider>
  );
};
