import React, { useState } from 'react';
import { Send } from 'lucide-react';

/** openapi: AskRequest.query maxLength */
const MAX_QUERY_LENGTH = 6000;
/** 剩這麼多字時開始顯示字數 */
const COUNTER_THRESHOLD = MAX_QUERY_LENGTH - 500;

/**
 * Enter 送出、Shift+Enter 換行；輸入法組字中（isComposing／keyCode 229）不送出。
 * 輸入框下方固定顯示 AI 免責：手機版 /ai 沒有頁尾、副標題也會被截斷（決議 D13）。
 */
export function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim().slice(0, MAX_QUERY_LENGTH);
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="border-t bg-card p-4">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-input-message" className="sr-only">
          輸入訊息（Enter 送出，Shift+Enter 換行）
        </label>
        <textarea
          id="chat-input-message"
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          aria-describedby="chat-input-note"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="輸入您的問題..."
          rows={1}
          disabled={disabled}
          className="max-h-32 min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-input bg-muted px-4 py-3 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || disabled}
          aria-label="送出訊息"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-on-brand shadow-card transition-[opacity,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          <Send size={18} aria-hidden />
        </button>
      </div>
      <p id="chat-input-note" className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
        <span>AI 回覆僅供研究參考，不是投資建議。</span>
        {value.length >= COUNTER_THRESHOLD ? (
          <span className="shrink-0 tabular-nums" aria-live="polite">
            {value.length}／{MAX_QUERY_LENGTH} 字
          </span>
        ) : null}
      </p>
    </div>
  );
}
