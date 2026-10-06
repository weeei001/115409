/**
 * 上一頁、下一頁還原捲動位置（03-F5／P1-14）。
 *
 * 只開 Next 的 experimental.scrollRestoration 沒有用：
 * - AppShell 換頁是 AnimatePresence mode="wait"，位置會先套在淡出中的舊頁，換頁後被截斷；
 * - 每一頁都在用戶端載入資料，回到頁面時還是骨架，高度不夠。
 * 所以自己記：以 history.state.key（Next 每一筆瀏覽紀錄的 key）記住離開時的 scrollY，
 * 回到那一筆時等舊頁淡出、新頁高度夠了而且穩定，才捲回去；逾時或使用者自己捲動就放棄。
 */

/** 等頁面長到夠高的上限；超過就放棄，停在頁首 */
export const RESTORE_TIMEOUT_MS = 5000;
/** 高度連續這麼久沒變才捲：資料陸續到達時，太早捲會被上方長出來的內容推走 */
export const RESTORE_STABLE_MS = 150;
/** 只記最近這麼多筆，避免一直開新頁時無限增加 */
const MEMORY_LIMIT = 50;

/** 自己管捲動位置的頁面：AI 對話會捲到最新一輪提問（pages/ai.tsx） */
const SELF_MANAGED_PATHS = new Set(['/ai']);

/** 這一筆瀏覽紀錄要不要還原：網址帶 #錨點時由頁面自己捲到錨點（例如新聞的 #analysis） */
export function shouldRestoreScroll(asPath: string): boolean {
  const [path] = asPath.split(/[?#]/);
  return !asPath.includes('#') && !SELF_MANAGED_PATHS.has(path || '/');
}

/**
 * routeChangeStart 時判斷這次是不是上一頁／下一頁：
 * push 時 Next 要到 routeChangeStart 之後才 pushState，history.state 還是目前這一頁；
 * 上一頁、下一頁時瀏覽器已經換成目的地那一筆，key 不同。replace（含 shallow）沿用同一個 key。
 */
export function isHistoryTraversal(currentKey: string, stateKey: string): boolean {
  return Boolean(currentKey && stateKey && currentKey !== stateKey);
}

/** 以瀏覽紀錄 key 記住的捲動位置（只存在這個分頁的記憶體裡） */
export class ScrollMemory {
  private positions = new Map<string, number>();

  set(key: string, y: number) {
    if (!key || !Number.isFinite(y)) return;
    this.positions.delete(key);
    this.positions.set(key, Math.max(0, Math.round(y)));
    while (this.positions.size > MEMORY_LIMIT) {
      const oldest = this.positions.keys().next().value;
      if (oldest === undefined) break;
      this.positions.delete(oldest);
    }
  }

  get(key: string): number | null {
    return key ? this.positions.get(key) ?? null : null;
  }
}

export interface RestoreEnv {
  /** 目前最多能捲到哪裡（scrollHeight − innerHeight） */
  maxScroll(): number;
  scrollTo(y: number): void;
  now(): number;
  frame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** 使用者自己捲動（滾輪、觸控、鍵盤、按下滑鼠）時呼叫 onInput；回傳取消監聽的函式 */
  onUserInput(onInput: () => void): () => void;
}

export type RestoreResult = 'restored' | 'timeout' | 'user';

/**
 * 每個 frame 檢查一次：可捲範圍到得了 target、而且高度維持 stableMs 沒變，才捲過去。
 * 回傳取消函式（換頁時呼叫）。onDone 在還原、逾時或使用者介入時呼叫一次，取消時不呼叫。
 */
export function restoreWhenReady(
  target: number,
  env: RestoreEnv,
  onDone: (result: RestoreResult) => void,
  { timeoutMs = RESTORE_TIMEOUT_MS, stableMs = RESTORE_STABLE_MS } = {},
): () => void {
  const start = env.now();
  let handle = 0;
  let finished = false;
  let lastMax = Number.NaN;
  let stableSince = start;

  const finish = (result: RestoreResult | null) => {
    if (finished) return;
    finished = true;
    env.cancelFrame(handle);
    stopListening();
    if (result) onDone(result);
  };
  const stopListening = env.onUserInput(() => finish('user'));

  const tick = () => {
    if (finished) return;
    const now = env.now();
    const max = env.maxScroll();
    if (max !== lastMax) {
      lastMax = max;
      stableSince = now;
    }
    if (max >= target && now - stableSince >= stableMs) {
      env.scrollTo(target);
      finish('restored');
      return;
    }
    if (now - start >= timeoutMs) {
      finish('timeout');
      return;
    }
    handle = env.frame(tick);
  };
  handle = env.frame(tick);
  return () => finish(null);
}

/** 瀏覽器環境：使用者輸入用 capture 監聽，頁面內部的元件攔掉事件也聽得到 */
export function browserRestoreEnv(): RestoreEnv {
  return {
    maxScroll: () => document.documentElement.scrollHeight - window.innerHeight,
    scrollTo: (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }),
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    onUserInput: (onInput) => {
      const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
      events.forEach((name) => window.addEventListener(name, onInput, { capture: true, passive: true }));
      return () => events.forEach((name) => window.removeEventListener(name, onInput, { capture: true }));
    },
  };
}
