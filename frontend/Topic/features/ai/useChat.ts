import { useCallback, useEffect, useRef, useState } from 'react';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { appendCompletedChatTurn, ragAskStream, type RagHistoryMessage } from '@/lib/api/ragAsk';
import type { ChatAction, ChatMessage, ChatSource } from '@/lib/types/chat';
import type { ChatDashboard } from '@/lib/types/chatDashboard';

const newId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * AI 對話的送出流程：
 * 送新訊息會中止上一個請求，離開頁面也中止；文字以 rAF 批次更新；
 * 資料面板一到就先顯示；只有收到 done 的回合才加入 history。
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const completedHistory = useRef<RagHistoryMessage[]>([]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const history = completedHistory.current;
    const assistantId = newId();
    const now = new Date().toISOString();
    const update = (patch: (m: ChatMessage) => Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch(m) } : m)));

    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', content: text, timestamp: now },
      { id: assistantId, role: 'assistant', content: '', timestamp: now },
    ]);
    setLoading(true);
    setStreamingMessageId(assistantId);

    let answer = '';
    let actions: ChatAction[] = [];
    let dashboard: ChatDashboard | undefined;
    let sources: ChatSource[] = [];
    try {
      let completed = false;
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
        update((m) => ({ content: textChunk ? m.content + textChunk : m.content, streamStatus: status ?? m.streamStatus }));
      };
      const schedule = () => {
        if (frame === null) frame = window.requestAnimationFrame(flush);
      };
      try {
        const result = await ragAskStream(
          { query: text, history },
          {
            onStatus: (status) => {
              if (ctrl.signal.aborted) return;
              pendingStatus = status;
              schedule();
            },
            onText: (chunk) => {
              if (ctrl.signal.aborted) return;
              answer += chunk;
              pendingText += chunk;
              schedule();
            },
            onDashboard: (result) => {
              if (ctrl.signal.aborted) return;
              dashboard = result.dashboard;
              actions = result.actions;
              update(() => ({ dashboard, actions }));
            },
            onDone: (result) => {
              if (ctrl.signal.aborted) return;
              actions = result.actions;
              dashboard = result.dashboard ?? dashboard;
              sources = result.sources ?? [];
            },
          },
          { signal: ctrl.signal },
        );
        completed = result.completed;
        if (frame !== null) {
          window.cancelAnimationFrame(frame);
          flush();
        }
      } finally {
        if (frame !== null) window.cancelAnimationFrame(frame);
        // 只清掉自己的串流標記；使用者若已送出下一則，標記已經換成新的 id
        setStreamingMessageId((prev) => (prev === assistantId ? null : prev));
      }

      if (ctrl.signal.aborted) return;
      if (completed) completedHistory.current = appendCompletedChatTurn(history, text, answer);
      update(() => ({ content: answer.trim() ? answer : '（無回覆內容）', streamStatus: undefined, actions, dashboard, sources }));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // 後端串流的 error 訊息多半是英文（例如 Model failed），只顯示中文訊息（決議 D13）
      const message = userFacingMessage(err, '請稍後再試。');
      update((m) => ({
        content: m.dashboard ? `資料已顯示，文字解讀暫時無法取得：${message}` : `抱歉，無法取得回覆：${message}`,
        streamStatus: undefined,
      }));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  return { messages, loading, streamingMessageId, send };
}
