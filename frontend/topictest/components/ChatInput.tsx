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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const inputId = 'chat-input-message';

  return (
    <div className="flex gap-2 items-end p-4 border-t border-[var(--color-border)]
                    bg-[var(--color-bg-card)]">
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
        className="flex-1 min-w-0 min-h-[48px] max-h-32 px-4 py-3 rounded-xl border border-[var(--color-border)]
                   bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-base sm:text-sm
                   resize-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                   disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        aria-label="送出訊息"
        className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center
                   text-[var(--color-on-brand)] shadow-lg transition-[opacity,box-shadow,transform]
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        style={{ background: 'var(--brand-gradient)' }}
      >
        <Send size={18} aria-hidden />
      </button>
    </div>
  );
};
