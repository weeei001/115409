import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { Bot } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { ChatDashboard } from './ChatDashboard';
import type { ChatMessage as ChatMessageType } from '../lib/types';

export type ChatLoadingMode = 'rag' | 'mock';

interface Props {
  messages: ChatMessageType[];
  loading?: boolean;
  loadingMode?: ChatLoadingMode;
  /** 未設定 RAG 時可開啟假打字 */
  simulateTyping?: boolean;
  /** 正在接收 RAG 串流的助理訊息 id（用於即時顯示與游標） */
  streamingMessageId?: string | null;
  exampleQuestions?: string[];
  onExampleSelect?: (text: string) => void;
}

function ThinkingDots() {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-brand"
          style={{
            animation: 'thinking-dot 1.4s ease-in-out infinite',
            animationDelay: `${i * 180}ms`,
          }}
        />
      ))}
    </div>
  );
}

export const ChatArea: React.FC<Props> = ({
  messages,
  loading,
  loadingMode = 'mock',
  simulateTyping = false,
  streamingMessageId = null,
  exampleQuestions = [],
  onExampleSelect,
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotionClient();
  const scrollKey = messages.map((m) => `${m.id}:${m.content.length}`).join('|');
  const activeDashboard = [...messages].reverse().find((message) => message.dashboard)?.dashboard;
  const hasDashboard = !!activeDashboard;

  useEffect(() => {
    if (messages.length === 0 && !loading) return;
    const scrollToBottom = () => {
      chatEndRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
  }, [scrollKey, loading, reduceMotion, messages.length]);

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain lg:overflow-hidden ${hasDashboard ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] lg:grid-rows-1' : 'lg:overflow-y-auto'}`}
    >
      <div
        className={`min-h-full min-w-0 flex flex-col gap-4 px-4 py-6 ${hasDashboard ? 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain' : ''}`}
      >
        {messages.length === 0 && !loading && (
          <motion.div
            className="flex-1 flex flex-col items-center justify-center text-center py-12"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                 style={{ background: 'linear-gradient(135deg, rgba(212,165,116,0.15), rgba(232,201,160,0.15))' }}>
              <Bot size={28} className="text-brand" />
            </div>
            <p className="text-[var(--color-text-secondary)] text-sm mb-1">說出想了解的事，整理成你的分析畫面</p>
            <p className="text-[var(--color-text-muted)] text-xs mb-6">個股走勢、比較表、指標與新聞，連同解讀直接顯示在對話中</p>
            {exampleQuestions.length > 0 && onExampleSelect && (
              <div className="flex flex-wrap justify-center gap-2 max-w-lg px-2" role="group" aria-label="範例問題">
                {exampleQuestions.map((q, idx) => (
                  <button
                    key={`${idx}-${q}`}
                    type="button"
                    onClick={() => onExampleSelect(q)}
                    className="text-left text-xs sm:text-sm px-3 py-2.5 rounded-xl border border-[var(--color-border)]
                               bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]
                               hover:border-brand/40 hover:text-brand hover:bg-brand/5
                               transition-[color,background-color,border-color,transform] min-h-[44px]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            reducedMotion={!!reduceMotion}
            simulateTyping={simulateTyping}
            onFollowUp={onExampleSelect}
            followUpDisabled={loading}
            streamActive={msg.role === 'assistant' && msg.id === streamingMessageId}
          />
        ))}

        {loading &&
          !(
            messages.length > 0 && messages[messages.length - 1]?.role === 'assistant'
          ) && (
          <motion.div
            className="flex gap-3"
            role="status"
            aria-live="polite"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ background: 'var(--brand-gradient)' }}>
              <Bot size={16} className="text-white" />
            </div>
            <div className="flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-card)] px-4 py-3">
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                {loadingMode === 'rag' ? '正在查詢與整理系統資料…' : '正在產生模擬回覆…'}
              </p>
              <ThinkingDots />
            </div>
          </motion.div>
        )}
        <div ref={chatEndRef} className="h-0 shrink-0" aria-hidden="true" />
      </div>

      {activeDashboard && (
        <aside
          className="min-h-0 min-w-0 overflow-y-auto overscroll-y-contain border-t border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4 sm:px-5 sm:py-5 lg:border-l lg:border-t-0"
          aria-label="分析資料面板"
        >
          <ChatDashboard dashboard={activeDashboard} />
        </aside>
      )}
    </div>
  );
};
