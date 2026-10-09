import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/** openapi: AskRequest.query maxLength */
const MAX_QUERY_LENGTH = 6000;
/** 剩這麼多字時開始顯示字數 */
const COUNTER_THRESHOLD = MAX_QUERY_LENGTH - 500;

/**
 * Enter 送出、Shift+Enter 換行；輸入法組字中（isComposing／keyCode 229）不送出。
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
          aria-describedby={value.length >= COUNTER_THRESHOLD ? 'chat-input-note' : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="輸入你的問題…"
          rows={1}
          disabled={disabled}
          className={cn(inputClass, 'block h-auto max-h-32 min-h-11 flex-1 resize-none py-[0.6875rem] leading-5 disabled:bg-muted sm:leading-5')}
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
          停止回覆
        </Button> : null}
      </div>
      {value.length >= COUNTER_THRESHOLD ? (
        <p id="chat-input-note" className="mt-2 text-right font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {value.length}／{MAX_QUERY_LENGTH} 字
        </p>
      ) : null}
      {stopNotice ? <p role="status" className="mt-1 text-xs leading-relaxed text-muted-foreground">已停止顯示這則回覆。</p> : null}
    </div>
  );
}
