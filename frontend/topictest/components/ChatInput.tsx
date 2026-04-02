import React, { useState, useCallback } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSend, disabled }) => {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }, [value, onSend, disabled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const inputId = 'chat-input-message';

  return (
    <div className="flex gap-2 items-end p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <label htmlFor={inputId} className="sr-only">
        輸入訊息（Enter 送出，Shift+Enter 換行）
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="輸入您的問題..."
        rows={1}
        disabled={disabled}
        className="flex-1 min-h-[44px] max-h-32 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm
                   resize-none focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                   disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        aria-label="送出訊息"
        className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center
                   bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white shadow-lg shadow-[#ffa95a]/20
                   hover:shadow-xl hover:shadow-[#ffa95a]/30 transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer"
      >
        <Send size={18} aria-hidden />
      </button>
    </div>
  );
};
