import React from 'react';
import { motion } from 'motion/react';
import { Bot, User } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../lib/types';

interface Props {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <motion.div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div
        className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
          isUser
            ? 'bg-gray-200 dark:bg-gray-600'
            : 'bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] shadow-lg shadow-[#ffa95a]/20'
        }`}
      >
        {isUser ? (
          <User size={18} className="text-gray-600 dark:text-gray-300" />
        ) : (
          <Bot size={18} className="text-white" />
        )}
      </div>

      <div
        className={`flex-1 max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm'
        }`}
      >
        <p className="text-sm text-left leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
    </motion.div>
  );
};
