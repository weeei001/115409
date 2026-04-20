import React, { useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { mockAiResponse } from '../lib/api/ai';
import { isRagConfigured, ragAskStream } from '../lib/api/ragAsk';
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
  const ragConfigured = isRagConfigured();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  const handleSend = useCallback(async (text: string) => {
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
        /** React 18 會把非同步 tick 內多次 setState 合併，串流若不 flush 會變成「最後一次才畫」 */
        const flushAppend = (fn: () => void) => {
          flushSync(fn);
        };

        await ragAskStream(
          { query: text },
          {
            onStatus: (status) => {
              flushAppend(() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, streamStatus: status } : m
                  )
                );
              });
            },
            onText: (chunk) => {
              flushAppend(() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + chunk } : m
                  )
                );
              });
            },
          }
        );
      } finally {
        setStreamingMessageId(null);
      }

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
      setLoading(false);
    }
  }, [ragConfigured]);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜AI 投資顧問</title>
        <meta
          name="description"
          content="與財經新聞 RAG 對話取得參考資訊（未設定 RAG 時為本機模擬回覆；不構成投資建議）。"
        />
      </Head>
      <SubpageHeader
        icon={Bot}
        title="AI 投資顧問"
        subtitle="與 AI 溝通，獲取投資建議"
      />

      <div className="flex min-h-0 flex-1 flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6">
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
              exampleQuestions={AI_EXAMPLE_QUESTIONS}
              onExampleSelect={handleSend}
            />
            <div className="flex-shrink-0">
              <ChatInput onSend={handleSend} disabled={loading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
