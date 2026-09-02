import clsx from 'clsx';
import { FileText } from 'lucide-react';
import Head from 'next/head';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { SubpageHeader } from '../../components/SubpageHeader';
import { API_BASE } from '../../lib/apiBase';
import { BriefPane } from '../../components/demo/textBrief/BriefPane';
import { HistoryPane } from '../../components/demo/textBrief/HistoryPane';
import { NewsPane } from '../../components/demo/textBrief/NewsPane';
import { PayloadPane } from '../../components/demo/textBrief/PayloadPane';
import { STAGES, STATUS, SYMBOLS } from '../../components/demo/textBrief/constants';
import { HighlightProvider } from '../../components/demo/textBrief/highlight';
import { Tag } from '../../components/demo/textBrief/ui';
import { SAMPLE, SAMPLE_PACKET } from '../../lib/demo/textBriefSample';
import type { TextBriefResponse } from '../../lib/demo/textBriefTypes';
import styles from '../../styles/textBriefDemo.module.css';

/**
 * AI 個股分析 DEMO：`POST /analyze/stock-behavior/text-brief`（schema `text-first-v2`）的展示頁。
 *
 * 三個展示重點：
 *   1. 可回溯——點結論亮出它根據的資料，點資料反查引用它的結論，Esc 取消。
 *   2. 關鍵交易日的漲跌幅與量能倍數由後端依 `ref` 回填，模型只挑日期與寫敘述。
 *   3. 右下的系統檢查結果十項全空才是 `verified`。
 *
 * 不接後端也能看：按「載入離線範例」用內嵌的真實回應重畫整頁。
 */

/** 固定吃環境變數，畫面上不再讓人改 */
/** 留空＝不帶 as_of_date，由後端當成今天 */
const DEFAULT_AS_OF = '';

const HTTP_HINT: Record<number, string> = {
  422: '這次的請求沒通過檢查',
  503: 'AI 服務暫時無法回應，可以稍後再試',
  504: '等太久了，這次分析逾時',
};

interface Meta {
  ms?: number;
  offline?: boolean;
  historyId?: number;
}

interface ErrorBox {
  title: string;
  detail?: string;
}

/** AI 寫那一段實測約 90 秒；階段是依實測耗時推估的 UI 提示，不是後端即時回報 */
function stageAt(sec: number): number {
  if (sec < 2) return 0;
  if (sec < 3) return 1;
  if (sec < 92) return 2;
  return 3;
}

