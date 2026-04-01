import React, { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, User, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageType } from '../lib/types';

interface Props {
  message: ChatMessageType;
  reducedMotion?: boolean;
}

export const ChatMessage: React.FC<Props> = ({ message, reducedMotion }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (isUser) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success('已複製回覆');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('無法複製，請手動選取文字');
    }
  }, [isUser, message.content]);

  const motionProps = reducedMotion
    ? { initial: false, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } };

  return (
    <motion.div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
      {...motionProps}
    >
      <div
        className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
          isUser
            ? 'bg-gray-200 dark:bg-gray-600'
            : 'bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] shadow-lg shadow-[#ffa95a]/20'
        }`}
      >
        {isUser ? (
          <User size={18} className="text-gray-600 dark:text-gray-300" aria-hidden />
        ) : (
          <Bot size={18} className="text-white" aria-hidden />
        )}
      </div>

      <div
        className={`flex-1 max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-left leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
            {message.content}
          </p>
          {!isUser && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-[#ffa95a] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label={copied ? '已複製' : '複製回覆'}
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
