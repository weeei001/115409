import clsx from 'clsx';

import type {
  Claim,
  DailyEvidenceValue,
  EvidenceItem,
  ForwardViews,
  KeyDay,
  Risk,
  TextBriefResponse,
  Verification,
  WatchPoint,
} from '../../../lib/demo/textBriefTypes';
import styles from '../../../styles/textBriefDemo.module.css';
import { CONF, FIELD, FORWARD_VIEWS, GROUP, STANCE, STANCE_TONE, VERIFY } from './constants';
import { ClaimItem, forwardViewKey, useHighlight } from './highlight';
import { Card, Hint, Note, Tag, text } from './ui';

function ClaimList({ items }: { items?: Claim[] }) {
  if (!items || !items.length) return <Hint>（無）</Hint>;
  return (
    <div>
      {items.map((it) => (
        <ClaimItem key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <p>
            <span className={clsx(styles.dir, it.direction && styles[it.direction])} />
            {text(it.text)}
          </p>
        </ClaimItem>
      ))}
    </div>
  );
}

/** 漲跌幅由後端依 `ref` 回填，不是模型寫的，所以這裡直接照數字上色 */
function moveColor(move: number | null | undefined): string {
  if (move == null) return 'var(--muted)';
  if (move > 0) return 'var(--pos)';
  if (move < 0) return 'var(--neg)';
  return 'var(--muted)';
}

function KeyDays({ items }: { items?: KeyDay[] }) {
  return (
    <div>
      {(items ?? []).map((it) => (
        <ClaimItem key={it.id} claimKey={it.id} ids={it.evidence_ids} className={styles.kd}>
          <span className={styles.d}>{text(it.date)}</span>
          <span className={styles.m} style={{ color: moveColor(it.move_pct) }}>
            {it.move_pct == null
              ? '—'
              : `${it.move_pct > 0 ? '+' : ''}${it.move_pct.toFixed(2)}%`}
          </span>
          <span className={styles.v}>
            {it.volume_ratio == null ? '' : `量 ${it.volume_ratio.toFixed(2)}×`}
          </span>
          <span className={styles.w}>{text(it.what)}</span>
        </ClaimItem>
      ))}
    </div>
  );
}

function RiskList({ items }: { items?: Risk[] }) {
  return (
    <div>
      {(items ?? []).map((it) => (
        <ClaimItem key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <span className={styles.lbl}>{text(it.risk_type)}</span>
          <p>{text(it.description)}</p>
          <p className={styles.note}>什麼情況會發生：{text(it.trigger)}</p>
        </ClaimItem>
      ))}
    </div>
  );
}

function WatchList({ items }: { items?: WatchPoint[] }) {
  return (
    <div>
      {(items ?? []).map((it) => (
        <ClaimItem key={it.id} claimKey={it.id} ids={it.evidence_ids}>
          <span className={styles.lbl}>
            {text(it.what_to_watch)}　·　{text(it.when)}
          </span>
          <p>{text(it.why_it_matters)}</p>
        </ClaimItem>
      ))}
    </div>
  );
}

function ForwardViewCards({ views }: { views?: ForwardViews }) {
  return (
    <div className={styles.fv}>
      {FORWARD_VIEWS.map(([key, label]) => {
        const v = views?.[key];
        if (!v) return null;
        return (
          <div key={key}>
            <div className={styles.h}>{label}</div>
            <Tag tone={STANCE_TONE[v.stance] ?? 'plain'}>{STANCE[v.stance] ?? v.stance}</Tag>
            <ClaimItem claimKey={forwardViewKey(key)} ids={v.evidence_ids}>
              <p>{text(v.reason)}</p>
            </ClaimItem>
            <div className={styles.inv}>什麼情況就不成立：{text(v.invalidation)}</div>
          </div>
        );
      })}
    </div>
  );
}

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
  const base = item.field === 'news' ? text(item.title ?? v) : String(v);
  return base + (extra.length ? `（${extra.join('、')}）` : '');
}

