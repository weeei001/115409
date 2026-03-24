import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessage as ChatMessageType } from '../lib/types';

interface Props {
  messages: ChatMessageType[];
  loading?: boolean;
}

export const ChatArea: React.FC<Props> = ({ messages, loading }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && !loading) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom);
    });
  }, [messages, loading]);

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto flex flex-col gap-4 px-4 py-6"
    >
      {messages.length === 0 && !loading && (
        <motion.div
          className="flex-1 flex flex-col items-center justify-center text-center py-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ffa95a]/20 to-[#ffd45a]/20 flex items-center justify-center mb-4">
            <span className="text-2xl">💬</span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">歡迎使用 AI 投資顧問</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">輸入您的問題，AI 將為您提供投資建議</p>
        </motion.div>
      )}

      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {loading && (
        <motion.div
          className="flex gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center">
            <span className="text-white text-sm">AI</span>
          </div>
          <div className="flex-1 rounded-2xl px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#ffa95a] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#ffa95a] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#ffa95a] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
