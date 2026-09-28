import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamSimulateTrading, type SimulateStreamOutcome, type StreamErrorSource } from './api';
import type { SimDayEvent, SimInitEvent, SimMetrics, SimulateParams } from './types';

/** day 事件先累積，最多每 300ms 更新一次畫面，圖表的 setOption 跟著節流 */
const FLUSH_INTERVAL_MS = 300;

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled' | 'incomplete';

export interface RunState {
  status: RunStatus;
  params: SimulateParams | null;
  init: SimInitEvent | null;
  days: SimDayEvent[];
  metrics: SimMetrics | null;
  error: { source: StreamErrorSource; message: string } | null;
  /** 格式不符、已略過的事件數 */
  invalidCount: number;
}

type Action =
  | { type: 'start'; params: SimulateParams }
  | { type: 'init'; init: SimInitEvent }
  | { type: 'days'; days: SimDayEvent[] }
  | { type: 'invalid' }
  | { type: 'finish'; outcome: SimulateStreamOutcome; metrics: SimMetrics | null };

const INITIAL: RunState = { status: 'idle', params: null, init: null, days: [], metrics: null, error: null, invalidCount: 0 };

const FINISHED_STATUS: Record<SimulateStreamOutcome['kind'], RunStatus> = {
  done: 'done',
  error: 'error',
  incomplete: 'incomplete',
  aborted: 'cancelled',
};

function reducer(state: RunState, action: Action): RunState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL, status: 'running', params: action.params };
    case 'init':
      return { ...state, init: action.init };
    case 'days':
      return { ...state, days: [...state.days, ...action.days] };
    case 'invalid':
      return { ...state, invalidCount: state.invalidCount + 1 };
    case 'finish':
      return {
        ...state,
        status: FINISHED_STATUS[action.outcome.kind],
        metrics: action.outcome.kind === 'done' ? action.metrics : null,
        error: action.outcome.kind === 'error' ? { source: action.outcome.source, message: action.outcome.message } : null,
      };
  }
}

export function useSimulateTradingStream(apiBase: string | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  /** 用 ref 擋重複送出：連點兩下時 state 還來不及更新 */
  const runningRef = useRef(false);
  const mountedRef = useRef(false);
  const pendingRef = useRef<SimDayEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pendingRef.current.length || !mountedRef.current) return;
    const days = pendingRef.current;
    pendingRef.current = [];
    dispatch({ type: 'days', days });
  }, []);

  // 卸載時中斷串流（後端可能仍在計算，但畫面不再接收）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const start = useCallback(
    async (params: SimulateParams) => {
      if (!apiBase || runningRef.current) return;
      runningRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      pendingRef.current = [];
      dispatch({ type: 'start', params });

      let metrics: SimMetrics | null = null;
      const outcome = await streamSimulateTrading(
        apiBase,
        params,
        {
          onInit: (init) => {
            if (mountedRef.current) dispatch({ type: 'init', init });
          },
          onDay: (day) => {
            pendingRef.current.push(day);
            if (!timerRef.current && mountedRef.current) timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
          },
          onDone: (result) => {
            metrics = result;
          },
          onInvalid: () => {
            if (mountedRef.current) dispatch({ type: 'invalid' });
          },
        },
        controller.signal,
      );

      if (controllerRef.current === controller) controllerRef.current = null;
      runningRef.current = false;
      if (!mountedRef.current) return;
      flush();
      dispatch({ type: 'finish', outcome, metrics });
    },
    [apiBase, flush],
  );

  /** 只中斷畫面接收；後端可能仍在計算 */
  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { state, start, cancel };
}
