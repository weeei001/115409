import React, { useEffect, useId, useRef } from 'react';
import { motion } from 'motion/react';
import { Bot } from 'lucide-react';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { parseChatSources } from '@/lib/types/chat';
import { chatAnswerBody } from '@/lib/utils/chatCitations';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';
import { ChatDashboard } from './ChatDashboard';
import { ChatMessage } from './ChatMessage';

interface Props {
  messages: ChatMessageData[];
  loading: boolean;
  /** 正在接收串流的助理訊息 id */
  streamingMessageId: string | null;
  exampleQuestions: string[];
  onSend: (text: string) => void;
}

/** 往上找第一個會捲動的容器（桌機是對話欄，手機是整頁） */
function getScrollContainer(marker: HTMLElement | null): HTMLElement {
  let element = marker?.parentElement;
  while (element && element !== document.body) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return document.documentElement;
}

function ThinkingDots() {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-2 rounded-full bg-brand" style={{ animation: 'thinking-dot 1.4s ease-in-out infinite', animationDelay: `${i * 180}ms` }} />
      ))}
    </div>
  );
}

/**
 * 對話區：自動捲到底，使用者往上捲就停止跟隨，回到離底部 80px 內再恢復。
 * 有資料面板時桌機分兩欄，右欄顯示最近一則有面板的訊息；手機放在對話下方。
 */
