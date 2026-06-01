import React, { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import Head from 'next/head';
import { Bot, Info } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { mockAiResponse } from '../lib/api/ai';
import { isRagConfigured, ragAskStream } from '../lib/api/ragAsk';
import { ApiRequestError } from '../lib/api/client';
import type { ChatMessage } from '../lib/types';

const AI_EXAMPLE_QUESTIONS_RAG = [
  '近期台股與權值股有什麼財經新聞重點？',
  '通膨與利率變化對股市有什麼影響？',
  '如何解讀成交量與價格走勢的關係？',
  '外資買超或賣超通常代表什麼意義？',
];

const AI_EXAMPLE_QUESTIONS_MOCK = [
  '台積電（2330）近期看法？',
  '現在適合買進嗎？',
  '投資風險要注意什麼？',
  '如何用多股比較功能？',
];

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AiPage() {
  const ragConfigured = isRagConfigured();
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
        if (!ragConfigured) {
          const reply = await mockAiResponse(text);
          if (ctrl.signal.aborted) return;
          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: reply,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          return;
        }

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
          const flushAppend = (fn: () => void) => {
            flushSync(fn);
          };

          await ragAskStream(
            { query: text },
            {
              onStatus: (status) => {
                if (ctrl.signal.aborted) return;
                flushAppend(() => {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, streamStatus: status } : m))
                  );
                });
              },
              onText: (chunk) => {
                if (ctrl.signal.aborted) return;
                flushAppend(() => {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: m.content + chunk } : m
                    )
                  );
                });
              },
            },
            { signal: ctrl.signal }
          );
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
    [ragConfigured]
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
        {!ragConfigured ? (
          <div
            className="ui-alert-warning mb-3 flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
            role="status"
          >
            <Info size={18} className="shrink-0 mt-0.5 text-warning-icon" aria-hidden />
            <p>
              <strong>示範模式：</strong>尚未設定 RAG API，目前回覆為本機規則模擬，非即時財經新聞檢索。請設定{' '}
              <code className="text-xs">NEXT_PUBLIC_RAG_API_USE_PROXY</code> 或{' '}
              <code className="text-xs">NEXT_PUBLIC_RAG_API_BASE_URL</code>（詳見 .env.example）。
            </p>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col w-full max-w-4xl mx-auto">
          <div
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bento-cell border-b-0 shadow-[var(--shadow-elevated)]
                       max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100dvh-10rem)]"
          >
            <ChatArea
              messages={messages}
              loading={loading}
              loadingMode={ragConfigured ? 'rag' : 'mock'}
              simulateTyping={!ragConfigured}
              streamingMessageId={streamingMessageId}
              exampleQuestions={
                ragConfigured ? AI_EXAMPLE_QUESTIONS_RAG : AI_EXAMPLE_QUESTIONS_MOCK
              }
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