function EvidencePanel({ catalog }: { catalog?: EvidenceItem[] }) {
  const { isEvidenceOn, toggleEvidence, bindEvidence } = useHighlight();
  if (!catalog || !catalog.length) return <Hint>（這次沒有用到任何原始資料）</Hint>;
  return (
    <div>
      {GROUP.map(([label, test]) => {
        const rows = catalog.filter((i) => test(i.id));
        if (!rows.length) return null;
        return (
          <div key={label}>
            <div className={styles.evgrp}>{label}</div>
            {rows.map((item) => (
              <div
                key={item.id}
                ref={bindEvidence(item.id)}
                className={clsx(styles.ev, isEvidenceOn(item.id) && styles.on)}
                onClick={() => toggleEvidence(item.id)}
              >
                <span className={styles.id}>{item.id}</span>
                <span className={styles.k}>
                  {FIELD[item.field] ?? item.field}
                  {item.date ? ` · ${item.date}` : ''}
                </span>
                <div className={styles.val}>{evidenceValue(item)}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function VerifyPanel({ verification }: { verification?: Verification }) {
  const rows = VERIFY.map(([key, label]) => ({
    key,
    label,
    values: verification?.[key] ?? [],
  }));
  const dirty = rows.filter((r) => r.values.length).length;
  return (
    <div>
      <Note>
        {dirty === 0
          ? '十項全部乾淨：AI 寫的內容，系統一個字都沒有動過。'
          : `有 ${dirty} 項不乾淨，下面是系統實際改了什麼。`}
      </Note>
      <div>
        {rows.map((r) => (
          <div key={r.key} className={styles.vf}>
            <span className={styles.n}>{r.label}</span>
            {r.values.length ? <code>{r.values.join(' / ')}</code> : <Tag tone="ok">無</Tag>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Limitations({ title, items }: { title: string; items: string[] }) {
  return (
    <Card title={title}>
      <ul className={styles.ul}>
        {items.map((t, i) => (
          <li key={i}>{text(t)}</li>
        ))}
      </ul>
    </Card>
  );
}

export function BriefPane({ data }: { data: TextBriefResponse }) {
  const b = data.brief;
  return (
    <div className={styles.cols}>
      <div>
        {!b ? (
          <Card title="這次沒有產出分析">
            <Hint>AI 這次寫出來的東西沒通過檢查，已經被擋下來。右邊的檢查表列出原因。</Hint>
          </Card>
        ) : (
          <>
            <div className={styles.card}>
              <p className={styles.headline}>{text(b.headline)}</p>
              <div className={styles.meta} style={{ margin: 0 }}>
                <Tag tone={STANCE_TONE[b.overall_stance ?? ''] ?? 'plain'}>
                  整體　{STANCE[b.overall_stance ?? ''] ?? b.overall_stance}
                </Tag>
                <Tag>資料充分度　{CONF[b.confidence ?? ''] ?? b.confidence}</Tag>
              </div>
              <p className={styles.reason}>{text(b.confidence_reason)}</p>
            </div>

            <Card title="關鍵交易日">
              <KeyDays items={b.key_days} />
            </Card>
            <Card title="現在是什麼狀態">
              <ClaimList items={b.current_status} />
            </Card>

            <div className={styles.two}>
              <Card title="正面因素">
                <ClaimList items={b.positive_factors} />
              </Card>
              <Card title="負面因素">
                <ClaimList items={b.negative_factors} />
              </Card>
            </div>

            {b.source_divergences && b.source_divergences.length ? (
              <Card title="不同資料互相矛盾的地方">
                <ClaimList items={b.source_divergences} />
              </Card>
            ) : null}

            <div className={styles.two}>
              <Card title="需要留意的風險">
                <RiskList items={b.risks} />
              </Card>
              <Card title="接下來觀察什麼">
                <WatchList items={b.watch_points} />
              </Card>
            </div>

            <Card title="未來看法　（只講方向，以及什麼情況下這個看法就不成立，不給價格）">
              <ForwardViewCards views={b.forward_views} />
            </Card>

            {b.limitations && b.limitations.length ? (
              <Limitations title="這份分析看不到的部分" items={b.limitations} />
            ) : null}
          </>
        )}
      </div>

      <div className={styles.side}>
        <Card title="用到的原始資料　（點任一筆，看有哪些結論是根據它寫的）">
          <EvidencePanel catalog={data.evidence_catalog} />
        </Card>
        <Card title="系統檢查結果">
          <VerifyPanel verification={data.verification} />
        </Card>
        {data.limitations && data.limitations.length ? (
          <Limitations title="這次執行的限制" items={data.limitations} />
        ) : null}
        <Card>
          <div className={styles.disc}>{text(data.disclaimer?.text)}</div>
        </Card>
      </div>
    </div>
  );
}
