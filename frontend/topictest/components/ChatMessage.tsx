import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, User, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageType } from '../lib/types';
import { RagStructuredReply } from './RagStructuredReply';
import { isStructuredRagReply } from '../lib/utils/parseRagStructuredReply';

interface Props {
  message: ChatMessageType;
  reducedMotion?: boolean;
  /** 未設定 RAG／mock：假打字；RAG 串流中請改傳 streamActive */
  simulateTyping?: boolean;
  /** RAG 串流中：直接顯示 content 並顯示游標（不依賴假打字 interval） */
  streamActive?: boolean;
}

const TYPING_SPEED_MS = 12;

function useStreamingText(content: string, enabled: boolean) {
  const [displayed, setDisplayed] = useState(enabled ? '' : content);
  const [done, setDone] = useState(!enabled);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setDisplayed(content);
      setDone(true);
      return;
    }

    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    const id = setInterval(() => {
      indexRef.current += 2;
      if (indexRef.current >= content.length) {
        setDisplayed(content);
        setDone(true);
        clearInterval(id);
      } else {
        setDisplayed(content.slice(0, indexRef.current));
      }
    }, TYPING_SPEED_MS);

    return () => clearInterval(id);
  }, [content, enabled]);

  return { displayed, done };
}

export const ChatMessage: React.FC<Props> = ({
  message,
  reducedMotion,
  simulateTyping = false,
  streamActive = false,
}) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const useFakeTyping = !isUser && !streamActive && simulateTyping && !reducedMotion;

  const { displayed, done } = useStreamingText(message.content, useFakeTyping);

  const bodyText = isUser ? message.content : streamActive ? message.content : displayed;
  const showTypingCursor =
    !isUser &&
    (streamActive || (useFakeTyping && !done));
  const useStructuredReply = !isUser && isStructuredRagReply(bodyText);

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
            ? 'bg-[var(--color-bg-elevated)]'
            : 'shadow-lg'
        }`}
        style={isUser ? undefined : { background: 'var(--brand-gradient)' }}
      >
        {isUser ? (
          <User size={18} className="text-[var(--color-text-secondary)]" aria-hidden />
        ) : (
          <Bot size={18} className="text-white" aria-hidden />
        )}
      </div>

      <div
        className={`flex-1 rounded-2xl px-4 py-3 border border-[var(--color-border)] ${
          useStructuredReply
            ? 'max-w-[min(96vw,92%)] sm:max-w-[88%]'
            : 'max-w-[min(92vw,85%)] sm:max-w-[75%]'
        } ${
          isUser
            ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
            : 'bg-[var(--color-bg-card)] shadow-[var(--shadow-card)]'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-left leading-relaxed flex-1 min-w-0">
            {!isUser && message.streamStatus && (
              <p
                className="text-xs text-[var(--color-text-muted)] mb-2 whitespace-pre-wrap"
                aria-live="polite"
              >
                {message.streamStatus}
              </p>
            )}
            {useStructuredReply ? (
              <RagStructuredReply
                content={bodyText}
                showCursor={showTypingCursor}
              />
            ) : (
              <p className="whitespace-pre-wrap">
                {bodyText}
                {showTypingCursor && (
                  <span
                    className="inline-block w-0.5 h-4 ml-0.5 bg-brand align-text-bottom"
                    style={{ animation: 'cursor-blink 1s step-end infinite' }}
                  />
                )}
              </p>
            )}
          </div>
          {!isUser && done && message.content.trim().length > 0 && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex-shrink-0 p-1.5 rounded-lg text-[var(--color-text-muted)]
                         hover:text-brand hover:bg-brand/5 transition-colors"
              aria-label={copied ? '已複製' : '複製回覆'}
            >
              {copied ? <Check size={16} className="text-down" /> : <Copy size={16} />}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
