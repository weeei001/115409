import React, { useState, useCallback } from 'react';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { SubpageHeader } from '../components/SubpageHeader';
import { mockAiResponse } from '../lib/api/ai';
import type { ChatMessage } from '../lib/types';

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AiPage() {
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
      const reply = await mockAiResponse(text);
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '抱歉，發生錯誤，請稍後再試。',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜AI 投資顧問</title>
        <meta
          name="description"
          content="與 AI 對話取得投資概念說明（模擬回覆，展示／專題用途，不構成投資建議）。"
        />
      </Head>
      <SubpageHeader
        icon={Bot}
        title="AI 投資顧問"
        subtitle="與 AI 溝通，獲取投資建議"
      />

      <div className="flex-1 flex flex-col min-h-0 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex-1 flex flex-col min-h-0 max-w-4xl w-full mx-auto">
          <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-none border border-gray-200 dark:border-gray-700 border-b-0 shadow-sm">
            <ChatArea messages={messages} loading={loading} />
            <div className="flex-shrink-0">
              <ChatInput onSend={handleSend} disabled={loading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
