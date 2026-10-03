import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** openapi: AskRequest.query maxLength */
const MAX_QUERY_LENGTH = 6000;
/** 剩這麼多字時開始顯示字數 */
const COUNTER_THRESHOLD = MAX_QUERY_LENGTH - 500;

/**
 * Enter 送出、Shift+Enter 換行；輸入法組字中（isComposing／keyCode 229）不送出。
 * 輸入框下方固定顯示 AI 免責：手機版 /ai 沒有頁尾、副標題也會被截斷（決議 D13）。
 * 送出鈕是這個畫面唯一的燈色主要按鈕。
 */
export function ChatInput({ onSend, disabled, onStop, stopNotice = false, initialValue = '' }: {
  onSend: (text: string) => void;
  disabled: boolean;
  onStop?: () => void;
  stopNotice?: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue.slice(0, MAX_QUERY_LENGTH));

  const canSend = Boolean(value.trim()) && !disabled;

  const submit = () => {
    const trimmed = value.trim().slice(0, MAX_QUERY_LENGTH);
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="border-t border-border-strong bg-card px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-area-bottom))] sm:px-5 lg:pb-3">
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
          className="block max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-none border border-input bg-card px-3 py-[0.6875rem] text-base leading-5 text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground focus-lamp disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 sm:text-sm sm:leading-5"
        />
        {/* 能送出才亮燈；不能送出時是中性的外框按鈕（不是褪色的燈）。sm 以上附文字「送出」 */}
        <Button
          type="button"
          variant={canSend ? 'default' : 'outline'}
          onClick={submit}
          disabled={!canSend}
          aria-label="送出訊息"
          className="size-11 has-[>svg]:px-0 disabled:cursor-not-allowed disabled:border-input disabled:bg-card disabled:text-muted-foreground disabled:opacity-100 sm:w-auto sm:has-[>svg]:px-4"
        >
          <Send size={18} aria-hidden />
          <span className="hidden sm:inline" aria-hidden>送出</span>
        </Button>
        {onStop ? <Button type="button" variant="outline" onClick={onStop} className="px-3">
          停止接收
        </Button> : null}
      </div>
      <p id="chat-input-note" className="mt-2 flex justify-between gap-3 text-xs leading-relaxed text-muted-foreground">
        <span>AI 回覆僅供研究參考，不是投資建議。</span>
        {value.length >= COUNTER_THRESHOLD ? (
          <span className="shrink-0 font-mono tabular-nums" aria-live="polite">
            {value.length}／{MAX_QUERY_LENGTH} 字
          </span>
        ) : null}
      </p>
      {stopNotice ? <p role="status" className="mt-1 text-xs leading-relaxed text-muted-foreground">已停止接收，後端可能仍在處理。</p> : null}
    </div>
  );
}
