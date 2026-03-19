import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { ArrowLeft, Bot } from 'lucide-react';
import { ChatArea } from '../components/ChatArea';
import { ChatInput } from '../components/ChatInput';
import { ThemeToggle } from '../components/ThemeToggle';
import { mockAiResponse } from '../lib/api/ai';
import type { ChatMessage } from '../lib/types';

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function AiPage() {
  const router = useRouter();
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
      <header className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <motion.div
            className="flex items-center justify-between gap-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400
                           hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
                <Bot size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">AI 投資顧問</h1>
                <p className="text-xs text-gray-400 dark:text-gray-500">與 AI 溝通，獲取投資建議</p>
              </div>
            </div>
            <ThemeToggle />
          </motion.div>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 max-w-4xl w-full mx-auto">
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-none border border-gray-200 dark:border-gray-700 border-b-0 shadow-sm">
          <ChatArea messages={messages} loading={loading} />
          <div className="flex-shrink-0">
            <ChatInput onSend={handleSend} disabled={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
