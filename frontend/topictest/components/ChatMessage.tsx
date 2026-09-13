import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Bot, User, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageType } from '../lib/types';
import { RagStructuredReply } from './RagStructuredReply';
import { MarkdownBlock } from '../lib/utils/markdown';
import { isStructuredRagReply } from '../lib/utils/parseRagStructuredReply';
import { isChatNavigationAction, isChatFollowUpAction } from '../lib/nav';

interface Props {
  message: ChatMessageType;
  reducedMotion?: boolean;
  /** 未設定 RAG／mock：假打字；RAG 串流中請改傳 streamActive */
  simulateTyping?: boolean;
  /** RAG 串流中：直接顯示 content 並顯示游標（不依賴假打字 interval） */
  streamActive?: boolean;
  onFollowUp?: (query: string) => void;
  followUpDisabled?: boolean;
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
  onFollowUp,
  followUpDisabled = false,
}) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const useFakeTyping = !isUser && !streamActive && simulateTyping && !reducedMotion;

  const { displayed, done } = useStreamingText(message.content, useFakeTyping);

  const bodyText = isUser ? message.content : streamActive ? message.content : displayed;
  const hasNewsDashboard = message.dashboard?.blocks.some((block) => block.kind === 'news') ?? false;
  const showTypingCursor =
    !isUser &&
    (streamActive || (useFakeTyping && !done));
  const useStructuredReply = !isUser && isStructuredRagReply(bodyText);
  const actions = !isUser && (!streamActive || message.dashboard) ? (message.actions ?? []).filter(isChatNavigationAction) : [];

  const followUps = !isUser && !streamActive && onFollowUp ? (message.actions ?? []).filter(isChatFollowUpAction) : [];

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
      className={`flex min-w-0 gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
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
          <Bot size={18} className="text-[var(--color-on-brand)]" aria-hidden />
        )}
      </div>

      <div
        className={`min-w-0 flex-1 rounded-2xl px-3 py-3 sm:px-4 border border-[var(--color-border)] ${
          message.dashboard ? 'w-full max-w-full' : useStructuredReply
            ? 'max-w-[min(96vw,92%)] sm:max-w-[88%]'
            : 'max-w-[min(92vw,85%)] sm:max-w-[75%]'
        } ${
          isUser
            ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
            : 'bg-[var(--color-bg-card)] shadow-[var(--shadow-card)]'
        }`}
      >
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row">
          <div className="w-full text-sm text-left leading-relaxed flex-1 min-w-0">
            {!isUser && message.dashboard && <h4 className="mb-2 text-sm font-semibold">AI 解讀</h4>}
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
                showSources={!hasNewsDashboard}
              />
            ) : (
              <>
                <MarkdownBlock text={bodyText} />
                {showTypingCursor && (
                  <span
                    className="inline-block w-0.5 h-4 ml-0.5 bg-brand align-text-bottom"
                    style={{ animation: 'cursor-blink 1s step-end infinite' }}
                  />
                )}
              </>
            )}
          </div>
          {!isUser && done && message.content.trim().length > 0 && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex size-11 shrink-0 items-center justify-center self-end sm:self-start rounded-lg text-[var(--color-text-muted)]
                         hover:text-brand hover:bg-brand/5 transition-colors"
              aria-label={copied ? '已複製' : '複製回覆'}
            >
              {copied ? <Check size={16} className="text-down" /> : <Copy size={16} />}
            </button>
          )}
        </div>
        {followUps.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="建議追問">
            {followUps.map((action, index) => (
              <button
                key={`${action.query}-${index}`}
                type="button"
                disabled={followUpDisabled}
                onClick={() => onFollowUp?.(action.query)}
                className="min-h-[44px] rounded-xl border border-[var(--color-border)] px-3 py-2 text-left text-sm text-brand hover:border-brand/40 hover:bg-brand/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <nav className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3" aria-label="相關功能">
            {actions.map((action, index) => (
              <Link
                key={`${action.path}-${index}`}
                href={action.path}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-brand transition-colors hover:border-brand/40 hover:bg-brand/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {action.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </motion.div>
  );
};
