import { useCallback, useEffect, useRef, useState } from 'react';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { appendCompletedChatTurn, ragAskStream, type RagHistoryMessage } from '@/lib/api/ragAsk';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken, isAuthSessionBoundary } from '@/lib/auth/storage';
import { clearChatSession, loadChatSession, saveChatSession } from '@/lib/chat/session';
import type { ChatAction, ChatMessage, ChatSource } from '@/lib/types/chat';
import type { ChatDashboard } from '@/lib/types/chatDashboard';

const newId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const cacheUnavailable = '本分頁無法暫存對話；離頁後可能無法復原。';

function sessionOwner(): string | null {
  try {
    if (!getToken()) return 'guest';
    const id = getStoredUser()?.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? `user:${id}` : null;
  } catch { return null; }
}

function restoredHistory(messages: ChatMessage[]): RagHistoryMessage[] {
  let history: RagHistoryMessage[] = [];
  for (let i = 1; i < messages.length; i++) {
    const user = messages[i - 1];
    const assistant = messages[i];
    if (user.role === 'user' && assistant.role === 'assistant' && assistant.status === 'completed') {
      history = appendCompletedChatTurn(history, user.content, assistant.content);
    }
  }
  return history;
}

/** Same-tab snapshots preserve completed turns; unfinished turns never replay. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const ownerRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<{ ctrl: AbortController; finish: () => void } | null>(null);
  const completedHistory = useRef<RagHistoryMessage[]>([]);

  const persistNow = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!readyRef.current || !ownerRef.current || sessionOwner() !== ownerRef.current) return;
    const result = saveChatSession(ownerRef.current, messagesRef.current);
    setCacheNotice(!result.saved ? cacheUnavailable : result.trimmed ? '對話較長，重新載入時只會保留最近幾輪。' : null);
  }, []);

  const changeMessages = useCallback((next: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next;
    setMessages(messagesRef.current);
    // Avoid serializing a large source snapshot for every streamed token.
    if (readyRef.current && saveTimer.current === null) saveTimer.current = window.setTimeout(persistNow, 250);
  }, [persistNow]);

  const interrupt = useCallback(() => {
    activeRef.current?.finish();
    activeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStreamingMessageId(null);
    persistNow();
  }, [persistNow]);

  const clear = useCallback(() => {
    activeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    ownerRef.current = sessionOwner();
    messagesRef.current = [];
    completedHistory.current = [];
    setMessages([]);
    setLoading(false);
    setStreamingMessageId(null);
    setCacheNotice(ownerRef.current === null ? cacheUnavailable : null);
    clearChatSession();
  }, []);

  useEffect(() => {
    ownerRef.current = sessionOwner();
    if (ownerRef.current === null) clearChatSession();
    const restored = ownerRef.current === null ? { messages: [], available: false } : loadChatSession(ownerRef.current);
    messagesRef.current = restored.messages;
    completedHistory.current = restoredHistory(restored.messages);
    setMessages(restored.messages);
    readyRef.current = true;
    setReady(true);
    if (!restored.available) setCacheNotice(cacheUnavailable);
    if (restored.messages.length) persistNow();
    const onAuthChange = (event: Event) => {
      if ((event as CustomEvent<{ logout?: boolean }>).detail?.logout || sessionOwner() !== ownerRef.current) clear();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (isAuthSessionBoundary(event) || sessionOwner() !== ownerRef.current)) clear();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', interrupt);
    return () => {
      interrupt();
      readyRef.current = false;
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', interrupt);
    };
  }, [clear, interrupt, persistNow]);

  const send = useCallback(async (text: string) => {
    if (!readyRef.current) return;
    if (sessionOwner() !== ownerRef.current) clear();
    interrupt();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const history = completedHistory.current;
    const assistantId = newId();
    const now = new Date().toISOString();
    const update = (patch: (message: ChatMessage) => Partial<ChatMessage>) => {
      if (!ctrl.signal.aborted) changeMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, ...patch(message) } : message));
    };
    let answer = '';
    let actions: ChatAction[] = [];
    let dashboard: ChatDashboard | undefined;
    let sources: ChatSource[] = [];
    let completed = false;
    activeRef.current = { ctrl, finish: () => update(() => ({
      content: answer, actions, dashboard, sources, streamStatus: undefined, status: completed ? 'completed' : 'interrupted',
    })) };
    changeMessages((previous) => [...previous,
      { id: newId(), role: 'user', content: text, timestamp: now },
      { id: assistantId, role: 'assistant', content: '', timestamp: now, status: 'streaming' },
    ]);
    persistNow();
    setLoading(true);
    setStreamingMessageId(assistantId);

    let frame: number | null = null;
    let pendingText = '';
    let pendingStatus: string | undefined;
    const flush = () => {
      frame = null;
      if (ctrl.signal.aborted || (!pendingText && pendingStatus === undefined)) return;
      const textChunk = pendingText;
      const status = pendingStatus;
      pendingText = '';
      pendingStatus = undefined;
      update((message) => ({ content: textChunk ? message.content + textChunk : message.content, streamStatus: status ?? message.streamStatus }));
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(flush); };
    try {
      const result = await ragAskStream({ query: text, history }, {
        onStatus: (status) => { if (!ctrl.signal.aborted) { pendingStatus = status; schedule(); } },
        onText: (chunk) => { if (!ctrl.signal.aborted) { answer += chunk; pendingText += chunk; schedule(); } },
        onDashboard: (result) => {
          if (ctrl.signal.aborted) return;
          dashboard = result.dashboard;
          actions = result.actions;
          update(() => ({ dashboard, actions }));
        },
        onDone: (result) => {
          if (ctrl.signal.aborted) return;
          completed = true;
          actions = result.actions;
          dashboard = result.dashboard ?? dashboard;
          sources = result.sources ?? [];
          if (frame !== null) window.cancelAnimationFrame(frame);
          frame = null;
          pendingText = '';
          pendingStatus = undefined;
          completedHistory.current = appendCompletedChatTurn(history, text, answer);
          update(() => ({ content: answer, streamStatus: undefined, status: 'completed', actions, dashboard, sources }));
          persistNow();
        },
      }, { signal: ctrl.signal });
      if (frame !== null) { window.cancelAnimationFrame(frame); flush(); }
      if (ctrl.signal.aborted) return;
      update(() => ({ content: answer.trim() ? answer : '（無回覆內容）', streamStatus: undefined,
        status: result.completed ? 'completed' : 'interrupted', actions, dashboard, sources }));
      persistNow();
    } catch (error) {
      if (ctrl.signal.aborted) return;
      const message = userFacingMessage(error, '請稍後再試。');
      update((previous) => ({ content: answer.trim() ? answer : previous.dashboard
        ? `資料已顯示，文字解讀暫時無法取得：${message}` : `抱歉，無法取得回覆：${message}`,
        streamStatus: undefined, status: 'failed', error: message, actions, dashboard, sources }));
      persistNow();
    } finally {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (activeRef.current?.ctrl === ctrl) activeRef.current = null;
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreamingMessageId((previous) => previous === assistantId ? null : previous);
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [changeMessages, clear, interrupt, persistNow]);

  return { messages, loading, ready, cacheNotice, streamingMessageId, send, clear };
}