function Progress({ seconds }: { seconds: number }) {
  const at = stageAt(seconds);
  return (
    <div className={styles.card}>
      <p>
        <span className={styles.spin} />
        產生中… {seconds} 秒
      </p>
      <p className={styles.hint}>
        AI 撰寫那一段大約要 90 秒，請稍等。下面的階段是依平常的耗時推估的，不是即時回報。
      </p>
      <div className={styles.stages}>
        {STAGES.map((s, i) => (
          <span key={s} className={clsx(i < at && styles.done, i === at && styles.now)}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function Tabs({ items }: { items: { label: string; count?: number | null; pane: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className={styles.tabs}>
        {items.map((it, i) => (
          <button
            key={it.label}
            type="button"
            className={clsx(i === active && styles.on)}
            onClick={() => setActive(i)}
          >
            {it.label}
            {it.count == null ? null : <span className={styles.cnt}>{it.count}</span>}
          </button>
        ))}
      </div>
      {/* 分頁全部保持掛載，切回來時執行紀錄不用重讀 */}
      {items.map((it, i) => (
        <div key={it.label} className={clsx(i !== active && styles.hide)}>
          {it.pane}
        </div>
      ))}
    </div>
  );
}

export default function TextBriefDemoPage() {
  const [symbol, setSymbol] = useState(SYMBOLS[0].value);
  const [asOf, setAsOf] = useState(DEFAULT_AS_OF);
  const [fresh, setFresh] = useState(false);

  const [data, setData] = useState<TextBriefResponse | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  const [error, setError] = useState<ErrorBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  /** 每載入一份新資料就 +1，用來把分頁與執行紀錄重設回初始狀態 */
  const [renderId, setRenderId] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const show = useCallback((next: TextBriefResponse, extra: Meta) => {
    setData(next);
    setMeta(extra);
    setError(null);
    setRenderId((n) => n + 1);
  }, []);

  const run = useCallback(async () => {
    // include_payload 一律帶：後三個分頁沒有 task packet 就沒東西可看
    const body: Record<string, unknown> = {
      symbol,
      force_refresh: fresh,
      include_payload: true,
    };
    if (asOf) body.as_of_date = asOf;

    setBusy(true);
    setData(null);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/analyze/stock-behavior/text-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ms = performance.now() - t0;
      const raw = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        // 非 JSON 回應就原樣顯示前 800 字
      }
      if (!res.ok) {
        const detail =
          json && typeof json === 'object' && 'detail' in json
            ? (json as { detail: unknown }).detail
            : (json ?? raw.slice(0, 800));
        setError({
          title: `HTTP ${res.status}　${HTTP_HINT[res.status] ?? '請求失敗'}`,
          detail: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
        });
        return;
      }
      show(json as TextBriefResponse, { ms });
    } catch (err) {
      setError({
        title: '連不上分析服務',
        detail:
          `${String(err)}\n\n分析服務要先啟動：\n  cd backend\n` +
          '  uvicorn main:app --reload --port 8000\n\n' +
          '只是想看畫面長什麼樣，按上方的「載入範例」就好。',
      });
    } finally {
      setBusy(false);
    }
  }, [symbol, fresh, asOf, show]);

  const openHistory = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(
          `${API_BASE}/analyze/stock-behavior/text-brief/history/${id}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        show((await res.json()) as TextBriefResponse, { historyId: id });
      } catch (err) {
        setError({ title: '載入執行紀錄失敗', detail: String(err) });
      }
    },
    [show],
  );

  const loadSample = useCallback(() => {
    setBusy(false);
    show({ ...SAMPLE, task_packet: SAMPLE_PACKET }, { offline: true });
  }, [show]);

  const packet = data?.task_packet ?? null;
  const [statusTone, statusNote] = data ? STATUS[data.status] ?? ['plain', data.status] : [];

  return (
    <>
      <Head>
        <title>AI 個股分析 DEMO｜股海明燈</title>
        <meta name="robots" content="noindex" />
      </Head>

      <SubpageHeader
        icon={FileText}
        title="AI 個股分析"
        subtitle="每一句話都能點開，看它是根據哪些數字寫的"
      />

      <main
        className={clsx(
          'flex min-h-0 flex-1 flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6',
          styles.page,
        )}
      >
        <div className={styles.bar}>
          <div className={styles.f}>
            <label htmlFor="sym">股票</label>
            <select id="sym" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {SYMBOLS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.f}>
            <label htmlFor="asof">分析到哪一天（留空＝今天）</label>
            <input
              id="asof"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </div>
          <div className={clsx(styles.f, styles.chk)}>
            <input
              id="fresh"
              type="checkbox"
              checked={fresh}
              onChange={(e) => setFresh(e.target.checked)}
            />
            <label htmlFor="fresh">不用之前的結果，重新產生</label>
          </div>
          <button type="button" onClick={run} disabled={busy}>
            開始分析
          </button>
          <button type="button" className={styles.ghost} onClick={loadSample}>
            載入範例
          </button>
        </div>

        <div className={styles.meta}>
          {data ? (
            <>
              <Tag tone={statusTone}>
                {data.status}　{statusNote}
              </Tag>
              <Tag>
                {data.symbol}　分析到 {data.as_of_date}
              </Tag>
              <Tag>使用模型 {data.generated_by}</Tag>
              {data.cached ? <Tag tone="info">沿用之前的結果</Tag> : null}
              {meta.ms != null ? <Tag>花了 {(meta.ms / 1000).toFixed(1)} 秒</Tag> : null}
              {meta.offline ? <Tag tone="info">範例資料</Tag> : null}
              {meta.historyId != null ? <Tag tone="info">執行紀錄 #{meta.historyId}</Tag> : null}
            </>
          ) : null}
        </div>

        {busy ? <Progress seconds={seconds} /> : null}
        {error ? (
          <div className={styles.err}>
            <strong>{error.title}</strong>
            {error.detail ? <code>{error.detail}</code> : null}
          </div>
        ) : null}

        {data ? (
          <HighlightProvider brief={data.brief}>
            <Tabs
              key={renderId}
              items={[
                { label: '分析結果', pane: <BriefPane data={data} /> },
                {
                  label: '用到的新聞',
                  count: packet ? (packet.news ?? []).length : null,
                  pane: <NewsPane data={data} packet={packet} />,
                },
                {
                  label: '給 AI 看的資料',
                  count: packet ? (packet.daily_timeline ?? []).length : null,
                  pane: <PayloadPane packet={packet} />,
                },
                {
                  label: '歷次執行紀錄',
                  pane: (
                    <HistoryPane
                      apiBase={API_BASE}
                      symbol={data.symbol}
                      currentId={meta.historyId ?? null}
                      onOpen={openHistory}
                    />
                  ),
                },
              ]}
            />
          </HighlightProvider>
        ) : null}
      </main>
    </>
  );
}
