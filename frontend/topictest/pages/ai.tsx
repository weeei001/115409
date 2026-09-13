import React, { useState, useCallback, useRef, useEffect } from 'react';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { appendCompletedChatTurn, ragAskStream, type RagHistoryMessage } from '../lib/api/ragAsk';
import { ApiRequestError } from '../lib/api/client';
import type { ChatAction, ChatMessage } from '../lib/types';
import type { ChatDashboard } from '../lib/types/chatDashboard';

const AI_EXAMPLE_QUESTIONS = [
  '整理台積電的走勢、法人與營收重點',
  '比較台積電、聯發科與鴻海的報酬和風險',
  '用 KD 和量價分析台積電目前的走勢',
  '最近有哪些影響台股的新聞？',
  '這個系統可以幫我做什麼？',
];

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AiPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const completedHistory = useRef<RagHistoryMessage[]>([]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const history = completedHistory.current;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      let streamingAssistantId: string | undefined;

      try {
        const assistantId = generateId();
        streamingAssistantId = assistantId;
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingMessageId(assistantId);

        let answer = '';
        let actions: ChatAction[] = [];
        let dashboard: ChatDashboard | undefined;
        let completed = false;
        let flushFrame: number | null = null;
        try {
          let pendingText = '';
          let pendingStatus: string | undefined;

          const flushPending = () => {
            flushFrame = null;
            if (ctrl.signal.aborted || (!pendingText && pendingStatus === undefined)) return;

            const text = pendingText;
            const status = pendingStatus;
            pendingText = '';
            pendingStatus = undefined;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: text ? m.content + text : m.content,
                      streamStatus: status ?? m.streamStatus,
                    }
                  : m
              )
            );
          };

          const scheduleFlush = () => {
            if (flushFrame !== null) return;
            flushFrame = window.requestAnimationFrame(flushPending);
          };

          const result = await ragAskStream(
            { query: text, history },
            {
              onStatus: (status) => {
                if (ctrl.signal.aborted) return;
                pendingStatus = status;
                scheduleFlush();
              },
              onText: (chunk) => {
                if (ctrl.signal.aborted) return;
                answer += chunk;
                pendingText += chunk;
                scheduleFlush();
              },
              onDone: (result) => {
                if (ctrl.signal.aborted) return;
                actions = result.actions;
                dashboard = result.dashboard ?? dashboard;
              },
              onDashboard: (result) => {
                if (ctrl.signal.aborted) return;
                dashboard = result.dashboard;
                actions = result.actions;
                setMessages((prev) => prev.map((m) => m.id === assistantId ? {
                  ...m, dashboard, actions,
                } : m));
              },
            },
            { signal: ctrl.signal }
          );
          completed = result.completed;

          if (flushFrame !== null) {
            window.cancelAnimationFrame(flushFrame);
            flushPending();
          }
        } finally {
          if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
          // 總是清掉自己的 streaming flag；若使用者已送出下一條，streamingMessageId 會被新 cycle 設成新 id，
          // 此處只清「等於自己」的情境，避免覆蓋新訊息狀態。
          setStreamingMessageId((prev) => (prev === assistantId ? null : prev));
        }

        if (ctrl.signal.aborted) return;

        if (completed) completedHistory.current = appendCompletedChatTurn(history, text, answer);
        setMessages((prev) => prev.map((m) => m.id === assistantId ? {
          ...m,
          content: answer.trim() ? answer : '（無回覆內容）',
          streamStatus: undefined,
          actions,
          dashboard,
        } : m));
      } catch (err) {
        if (ctrl.signal.aborted) return;

        const message =
          err instanceof ApiRequestError
            ? err.message
            : err instanceof Error
              ? err.message
              : '抱歉，發生錯誤，請稍後再試。';

        if (streamingAssistantId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingAssistantId
                ? {
                    ...m,
                    content: m.dashboard ? `資料已顯示，文字解讀暫時無法取得：${message}` : `抱歉，無法取得回覆：${message}`,
                    streamStatus: undefined,
                  }
                : m
            )
          );
        } else {
          const errorMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `抱歉，無法取得回覆：${message}`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    []
  );

  return (
    <div className="flex min-h-[100dvh] flex-col text-[var(--color-text-primary)] lg:min-h-0 lg:flex-1">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta
          name="description"
          content="在 AI 對話中掌握個股分析、多股比較、技術指標、新聞與系統功能，直接點選建議問題繼續探索。"
        />
      </Head>
      <SubpageHeader
        icon={Bot}
        title="AI 對話"
        subtitle="個股、多股比較、技術指標與新聞重點（不構成投資建議）"
      />

      <main className="flex w-full max-w-7xl mx-auto flex-col px-4 sm:px-6 lg:px-8 py-3 sm:py-6 lg:min-h-0 lg:flex-1">
        <div className="flex w-full max-w-6xl mx-auto flex-col lg:min-h-0 lg:flex-1">
          <div
            className="flex w-full flex-col overflow-visible bento-cell border-b-0 shadow-[var(--shadow-elevated)] lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:max-h-[calc(100dvh-var(--app-header-height)-4rem-var(--app-safe-area-bottom))]"
          >
            <ChatArea
              messages={messages}
              loading={loading}
              loadingMode="rag"
              streamingMessageId={streamingMessageId}
              exampleQuestions={AI_EXAMPLE_QUESTIONS}
              onExampleSelect={handleSend}
            />
            <div className="flex-shrink-0">
              <ChatInput onSend={handleSend} disabled={loading} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