export function ChatArea({ messages, loading, streamingMessageId, exampleQuestions, onSend }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const targetScope = useId();
  const followRef = useRef(true);
  const reduce = usePrefersReducedMotion();
  const scrollKey = messages.map((m) => `${m.id}:${m.content.length}`).join('|');
  const latestUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;
  const activeDashboard = [...messages].reverse().find((m) => m.dashboard)?.dashboard;
  const hasDashboard = Boolean(activeDashboard);
  const latestAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && chatAnswerBody(m.content).trim());
  const hasSources = Boolean(latestAnswer && parseChatSources(latestAnswer.sources).length);
  const showNavigation = hasDashboard || hasSources || Boolean(latestAnswer && chatAnswerBody(latestAnswer.content).length >= 600);
  const answerId = `chat-answer-${targetScope}`;
  const citationsId = `chat-citations-${targetScope}`;
  const dataId = `chat-data-${targetScope}`;

  const navigate = (id: string, answerColumn: boolean) => {
    const target = document.getElementById(id);
    if (!target) return;
    if (answerColumn) followRef.current = false;
    if (id === citationsId) {
      const rawSources = target.querySelector('details');
      if (rawSources) rawSources.open = true;
    }
    const container = getScrollContainer(target);
    const toolbarHeight = container.contains(navigationRef.current) ? navigationRef.current?.offsetHeight ?? 0 : 0;
    const top = target.getBoundingClientRect().top + container.scrollTop
      - (container === document.documentElement ? 0 : container.getBoundingClientRect().top) - toolbarHeight;
    target.focus({ preventScroll: true });
    container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  };

  // 使用者送出新訊息就恢復跟隨
  useEffect(() => {
    followRef.current = true;
  }, [latestUserId]);

  useEffect(() => {
    const position = () => {
      const el = getScrollContainer(endRef.current);
      return { top: el.scrollTop, remaining: el.scrollHeight - el.clientHeight - el.scrollTop };
    };
    let previousTop = position().top;
    const onScroll = (event: Event) => {
      // 資料面板等獨立捲動的區塊不算
      if (event.target instanceof Element && !event.target.contains(endRef.current)) return;
      const { top, remaining } = position();
      if (top < previousTop - 1) followRef.current = false;
      else if (remaining <= 80) followRef.current = true;
      previousTop = top;
    };
    const onResize = () => {
      previousTop = position().top;
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [hasDashboard]);

  useEffect(() => {
    if (messages.length === 0 && !loading) return;
    const frame = requestAnimationFrame(() => {
      if (!followRef.current) return;
      const el = getScrollContainer(endRef.current);
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollKey, loading, messages.length]);

  const waitingForReply = loading && messages[messages.length - 1]?.role !== 'assistant';

  return (
    <div
      className={cn(
        'min-w-0 flex-none overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-hidden',
        hasDashboard ? cn('lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]', showNavigation ? 'lg:grid-rows-[auto_minmax(0,1fr)]' : 'lg:grid-rows-1') : 'lg:overflow-y-auto',
      )}
    >
      {showNavigation ? <nav ref={navigationRef} aria-label="回答區塊導覽"
        className="sticky top-0 z-10 flex flex-wrap gap-2 border-b bg-card px-4 py-2 lg:col-span-2">
        {latestAnswer ? <button type="button" aria-controls={answerId} onClick={() => navigate(answerId, true)}
          className="min-h-11 rounded-lg border px-3 text-sm text-brand-text hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">回答</button> : null}
        {hasSources ? <button type="button" aria-controls={citationsId} onClick={() => navigate(citationsId, true)}
          className="min-h-11 rounded-lg border px-3 text-sm text-brand-text hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">引用</button> : null}
        {activeDashboard ? <button type="button" aria-controls={dataId} onClick={() => navigate(dataId, false)}
          className="min-h-11 rounded-lg border px-3 text-sm text-brand-text hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">資料</button> : null}
      </nav> : null}
      <div className={cn('flex min-w-0 flex-col gap-4 px-4 py-3 sm:py-6', hasDashboard && 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain')}>
        {showNavigation && latestAnswer ? <h2 className="text-sm font-semibold text-subtle">回答</h2> : null}
        {messages.length === 0 && !loading ? (
          <motion.div
            className="flex flex-1 flex-col items-center justify-center py-3 text-center sm:py-12"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-accent">
              <Bot size={28} className="text-brand" aria-hidden />
            </div>
            <p className="mb-1 text-sm text-subtle">說出想了解的事，整理成你的分析畫面</p>
            <p className="mb-6 text-xs text-muted-foreground">個股走勢、比較表、指標與新聞，連同解讀直接顯示在對話中</p>
            <div className="flex max-w-lg flex-wrap justify-center gap-2 px-2" role="group" aria-label="範例問題">
              {exampleQuestions.map((q, idx) => (
                <button
                  key={`${idx}-${q}`}
                  type="button"
                  onClick={() => onSend(q)}
                  className="min-h-11 rounded-xl border bg-muted px-3 py-2.5 text-left text-xs text-subtle transition-colors hover:border-border-strong hover:bg-accent hover:text-brand-text sm:text-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            reducedMotion={reduce}
            onFollowUp={onSend}
            followUpDisabled={loading}
            streamActive={msg.role === 'assistant' && msg.id === streamingMessageId}
            answerTargetId={msg.id === latestAnswer?.id ? answerId : undefined}
            citationsTargetId={msg.id === latestAnswer?.id && hasSources ? citationsId : undefined}
          />
        ))}

        {waitingForReply ? (
          <motion.div
            className="flex gap-3"
            role="status"
            aria-live="polite"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient">
              <Bot size={16} className="text-on-brand" aria-hidden />
            </div>
            <div className="flex-1 rounded-2xl border bg-card px-4 py-3 shadow-card">
              <p className="mb-2 text-xs text-muted-foreground">正在查詢與整理系統資料…</p>
              <ThinkingDots />
            </div>
          </motion.div>
        ) : null}
        <div ref={endRef} className="h-0 shrink-0" aria-hidden />
      </div>

      {activeDashboard ? (
        <aside
          aria-label="分析資料面板"
          className="min-w-0 border-t bg-card px-4 py-4 sm:px-5 sm:py-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:border-t-0 lg:border-l"
        >
          <h2 id={dataId} tabIndex={-1} className="mb-3 rounded text-sm font-semibold text-subtle focus:outline-2 focus:outline-offset-2">資料</h2>
          <ChatDashboard dashboard={activeDashboard} />
        </aside>
      ) : null}
    </div>
  );
}
