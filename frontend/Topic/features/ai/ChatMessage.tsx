import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Bot, Check, Copy, User } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { isChatFollowUpAction, isChatNavigationAction } from '@/lib/nav';
import { MarkdownBlock } from '@/lib/utils/markdown';
import { isStructuredRagReply } from '@/lib/utils/parseRagStructuredReply';
import { cn } from '@/lib/cn';
import { RagStructuredReply } from './RagStructuredReply';

interface Props {
  message: ChatMessageData;
  reducedMotion: boolean;
  /** 正在接收串流：顯示游標，建議追問與（沒有資料面板時的）相關功能先不出現 */
  streamActive: boolean;
  onFollowUp?: (query: string) => void;
  followUpDisabled: boolean;
}

const Cursor = () => <span className="ml-0.5 inline-block h-4 w-0.5 bg-brand align-text-bottom" style={{ animation: 'cursor-blink 1s step-end infinite' }} />;

export function ChatMessage({ message, reducedMotion, streamActive, onFollowUp, followUpDisabled }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const hasNewsDashboard = message.dashboard?.blocks.some((block) => block.kind === 'news') ?? false;
  const structured = !isUser && isStructuredRagReply(message.content);
  const cursor = !isUser && streamActive;
  const navActions = !isUser && (!streamActive || message.dashboard) ? (message.actions ?? []).filter(isChatNavigationAction) : [];
  const followUps = !isUser && !streamActive && onFollowUp ? (message.actions ?? []).filter(isChatFollowUpAction) : [];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success('已複製回覆');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('無法複製，請手動選取文字');
    }
  };

  return (
    <motion.div
      className={cn('flex min-w-0 gap-2 sm:gap-3', isUser && 'flex-row-reverse')}
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.3 }}
    >
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', isUser ? 'bg-muted' : 'bg-brand-gradient shadow-card')}>
        {isUser ? <User size={18} className="text-subtle" aria-hidden /> : <Bot size={18} className="text-on-brand" aria-hidden />}
      </div>

      <div
        className={cn(
          'min-w-0 flex-1 rounded-2xl border px-3 py-3 sm:px-4',
          message.dashboard ? 'w-full max-w-full' : structured ? 'max-w-[min(96vw,92%)] sm:max-w-[88%]' : 'max-w-[min(92vw,85%)] sm:max-w-[75%]',
          isUser ? 'bg-muted text-foreground' : 'bg-card shadow-card',
        )}
      >
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row">
          <div className="w-full min-w-0 flex-1 text-left text-sm leading-relaxed">
            {!isUser && message.dashboard ? <h4 className="mb-2 text-sm font-semibold">AI 解讀</h4> : null}
            {!isUser && message.streamStatus ? (
              <p className="mb-2 text-xs whitespace-pre-wrap text-muted-foreground" aria-live="polite">
                {message.streamStatus}
              </p>
            ) : null}
            {structured ? (
              <RagStructuredReply content={message.content} showCursor={cursor} showSources={!hasNewsDashboard} />
            ) : (
              <>
                <MarkdownBlock text={message.content} />
                {cursor ? <Cursor /> : null}
              </>
            )}
          </div>
          {!isUser && message.content.trim() ? (
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={copied ? '已複製' : '複製回覆'}
              className="flex size-11 shrink-0 items-center justify-center self-end rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-brand-text sm:self-start"
            >
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
          ) : null}
        </div>

        {followUps.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="建議追問">
            {followUps.map((action, index) => (
              <button
                key={`${action.query}-${index}`}
                type="button"
                disabled={followUpDisabled}
                onClick={() => onFollowUp?.(action.query)}
                className="min-h-11 rounded-xl border px-3 py-2 text-left text-sm text-brand-text transition-colors hover:border-border-strong hover:bg-accent disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {navActions.length > 0 ? (
          <nav className="mt-4 flex flex-wrap gap-2 border-t pt-3" aria-label="相關功能">
            {navActions.map((action, index) => (
              <Link
                key={`${action.path}-${index}`}
                href={action.path}
                className="inline-flex min-h-11 items-center rounded-xl border px-3 py-2 text-sm text-brand-text transition-colors hover:border-border-strong hover:bg-accent"
              >
                {action.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </motion.div>
  );
}
