import React, { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Bot, Check, Copy, User } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { parseChatSources } from '@/lib/types/chat';
import { isChatFollowUpAction, isChatNavigationAction, isPaperOrderDraftAction } from '@/lib/nav';
import { PaperOrderDraft } from '@/features/order/PaperOrderDraft';
import { MarkdownBlock } from '@/lib/utils/markdown';
import { isStructuredRagReply } from '@/lib/utils/parseRagStructuredReply';
import { CHAT_CITATION_RE, chatAnswerBody, newsCitationPath } from '@/lib/utils/chatCitations';
import { cn } from '@/lib/cn';
import { RagStructuredReply } from './RagStructuredReply';

interface Props {
  message: ChatMessageData;
  reducedMotion: boolean;
  /** 正在接收串流：顯示游標，建議追問與（沒有資料面板時的）相關功能先不出現 */
  streamActive: boolean;
  onFollowUp?: (query: string) => void;
  followUpDisabled: boolean;
  answerTargetId?: string;
  citationsTargetId?: string;
}

const Cursor = () => <span className="ml-0.5 inline-block h-4 w-0.5 bg-brand align-text-bottom" style={{ animation: 'cursor-blink 1s step-end infinite' }} />;

export function ChatMessage({ message, reducedMotion, streamActive, onFollowUp, followUpDisabled, answerTargetId, citationsTargetId }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const sourceScope = useId();
  const rawSourcesRef = useRef<HTMLDetailsElement>(null);
  const content = isUser ? message.content : chatAnswerBody(message.content);
  const sources = parseChatSources(message.sources);
  const sourceMap = new Map(sources.map((source) => [source.citation_id, source]));
  const citedIds = [...new Set([...content.matchAll(CHAT_CITATION_RE)].map((match) => match[1]))];
  const sourceId = (id: string) => `chat-source-${sourceScope}-${id}`;
  const renderCitation = (id: string) => {
    const source = sourceMap.get(id);
    if (!source) return <span className="text-muted-foreground">[{id}]（來源無法使用）</span>;
    const path = newsCitationPath(source);
    return <a href={path ?? `#${sourceId(id)}`}
      aria-label={`引用 ${id}：${source.title}${path ? '，查看本站新聞' : '，查看原始資料'}`}
      className="text-brand-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={path ? undefined : (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const details = document.getElementById(sourceId(id)) as HTMLDetailsElement | null;
        if (!details) return;
        event.preventDefault();
        if (rawSourcesRef.current) rawSourcesRef.current.open = true;
        details.open = true;
        details.querySelector('summary')?.focus();
        details.scrollIntoView({ block: 'nearest' });
      }}>[{id}]</a>;
  };
  const structured = !isUser && isStructuredRagReply(content);
  const cursor = !isUser && streamActive;
  const navActions = !isUser && (!streamActive || message.dashboard) ? (message.actions ?? []).filter(isChatNavigationAction) : [];
  const followUps = !isUser && !streamActive && onFollowUp ? (message.actions ?? []).filter(isChatFollowUpAction) : [];
  const drafts = !isUser && !streamActive ? (message.actions ?? []).filter(isPaperOrderDraftAction) : [];

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
      id={answerTargetId}
      tabIndex={answerTargetId ? -1 : undefined}
      className={cn('flex min-w-0 gap-2 sm:gap-3', isUser && 'flex-row-reverse', answerTargetId && 'rounded-xl focus:outline-2 focus:outline-offset-2')}
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
            {!isUser && message.status ? <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {{ streaming: '生成中', completed: '已完成', failed: '回覆失敗', interrupted: '回覆已中斷；可重新提問。' }[message.status]}
              {message.status === 'failed' && message.error ? `：${message.error}` : ''}
            </p> : null}
            {!isUser && message.dashboard ? <h4 className="mb-2 text-sm font-semibold">AI 解讀</h4> : null}
            {!isUser && message.streamStatus ? (
              <p className="mb-2 text-xs whitespace-pre-wrap text-muted-foreground" aria-live="polite">
                {message.streamStatus}
              </p>
            ) : null}
            {structured ? (
              <RagStructuredReply content={content} showCursor={cursor} renderCitation={renderCitation} />
            ) : (
              <>
                <MarkdownBlock text={content} renderCitation={isUser ? undefined : renderCitation} />
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

        {!isUser && (citedIds.length > 0 || sources.length > 0) ? <div id={citationsTargetId}
          tabIndex={citationsTargetId ? -1 : undefined} aria-label="引用與原始資料"
          className={citationsTargetId ? 'rounded-lg focus:outline-2 focus:outline-offset-2' : undefined}>
        {citedIds.length ? (
          <section className="mt-3 border-t pt-3 text-sm" aria-label="引用來源">
            <h3 className="mb-2 text-xs font-semibold">引用來源</h3>
            <ul className="space-y-2">
              {citedIds.map((id) => <li key={id} className="break-words whitespace-pre-wrap">
                {renderCitation(id)} {sourceMap.get(id)?.title}
              </li>)}
            </ul>
          </section>
        ) : null}

        {sources.length ? (
          <details ref={rawSourcesRef} className="mt-3 border-t pt-3 text-sm">
            <summary className="cursor-pointer text-brand-text">本輪引用原始資料</summary>
            {sources.map((source) => (
              <details key={source.citation_id} id={sourceId(source.citation_id)} className="mt-2 rounded-lg border p-3">
                <summary className="cursor-pointer break-words whitespace-pre-wrap">[{source.citation_id}] {source.title}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{source.stock_id} · {source.pub_time || '無發布日期'}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs">{source.content}</pre>
              </details>
            ))}
          </details>
        ) : null}
        </div> : null}

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

        {drafts.map((action) => <div className="mt-4" key={action.draft_id}><PaperOrderDraft initial={action} requestId={action.draft_id} /></div>)}
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
