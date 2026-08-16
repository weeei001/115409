import clsx from 'clsx';
import type { ReactNode } from 'react';

import styles from '../../../styles/textBriefDemo.module.css';

/** 給沒有自然 fallback 的字串欄位用；對齊原本 DEMO 的 `esc()` */
export function text(v: unknown): string {
  return v == null ? '' : String(v);
}

export function Card({ title, children }: { title?: string | null; children: ReactNode }) {
  return (
    <div className={styles.card}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </div>
  );
}

export function Tag({
  tone = 'plain',
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return <span className={clsx(styles.tag, styles[tone])}>{children}</span>;
}

export function Pill({ tone, children }: { tone: 'y' | 'n' | 'q' | 'm'; children: ReactNode }) {
  return <span className={clsx(styles.pill, styles[tone])}>{children}</span>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

export function Dot({ color }: { color?: string }) {
  return <span className={styles.dot} style={{ background: color }} />;
}

export function RawJson({ label, value }: { label: string; value: unknown }) {
  return (
    <details className={styles.raw}>
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/* ── 資料表 ───────────────────────────────────────────── */

export interface Cell {
  content?: ReactNode;
  cls?: string;
}

export interface Row {
  key: string;
  /** 底色列 */
  mark?: boolean;
  cells: Cell[];
}

export function DataTable({ headers, rows }: { headers: string[]; rows: Row[] }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.tbl}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={clsx(r.mark && styles.mark)}>
              {r.cells.map((c, i) => (
                <td key={i} className={c.cls}>
                  {c.content == null ? '—' : c.content}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 數值儲存格：靠右、正負上色；`digits` 省略時走千分位 */
export function num(v: number | null | undefined, digits?: number): Cell {
  if (v == null) return { content: '—', cls: styles.num };
  return {
    content: digits == null ? Number(v).toLocaleString() : Number(v).toFixed(digits),
    cls: clsx(styles.num, v > 0 && styles.pos, v < 0 && styles.neg),
  };
}
