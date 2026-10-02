import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSimulateUrl, streamSimulateTrading, type SimulateStreamOutcome } from './api';
import type { SimDayEvent, SimInitEvent, SimMetrics, SimulateParams } from './types';

const FIXTURE = readFileSync(new URL('./fixtures/sse-2330-20260827-20260902.txt', import.meta.url), 'utf8');
/** 同一組參數第二次呼叫（命中快取）的原始回應：init 沒有 type、多了 cached */
const CACHED_FIXTURE = readFileSync(new URL('./fixtures/sse-2330-20260827-20260902-cached.txt', import.meta.url), 'utf8');
const BASE = 'https://demo.example/rag';
const PARAMS: SimulateParams = { symbol: '2330', start: '2026-08-27', end: '2026-09-02', initialCash: 1_000_000, confidence: 5 };
const encoder = new TextEncoder();

/** 參數順序與實測相同，才會和當時的呼叫命中同一份快取 */
assert.equal(
  buildSimulateUrl(BASE, PARAMS),
  `${BASE}/api/simulate_trading_stream?symbol=2330&start=2026-08-27&end=2026-09-02&initial_cash=1000000&confidence=5`,
);

/** 把位元組每 n 個切一段（會把中文字的 UTF-8 切成兩半） */
function byteChunks(text: string, n: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += n) out.push(bytes.slice(i, i + n));
  return out;
}

interface MockStream {
  cancelled: boolean;
  requestedUrl: string | null;
}

/**
 * 假的 fetch：依序送出 chunks；close=false 時送完後保持開著（模擬後端還在算），
 * 呼叫端若沒有在 done／error 後主動停止，讀取會一直等下去。
 */
function mockFetch(chunks: Uint8Array[], options: { close?: boolean; status?: number; body?: string } = {}): MockStream {
  const state: MockStream = { cancelled: false, requestedUrl: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    state.requestedUrl = String(input);
    assert.equal(init?.method, 'GET');
    if (options.status && options.status >= 400) {
      return new Response(options.body ?? '', { status: options.status, headers: { 'content-type': 'application/json' } });
    }
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else if (options.close !== false) controller.close();
        else return new Promise<void>(() => undefined);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }) as typeof fetch;
  return state;
}

interface Collected {
  inits: SimInitEvent[];
  days: SimDayEvent[];
  metrics: SimMetrics[];
  invalid: number;
}

