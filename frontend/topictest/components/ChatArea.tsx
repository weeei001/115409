import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessage as ChatMessageType } from '../lib/types';

export type ChatLoadingMode = 'rag' | 'mock';

interface Props {
  messages: ChatMessageType[];
  loading?: boolean;
  loadingMode?: ChatLoadingMode;
  exampleQuestions?: string[];
  onExampleSelect?: (text: string) => void;
}

export const ChatArea: React.FC<Props> = ({
  messages,
  loading,
  loadingMode = 'mock',
  exampleQuestions = [],
  onExampleSelect,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const scrollKey = messages.map((m) => `${m.id}:${m.content.length}`).join('|');

  useEffect(() => {
    if (messages.length === 0 && !loading) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom);
    });
  }, [scrollKey, loading, reduceMotion, messages.length]);

  const emptyMotionProps = reduceMotion
    ? { initial: false, animate: { opacity: 1 } }
    : { initial: { opacity: 0 } as const, animate: { opacity: 1 }, transition: { duration: 0.5 } };

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto flex flex-col gap-4 px-4 py-6"
    >
      {messages.length === 0 && !loading && (
        <motion.div
          className="flex-1 flex flex-col items-center justify-center text-center py-12"
          {...emptyMotionProps}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ffa95a]/20 to-[#ffd45a]/20 flex items-center justify-center mb-4">
            <span className="text-2xl" aria-hidden>
              💬
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">歡迎使用 AI 投資顧問</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs mb-6">
            輸入您的問題，或點選下方範例快速開始
          </p>
          {exampleQuestions.length > 0 && onExampleSelect ? (
            <div
              className="flex flex-wrap justify-center gap-2 max-w-lg px-2"
              role="group"
              aria-label="範例問題"
            >
              {exampleQuestions.map((q, idx) => (
                <button
                  key={`${idx}-${q}`}
                  type="button"
                  onClick={() => onExampleSelect(q)}
                  className="text-left text-xs sm:text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:border-[#ffa95a] hover:bg-[#fff8f0] dark:hover:bg-gray-600 hover:shadow-sm transition-all max-w-full cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
        </motion.div>
      )}

      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} reducedMotion={!!reduceMotion} />
      ))}

      {loading && (
        <motion.div
          className="flex gap-3"
          role="status"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : undefined}
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center">
            <span className="text-white text-sm">AI</span>
          </div>
          <div className="flex-1 rounded-2xl px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {loadingMode === 'rag' ? '正在查詢財經新聞知識庫…' : '正在產生模擬回覆…'}
            </p>
            <div className="flex gap-1.5" aria-hidden>
              <span
                className={`w-2 h-2 rounded-full bg-[#ffa95a] ${reduceMotion ? '' : 'animate-bounce'}`}
                style={{ animationDelay: '0ms' }}
              />
              <span
                className={`w-2 h-2 rounded-full bg-[#ffa95a] ${reduceMotion ? '' : 'animate-bounce'}`}
                style={{ animationDelay: '150ms' }}
              />
              <span
                className={`w-2 h-2 rounded-full bg-[#ffa95a] ${reduceMotion ? '' : 'animate-bounce'}`}
                style={{ animationDelay: '300ms' }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
