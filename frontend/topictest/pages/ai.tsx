import React, { useState, useCallback } from 'react';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { mockAiResponse } from '../lib/api/ai';
import { isRagConfigured, ragAsk } from '../lib/api/ragAsk';
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

  const handleSend = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const reply = ragConfigured
        ? (await ragAsk({ query: text })).text
        : await mockAiResponse(text);
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : '抱歉，發生錯誤，請稍後再試。';
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `抱歉，無法取得回覆：${message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [ragConfigured]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
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
        rightExtra={
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ${
              ragConfigured
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                : 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
            }`}
            title={
              ragConfigured
                ? '已連線財經新聞 RAG 後端'
                : '未設定 RAG，回覆為本機模擬（非即時新聞庫）'
            }
          >
            {ragConfigured ? '財經新聞 RAG' : '本機模擬'}
          </span>
        }
      />

      <div className="flex-1 flex flex-col min-h-0 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex-1 flex flex-col min-h-0 max-w-4xl w-full mx-auto">
          <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-none border border-gray-200 dark:border-gray-700 border-b-0 shadow-sm">
            <ChatArea
              messages={messages}
              loading={loading}
              loadingMode={ragConfigured ? 'rag' : 'mock'}
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
