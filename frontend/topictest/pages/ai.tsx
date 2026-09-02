import React, { useState, useCallback, useRef, useEffect } from 'react';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { ragAskStream } from '../lib/api/ragAsk';
import { ApiRequestError } from '../lib/api/client';
import type { ChatMessage } from '../lib/types';

const AI_EXAMPLE_QUESTIONS = [
  '近期台股與權值股有什麼財經新聞重點？',
  '通膨與利率變化對股市有什麼影響？',
  '如何解讀成交量與價格走勢的關係？',
  '外資買超或賣超通常代表什麼意義？',
];

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AiPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

        try {
          let pendingText = '';
          let pendingStatus: string | undefined;
          let flushFrame: number | null = null;

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

          await ragAskStream(
            { query: text },
            {
              onStatus: (status) => {
                if (ctrl.signal.aborted) return;
                pendingStatus = status;
                scheduleFlush();
              },
              onText: (chunk) => {
                if (ctrl.signal.aborted) return;
                pendingText += chunk;
                scheduleFlush();
              },
            },
            { signal: ctrl.signal }
          );

          if (flushFrame !== null) {
            window.cancelAnimationFrame(flushFrame);
            flushPending();
          }
        } finally {
          // 總是清掉自己的 streaming flag；若使用者已送出下一條，streamingMessageId 會被新 cycle 設成新 id，
          // 此處只清「等於自己」的情境，避免覆蓋新訊息狀態。
          setStreamingMessageId((prev) => (prev === assistantId ? null : prev));
        }

        if (ctrl.signal.aborted) return;

        setMessages((prev) => {
          const last = prev.find((m) => m.id === assistantId);
          if (last && !last.content.trim()) {
            return prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: '（無回覆內容）', streamStatus: undefined }
                : m
            );
          }
          return prev.map((m) =>
            m.id === assistantId ? { ...m, streamStatus: undefined } : m
          );
        });
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
                    content: `抱歉，無法取得回覆：${message}`,
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
    <div className="flex min-h-0 flex-1 flex-col text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta
          name="description"
          content="與財經新聞 RAG 對話取得參考資訊（未設定 RAG 時為本機模擬回覆；不構成投資建議）。"
        />
      </Head>
      <SubpageHeader
        icon={Bot}
        title="AI 對話"
        subtitle="參考資訊對話（不構成投資建議）"
      />

      <main className="flex min-h-0 flex-1 flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6">
        <div className="flex min-h-0 flex-1 flex-col w-full max-w-4xl mx-auto">
          <div
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bento-cell border-b-0 shadow-[var(--shadow-elevated)]
                       max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100dvh-10rem)]"
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
