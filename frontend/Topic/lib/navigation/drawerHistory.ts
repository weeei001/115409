import { useCallback, useEffect, useRef } from 'react';
import Router from 'next/router';

/**
 * 抽屜與瀏覽紀錄（P2-054、03-F3）：抽屜打開時多推一筆同網址的紀錄，按「上一頁」（含 Android 返回鍵）只關抽屜，不離開頁面。
 *
 * - 推的那一筆複製目前的 history.state（含 Next 的 __N、key），只多一個標記；捲動還原（useScrollRestoration）讀到的 key 不變。
 * - 用介面關抽屜（關閉鈕、Esc、點背景）時自己 history.back()，把那一筆退掉，紀錄不會越關越多。
 * - 退回同網址時 Next 會當成換頁並捲回頂端：用 beforePopState 擋下（抽屜開著、或退出標記紀錄且網址沒變）。
 * - popstate 的處理延到下一個 task：Next 自己的 popstate 監聽一定先看到「抽屜還開著」。
 */

const MARKER = '__teiDrawer';

export interface DrawerHistoryDeps {
  getState: () => unknown;
  pushState: (state: unknown) => void;
  back: () => void;
  onPopState: (listener: () => void) => void;
  setBeforePopState: (cb: (state: { as?: string }) => boolean) => void;
  getAsPath: () => string;
  defer: (fn: () => void) => void;
}

interface Entry {
  token: string;
  /** 使用者按上一頁時要做的事（關抽屜） */
  onPopClose: () => void;
  /** 由介面關閉：等這次自己觸發的 back() 回來後要做的事；undefined＝不是介面關閉 */
  afterBack?: () => void;
  closingByUi: boolean;
}

const hasMarker = (state: unknown): boolean =>
  Boolean(state && typeof state === 'object' && MARKER in (state as Record<string, unknown>));

export function createDrawerHistory(deps: DrawerHistoryDeps) {
  const stack: Entry[] = [];
  let seq = 0;
  /** 目前所在的紀錄是不是抽屜推的那一筆（往前一頁回到舊的標記紀錄也算） */
  let onMarker = false;

  deps.setBeforePopState((state) => {
    if (stack.length > 0) return false;
    // 從標記紀錄退回、或往前走進舊的標記紀錄：網址沒變，不讓 Next 重新換頁、捲回頂端
    if ((onMarker || hasMarker(state)) && state.as === deps.getAsPath()) return false;
    return true;
  });

  deps.onPopState(() => {
    deps.defer(() => {
      onMarker = hasMarker(deps.getState());
      const top = stack.pop();
      if (!top) return;
      if (top.closingByUi) {
        const after = top.afterBack;
        top.afterBack = undefined;
        after?.();
        return;
      }
      top.onPopClose();
    });
  });

  return {
    /** 抽屜打開：推一筆標記紀錄 */
    open(onPopClose: () => void): Entry {
      seq += 1;
      const entry: Entry = { token: `d${seq}`, onPopClose, closingByUi: false };
      const current = deps.getState();
      const base = current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
      deps.pushState({ ...base, [MARKER]: entry.token });
      onMarker = true;
      stack.push(entry);
      return entry;
    },
    /**
     * 由介面關閉：還在標記紀錄上就退一筆，退完再執行 after（例如換頁、改網址）；
     * 標記紀錄已經不在（例如已經按過上一頁）就直接執行 after。
     */
    close(entry: Entry, after?: () => void) {
      if (!stack.includes(entry) || entry.closingByUi) {
        if (!entry.closingByUi) after?.();
        else if (after) {
          const previous = entry.afterBack;
          entry.afterBack = () => {
            previous?.();
            after();
          };
        }
        return;
      }
      entry.closingByUi = true;
      entry.afterBack = after;
      deps.back();
    },
    /** 元件卸載（例如抽屜裡的連結換到別頁）：不再退紀錄，只是不再追蹤 */
    forget(entry: Entry) {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    },
    isOpen(entry: Entry) {
      return stack.includes(entry);
    },
  };
}

type DrawerHistory = ReturnType<typeof createDrawerHistory>;
let singleton: DrawerHistory | null = null;

function browserDrawerHistory(): DrawerHistory | null {
  if (typeof window === 'undefined') return null;
  if (!singleton) {
    singleton = createDrawerHistory({
      getState: () => window.history.state,
      pushState: (state) => window.history.pushState(state, '', window.location.href),
      back: () => window.history.back(),
      onPopState: (listener) => window.addEventListener('popstate', listener),
      setBeforePopState: (cb) => Router.beforePopState(cb),
      getAsPath: () => Router.asPath,
      defer: (fn) => window.setTimeout(fn, 0),
    });
  }
  return singleton;
}

/**
 * 抽屜用：`open` 變成 true 時推一筆紀錄；按上一頁時呼叫 onPopClose（把 open 改回 false）。
 * 回傳的 requestClose(after) 給「關掉抽屜後還要換頁或改網址」的情況：先退掉標記紀錄，再執行 after。
 * 直接把 open 改成 false（Esc、點背景）也會自動退掉標記紀錄。
 */
export function useDrawerHistory(open: boolean, onPopClose: () => void): (after?: () => void) => void {
  const entryRef = useRef<ReturnType<DrawerHistory['open']> | null>(null);
  const onPopCloseRef = useRef(onPopClose);
  onPopCloseRef.current = onPopClose;

  useEffect(() => {
    const history = browserDrawerHistory();
    if (!history) return;
    if (open && !entryRef.current) {
      entryRef.current = history.open(() => {
        entryRef.current = null;
        onPopCloseRef.current();
      });
    } else if (!open && entryRef.current) {
      const entry = entryRef.current;
      entryRef.current = null;
      history.close(entry);
    }
  }, [open]);

  useEffect(() => () => {
    const entry = entryRef.current;
    if (entry) browserDrawerHistory()?.forget(entry);
    entryRef.current = null;
  }, []);

  return useCallback((after?: () => void) => {
    const history = browserDrawerHistory();
    const entry = entryRef.current;
    if (!history || !entry) {
      after?.();
      return;
    }
    entryRef.current = null;
    history.close(entry, after);
  }, []);
}
