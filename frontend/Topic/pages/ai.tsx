import React from 'react';
import Head from 'next/head';
import { Bot } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { ChatArea } from '@/features/ai/ChatArea';
import { ChatInput } from '@/features/ai/ChatInput';
import { useChat } from '@/features/ai/useChat';

const EXAMPLE_QUESTIONS = [
  '整理台積電的走勢、法人與營收重點',
  '比較台積電、聯發科與鴻海的報酬和風險',
  '用 KD 和量價分析台積電目前的走勢',
  '最近有哪些影響台股的新聞？',
  '這個系統可以幫我做什麼？',
];

export default function AiPage() {
  const chat = useChat();

  return (
    <div className="flex min-h-[100dvh] flex-col lg:min-h-0 lg:flex-1">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta name="description" content="在 AI 對話中掌握個股分析、多股比較、技術指標、新聞與系統功能，直接點選建議問題繼續探索。" />
      </Head>
      <SiteHeader icon={Bot} title="AI 對話" subtitle="個股、多股比較、技術指標與新聞重點（不構成投資建議）" />

      <main aria-label="AI 對話" className="mx-auto flex w-full max-w-7xl flex-col px-4 py-3 sm:px-6 sm:py-6 lg:min-h-0 lg:flex-1 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col lg:min-h-0 lg:flex-1">
          <div className="flex w-full flex-col overflow-visible rounded-xl border bg-card shadow-raised lg:max-h-[calc(100dvh-var(--app-header-height)-4rem-var(--app-safe-area-bottom))] lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
              <p role="status">{chat.cacheNotice ?? '對話保留於本分頁；登出或切換帳號會清除。'}</p>
              <button type="button" onClick={chat.clear} disabled={!chat.ready || !chat.messages.length}
                className="min-h-11 shrink-0 rounded-lg border px-3 text-sm text-subtle hover:bg-accent disabled:opacity-50">清除對話</button>
            </div>
            <ChatArea
              messages={chat.messages}
              loading={chat.loading}
              streamingMessageId={chat.streamingMessageId}
              exampleQuestions={EXAMPLE_QUESTIONS}
              onSend={chat.send}
            />
            <div className="shrink-0">
              <ChatInput onSend={chat.send} disabled={chat.loading || !chat.ready} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
