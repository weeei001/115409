import { useEffect, useSyncExternalStore } from 'react';

/**
 * 頁面告訴小燈「現在在看什麼」（例如新聞頁的標題），面板據此推薦問題。
 * 小燈掛在 AppShell、頁面在它底下，所以用一個模組層級的小 store，不另外包 Provider。
 */
export type AssistantTopic = { kind: 'news'; title: string } | null;

let current: AssistantTopic = null;
const listeners = new Set<() => void>();

function set(topic: AssistantTopic) {
  current = topic;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 頁面呼叫：掛載期間提供主題，離開頁面時清掉 */
export function useProvideAssistantTopic(topic: AssistantTopic) {
  const kind = topic?.kind ?? null;
  const title = topic?.title ?? null;
  useEffect(() => {
    if (!kind || !title) return;
    set({ kind, title });
    return () => set(null);
  }, [kind, title]);
}

/** 小燈讀目前的主題 */
export function useAssistantTopic(): AssistantTopic {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
