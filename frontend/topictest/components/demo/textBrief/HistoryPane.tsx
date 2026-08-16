import clsx from 'clsx';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { HistoryItem } from '../../../lib/demo/textBriefTypes';
import styles from '../../../styles/textBriefDemo.module.css';
import { MODEL_COLORS, STATUS_TONE, UNKNOWN_MODEL } from './constants';
import { Card, DataTable, Dot, Hint, Note, Tag, num, type Row } from './ui';

const modelOf = (it: HistoryItem) => it.model_name || UNKNOWN_MODEL;

/** 依「本次載入到的模型名稱排序後的位置」指派顏色，同一批資料每次都一樣 */
function buildModelIndex(items: HistoryItem[]): Map<string, string> {
  const names = Array.from(new Set(items.map(modelOf))).sort();
  return new Map(names.map((name, i) => [name, MODEL_COLORS[i % MODEL_COLORS.length]]));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 每個模型一張小卡：跑幾次、成功幾次、耗時中位數 */
function ModelCards({ items, colors }: { items: HistoryItem[]; colors: Map<string, string> }) {
  return (
    <div className={styles.mcards}>
      {Array.from(colors.keys()).map((name) => {
        const mine = items.filter((it) => modelOf(it) === name);
        const ok = mine.filter((it) => it.status === 'verified').length;
        const bad = mine.length - ok;
        const ms = median(
          mine.map((it) => it.latency_ms).filter((v): v is number => v != null),
        );
        return (
          <div key={name} className={styles.mcard} style={{ borderLeftColor: colors.get(name) }}>
            <div className={styles.nm}>
              <Dot color={colors.get(name)} />
              {name}
            </div>
            <div className={styles.st}>
              {mine.length} 次　·　通過 {ok}
              {bad ? `　·　其他 ${bad}` : ''}
              　·　平常花 {ms == null ? '—' : `${(ms / 1000).toFixed(1)} 秒`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HistoryPane({
  apiBase,
  symbol,
  currentId,
  onOpen,
}: {
  apiBase: string;
  symbol: string;
  currentId: number | null;
  onOpen: (id: number) => void;
}) {
  const [onlySymbol, setOnlySymbol] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    setModel(null);
    const qs =
      '?limit=100' + (onlySymbol && symbol ? `&symbol=${encodeURIComponent(symbol)}` : '');
    fetch(`${apiBase}/analyze/stock-behavior/text-brief/history${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { items?: HistoryItem[] };
      })
      .then((json) => {
        if (!cancelled) setItems(json.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, onlySymbol, symbol, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  let body: ReactNode;
  if (error) {
    body = <Hint>讀不到執行紀錄（{error}）。這一頁要連得上分析服務才看得到；載入的範例沒有歷史紀錄。</Hint>;
  } else if (items == null) {
    body = <Hint>讀取中…</Hint>;
  } else if (!items.length) {
    body = <Hint>還沒有任何執行紀錄。</Hint>;
  } else {
    const colors = buildModelIndex(items);
    const shown = model ? items.filter((it) => modelOf(it) === model) : items;
    const rows: Row[] = shown.map((it) => ({
      key: String(it.id),
      mark: currentId != null && it.id === currentId,
      cells: [
        { content: `#${it.id}`, cls: styles.id },
        { content: (it.created_at ?? '').replace('T', ' ').slice(0, 19) },
        { content: it.symbol },
        { content: it.as_of_date },
        {
          content: (
            <span>
              <Dot color={colors.get(modelOf(it))} />
              {modelOf(it)}
            </span>
          ),
          cls: styles.mdl,
        },
        { content: <Tag tone={STATUS_TONE[it.status ?? ''] ?? 'plain'}>{it.status}</Tag> },
        num(it.latency_ms == null ? null : Math.round(it.latency_ms / 100) / 10, 1),
        { content: it.news_count },
        { content: it.config_hash || '—', cls: styles.id },
        { content: it.summary || '—', cls: styles.wrapcell },
        {
          content: (
            <button
              type="button"
              className={clsx(styles.ghost, styles.mini)}
              onClick={() => onOpen(it.id)}
            >
              載入
            </button>
          ),
        },
      ],
    }));

    body = (
      <>
        <ModelCards items={items} colors={colors} />
        <div className={styles.sumline}>
          <button
            type="button"
            className={clsx(styles.mchip, model === null && styles.on)}
            onClick={() => setModel(null)}
          >
            全部模型（{items.length}）
          </button>
          {Array.from(colors).map(([name, color]) => (
            <button
              key={name}
              type="button"
              className={clsx(styles.mchip, model === name && styles.on)}
              style={{ color }}
              onClick={() => setModel(name)}
            >
              <Dot color={color} />
              {name}（{items.filter((it) => modelOf(it) === name).length}）
            </button>
          ))}
        </div>
        <Note>
          每一列是一次 AI 產生，包含失敗和重試的那幾次。耗時是 AI 回應花掉的秒數。
          按「載入」會用當時存下來的結果重畫前面三個分頁，連同那一次給 AI 看的資料，
          所以可以把不同模型的同一題叫出來直接比較。
        </Note>
        <DataTable
          headers={[
            'id',
            '時間',
            '股票',
            '分析到',
            '模型',
            '檢查結果',
            '花幾秒',
            '新聞',
            '設定',
            '摘要',
            '',
          ]}
          rows={rows}
        />
      </>
    );
  }

  return (
    <Card title="歷次執行紀錄　（每一次產生分析都留一筆，新的在上面）">
      <div className={styles.sumline}>
        <button
          type="button"
          className={clsx(styles.ghost, styles.small)}
          onClick={() => setOnlySymbol(true)}
        >
          只看 {symbol}
        </button>
        <button
          type="button"
          className={clsx(styles.ghost, styles.small)}
          onClick={() => setOnlySymbol(false)}
        >
          全部股票
        </button>
        <button
          type="button"
          className={clsx(styles.ghost, styles.small)}
          onClick={reload}
        >
          重新整理
        </button>
      </div>
      {body}
    </Card>
  );
}