async function run(signal?: AbortSignal, onDay?: (day: SimDayEvent) => void): Promise<{ outcome: SimulateStreamOutcome; got: Collected }> {
  const got: Collected = { inits: [], days: [], metrics: [], invalid: 0 };
  const pending = streamSimulateTrading(
    BASE,
    PARAMS,
    {
      onInit: (event) => got.inits.push(event),
      onDay: (event) => {
        got.days.push(event);
        onDay?.(event);
      },
      onDone: (metrics) => got.metrics.push(metrics),
      onInvalid: () => got.invalid++,
    },
    signal,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('串流沒有在預期時間內結束（done／error 後沒有停止讀取？）')), 2000);
  });
  try {
    return { outcome: await Promise.race([pending, timeout]), got };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // 1. 實測回應以 7 位元組切段（中文字被切半）：事件、欄位、中文理由都要完整
  {
    const stream = mockFetch(byteChunks(FIXTURE, 7));
    const { outcome, got } = await run();
    assert.deepEqual(outcome, { kind: 'done' });
    assert.equal(stream.requestedUrl, buildSimulateUrl(BASE, PARAMS));
    assert.equal(got.inits.length, 1);
    assert.equal(got.inits[0].n_trading_days, 5);
    assert.equal(got.inits[0].model, 'Gemma4-31B');
    assert.equal(got.inits[0].execution, 'next_open');
    assert.equal(got.inits[0].cached, undefined, '沒命中快取時不帶 cached');
    assert.deepEqual(got.days.map((d) => d.date), ['2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03']);
    assert.equal(got.days[0].action, 'buy');
    assert.equal(got.days[0].decision_date, '2026-08-27');
    assert.ok(got.days[0].reason.startsWith('近期價格趨勢向上且斜率為正'), '中文理由不能因切段而變成亂碼');
    assert.ok(!got.days.some((d) => d.reason.includes('�')));
    assert.equal(got.metrics.length, 1);
    const m = got.metrics[0];
    assert.equal(m.final_portfolio_value, 989212.41);
    assert.equal(m.total_return_pct, -1.08);
    assert.equal(m.max_drawdown_pct, 1.71);
    assert.equal(m.trade_count, 5);
    assert.equal(m.win_rate_pct, null);
    assert.equal(m.annualized_is_extrapolated, true);
    assert.deepEqual(m.baseline_buy_and_hold, { shares: 413, final_value: 986227.12, total_return_pct: -1.38 });
    assert.ok(m.note?.includes('次日開盤成交'));
    assert.equal(got.invalid, 0);
  }

  // 1b. 命中快取的回應：init 沒有 type 也要認得，cached 為 true；day、done 與第一次相同
  {
    assert.ok(!CACHED_FIXTURE.split(/\r?\n\r?\n/)[0].includes('"type"'), 'fixture 應保留實測的缺 type 狀態');
    mockFetch(byteChunks(CACHED_FIXTURE, 11));
    const { outcome, got } = await run();
    assert.deepEqual(outcome, { kind: 'done' });
    assert.equal(got.inits.length, 1);
    assert.equal(got.inits[0].type, 'init');
    assert.equal(got.inits[0].cached, true);
    assert.equal(got.inits[0].n_trading_days, 5);
    assert.equal(got.inits[0].model, 'Gemma4-31B');
    assert.equal(got.days.length, 5);
    assert.equal(got.metrics[0].final_portfolio_value, 989212.41);
    assert.equal(got.invalid, 0);
  }

  // 2. 收到 done 就停止：之後的事件不處理，並主動取消串流（串流保持開著，沒停就會逾時）
  {
    const extraDay = FIXTURE.split('\n\n').find((block) => block.includes('"type": "day"'));
    const stream = mockFetch([encoder.encode(FIXTURE), encoder.encode(`${extraDay}\n\n`)], { close: false });
    const { outcome, got } = await run();
    assert.deepEqual(outcome, { kind: 'done' });
    assert.equal(got.days.length, 5, 'done 之後的 day 不應再處理');
    assert.equal(stream.cancelled, true, 'done 之後要取消串流');
  }

  // 3. 收到 error 就停止：回傳後端訊息，之後的事件不處理
  {
    const blocks = FIXTURE.split(/\r?\n\r?\n/).filter(Boolean);
    const body = [blocks[0], blocks[1], 'data: {"type": "error", "message": "模型逾時"}', blocks[2]].join('\n\n') + '\n\n';
    const stream = mockFetch(byteChunks(body, 5), { close: false });
    const { outcome, got } = await run();
    assert.deepEqual(outcome, { kind: 'error', source: 'event', message: '模型逾時' });
    assert.equal(got.days.length, 1, 'error 之後的 day 不應再處理');
    assert.equal(got.metrics.length, 0);
    assert.equal(stream.cancelled, true, 'error 之後要取消串流');
  }

  // 4. 串流結束但沒有 done：incomplete；格式不符的事件計數、不中斷
  {
    const blocks = FIXTURE.split(/\r?\n\r?\n/).filter(Boolean);
    const body = [blocks[0], 'data: {"type": "day", "date": "2026-08-28"}', 'data: not-json', 'data: {"type": "heartbeat"}', blocks[1]].join('\n\n') + '\n\n';
    mockFetch([encoder.encode(body)]);
    const { outcome, got } = await run();
    assert.deepEqual(outcome, { kind: 'incomplete' });
    assert.equal(got.days.length, 1);
    assert.equal(got.invalid, 2, '缺欄位的 day 與非 JSON 算格式不符；不認得的 type 直接忽略');
  }

  // 5. 非 2xx：實測日期超出範圍為 400 + detail 字串；422 的 detail 是陣列
  {
    mockFetch([], { status: 400, body: '{"detail":"日期需在資料有效範圍內：2023-05-14 ~ 2026-09-03"}' });
    assert.deepEqual((await run()).outcome, { kind: 'error', source: 'http', message: '日期需在資料有效範圍內：2023-05-14 ~ 2026-09-03' });

    mockFetch([], {
      status: 422,
      body: '{"detail":[{"loc":["query","confidence"],"msg":"Input should be less than or equal to 10","type":"less_than_equal"}]}',
    });
    assert.deepEqual((await run()).outcome, { kind: 'error', source: 'http', message: '參數不正確：Input should be less than or equal to 10' });

    mockFetch([], { status: 502, body: '<html>Bad gateway</html>' });
    assert.deepEqual((await run()).outcome, { kind: 'error', source: 'http', message: 'Demo 後端回應錯誤（HTTP 502），請稍後再試。' });
  }

  // 6. 網路錯誤
  {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const { outcome } = await run();
    assert.equal(outcome.kind, 'error');
    assert.equal(outcome.kind === 'error' && outcome.source, 'network');
  }

  // 7. 取消：收到第一個 day 後 abort，回傳 aborted
  {
    mockFetch([encoder.encode(FIXTURE.split(/\r?\n\r?\n/).slice(0, 2).join('\n\n') + '\n\n')], { close: false });
    const controller = new AbortController();
    const { outcome, got } = await run(controller.signal, () => controller.abort());
    assert.deepEqual(outcome, { kind: 'aborted' });
    assert.equal(got.days.length, 1);
  }

  console.log('ai-trade-demo api.test.ts: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
