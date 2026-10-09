import { useCallback, useEffect, useRef, useState } from 'react';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { appendCompletedChatTurn, ragAskStream, type RagHistoryMessage } from '@/lib/api/ragAsk';
import { AUTH_CHANGE_EVENT, getStoredUser, getToken, isAuthSessionBoundary } from '@/lib/auth/storage';
import { toast } from 'sonner';
import { createConversation, getConversation, listConversations, type ConversationSummary } from '@/lib/api/conversations';
import { rateChatMessage } from '@/lib/api/aiEffectiveness';
import type { ChatAction, ChatMessage, ChatSource } from '@/lib/types/chat';
import type { ChatDashboard } from '@/lib/types/chatDashboard';

const newId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function sessionOwner(): string | null {
  try {
    if (!getToken()) return 'guest';
    const id = getStoredUser()?.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? `user:${id}` : null;
  } catch { return null; }
}

/** Conversation content is persisted by the authenticated backend stream. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const listRequest = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);
  const [stopNotice, setStopNotice] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const ownerRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<{ ctrl: AbortController; finish: () => void } | null>(null);
  const completedHistory = useRef<RagHistoryMessage[]>([]);

  const changeMessages = useCallback((next: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next;
    setMessages(messagesRef.current);
  }, []);

  const interrupt = useCallback(() => {
    activeRef.current?.finish();
    activeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStreamingMessageId(null);
  }, []);

  const clear = useCallback(() => {
    activeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;

    conversationRef.current = null;
    setConversationId(null);
    messagesRef.current = [];
    completedHistory.current = [];
    setMessages([]);
    setLoading(false);
    setStreamingMessageId(null);
    setStopNotice(false);
    setNotice(null);
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    interrupt();
    setStopNotice(true);
    if (conversationRef.current) setRevision((value) => value + 1);
  }, [interrupt]);

  const resetAccount = useCallback(() => {
    clear();
    listRequest.current?.abort();
    listRequest.current = null;
    ownerRef.current = sessionOwner();
    setConversations([]);
    setSearch('');
    setHasMore(false);
    setHistoryLoading(false);
    setHistoryError(null);
    setSignedIn(Boolean(ownerRef.current && ownerRef.current !== 'guest'));
    setRevision((value) => value + 1);
  }, [clear]);

  useEffect(() => {
    resetAccount();
    readyRef.current = true;
    setReady(true);
    const onAuthChange = (event: Event) => {
      if ((event as CustomEvent<{ logout?: boolean }>).detail?.logout || sessionOwner() !== ownerRef.current) resetAccount();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (isAuthSessionBoundary(event) || sessionOwner() !== ownerRef.current)) resetAccount();
    };
    const onPageHide = () => {
      interrupt();
      if (ownerRef.current === 'guest') clear();
    };
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onAuthChange);
    return () => {
      interrupt();
      listRequest.current?.abort();
      readyRef.current = false;
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onAuthChange);
    };
  }, [resetAccount, interrupt, clear]);

  const fetchHistory = useCallback(async (offset = 0) => {
    listRequest.current?.abort();
    if (!signedIn || !ownerRef.current || ownerRef.current === 'guest' || sessionOwner() !== ownerRef.current) return;
    const ctrl = new AbortController();
    const owner = ownerRef.current;
    const current = () => !ctrl.signal.aborted && listRequest.current === ctrl && sessionOwner() === owner;
    listRequest.current = ctrl;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await listConversations(search.trim(), offset, ctrl.signal);
      if (!current()) return;
      setConversations((previous) => offset ? [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))] : page.items);
      setHasMore(page.has_more);
    } catch (error) {
      if (current()) setHistoryError(userFacingMessage(error, '無法載入歷史對話，請重試。'));
    } finally {
      if (current()) setHistoryLoading(false);
    }
  }, [search, signedIn]);

  useEffect(() => {
    setConversations([]);
    setHasMore(false);
    setHistoryLoading(signedIn);
    const timer = window.setTimeout(() => { void fetchHistory(); }, 250);
    return () => { window.clearTimeout(timer); listRequest.current?.abort(); };
  }, [fetchHistory, revision, signedIn]);

  const newConversation = useCallback(() => {
    if (sessionOwner() !== ownerRef.current) { resetAccount(); return; }
    interrupt();
    clear();
    setRevision((value) => value + 1);
  }, [interrupt, clear, resetAccount]);

  const openConversation = useCallback(async (id: string) => {
    if (sessionOwner() !== ownerRef.current) { resetAccount(); return; }
    if (!ownerRef.current || ownerRef.current === 'guest') return;
    interrupt();
    const ctrl = new AbortController();
    const owner = ownerRef.current;
    const current = () => !ctrl.signal.aborted && abortRef.current === ctrl && sessionOwner() === owner;
    abortRef.current = ctrl;
    setLoading(true);
    setNotice(null);
    try {
      const selected = await getConversation(id, ctrl.signal);
      if (!current()) return;
      conversationRef.current = selected.id;
      setConversationId(selected.id);
      changeMessages(selected.messages);
      completedHistory.current = [];
      setStopNotice(false);
    } catch (error) {
      if (current()) setNotice(userFacingMessage(error, '無法開啟對話，請重試。'));
    } finally {
      if (current()) setLoading(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [interrupt, resetAccount, changeMessages]);

  /**
   * 串流的 done 事件不帶訊息 id：回合結束後重讀一次對話，把後端 id 補到剛完成的回覆上，才能送回饋。
   * 讀不到就不顯示回饋鈕；這段期間又開始新回合（最後一則還在串流）也不補。
   */
  const attachServerId = useCallback(async (conversation: string, localId: string) => {
    try {
      const saved = await getConversation(conversation);
      if (conversationRef.current !== conversation) return;
      const last = [...saved.messages].reverse().find((message) => message.role === 'assistant');
      if (!last?.serverId || last.status !== 'completed') return;
      changeMessages((messages) => messages.map((message) => message.id === localId
        ? { ...message, serverId: last.serverId, feedback: last.feedback ?? null } : message));
    } catch {
      // 回饋是附加功能：讀取失敗不打擾對話
    }
  }, [changeMessages]);

  const send = useCallback(async (text: string) => {
    if (!readyRef.current || abortRef.current) return;
    if (sessionOwner() !== ownerRef.current) { resetAccount(); return; }
    if (!ownerRef.current) { setNotice('登入狀態確認失敗，請重新登入。'); return; }
    text = text.trim();
    if (!text) return;
    interrupt();
    setStopNotice(false);
    setNotice(null);
    const ctrl = new AbortController();
    const owner = ownerRef.current;
    const current = () => !ctrl.signal.aborted && abortRef.current === ctrl && sessionOwner() === owner;
    abortRef.current = ctrl;
    setLoading(true);
    let selectedId = conversationRef.current;
    if (ownerRef.current && ownerRef.current !== 'guest' && !selectedId) {
      try {
        const created = await createConversation(ctrl.signal);
        if (!current()) return;
        selectedId = created.id;
        conversationRef.current = created.id;
        setConversationId(created.id);
      } catch (error) {
        if (current()) {
          setNotice(userFacingMessage(error, '無法建立對話，請重試。'));
          setLoading(false);
        }
        if (abortRef.current === ctrl) abortRef.current = null;
        return;
      }
    }
    const history = selectedId ? [] : completedHistory.current;
    const assistantId = newId();
    const now = new Date().toISOString();
    const update = (patch: (message: ChatMessage) => Partial<ChatMessage>) => {
      if (current()) changeMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, ...patch(message) } : message));
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
    setLoading(true);
    setStreamingMessageId(assistantId);

    let frame: number | null = null;
    let pendingText = '';
    let pendingStatus: string | undefined;
    const flush = () => {
      frame = null;
      if (!current() || (!pendingText && pendingStatus === undefined)) return;
      const textChunk = pendingText;
      const status = pendingStatus;
      pendingText = '';
      pendingStatus = undefined;
      update((message) => ({ content: textChunk ? message.content + textChunk : message.content, streamStatus: status ?? message.streamStatus }));
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(flush); };
    try {
      const result = await ragAskStream({ query: text, history }, {
        onStatus: (status) => { if (current()) { pendingStatus = status; schedule(); } },
        onText: (chunk) => { if (current()) { answer += chunk; pendingText += chunk; schedule(); } },
        onDashboard: (result) => {
          if (!current()) return;
          dashboard = result.dashboard;
          actions = result.actions;
          update(() => ({ dashboard, actions }));
        },
        onDone: (result) => {
          if (!current()) return;
          completed = true;
          actions = result.actions;
          dashboard = result.dashboard ?? dashboard;
          sources = result.sources ?? [];
          if (frame !== null) window.cancelAnimationFrame(frame);
          frame = null;
          pendingText = '';
          pendingStatus = undefined;
          if (!selectedId) completedHistory.current = appendCompletedChatTurn(history, text, answer);
          update(() => ({ content: answer, streamStatus: undefined, status: 'completed', actions, dashboard, sources }));
        },
      }, { signal: ctrl.signal, conversationId: selectedId ?? undefined });
      if (frame !== null) { window.cancelAnimationFrame(frame); flush(); }
      if (!current()) return;
      update(() => ({ content: answer.trim() ? answer : '（無回覆內容）', streamStatus: undefined,
        status: result.completed ? 'completed' : 'interrupted', actions, dashboard, sources }));
      if (selectedId && result.completed) void attachServerId(selectedId, assistantId);
    } catch (error) {
      if (!current()) return;
      const message = userFacingMessage(error, '請稍後再試。');
      update((previous) => ({ content: answer.trim() ? answer : previous.dashboard
        ? `資料已顯示，文字解讀暫時無法取得：${message}` : `抱歉，無法取得回覆：${message}`,
        streamStatus: undefined, status: 'failed', error: message, actions, dashboard, sources }));
    } finally {
      if (frame !== null) window.cancelAnimationFrame(frame);
      const wasCurrent = current();
      if (activeRef.current?.ctrl === ctrl) activeRef.current = null;
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreamingMessageId((previous) => previous === assistantId ? null : previous);
      if (wasCurrent) {
        setLoading(false);
        if (selectedId) setRevision((value) => value + 1);
      }
    }
  }, [changeMessages, resetAccount, interrupt, attachServerId]);

  /** 有幫助／沒幫助；再按一次同一顆取消。先更新畫面，送不出去再還原 */
  const rate = useCallback(async (messageId: string, rating: 'up' | 'down' | null) => {
    const conversation = conversationRef.current;
    const target = messagesRef.current.find((message) => message.id === messageId);
    if (!conversation || !target?.serverId) return;
    const previous = target.feedback ?? null;
    const patch = (feedback: 'up' | 'down' | null) => changeMessages((messages) =>
      messages.map((message) => message.id === messageId ? { ...message, feedback } : message));
    patch(rating);
    try {
      await rateChatMessage(conversation, target.serverId, rating);
    } catch (error) {
      if (conversationRef.current === conversation) patch(previous);
      toast.error(userFacingMessage(error, '回饋沒有送出，請稍後再試。'));
    }
  }, [changeMessages]);

  return { messages, rate, loading, ready, notice, stopNotice, streamingMessageId, signedIn,
    conversations, conversationId, search, setSearch, historyLoading, historyError, hasMore,
    refreshHistory: () => setRevision((value) => value + 1),
    loadMore: () => fetchHistory(conversations.length), send, newConversation, openConversation, stop };
}
