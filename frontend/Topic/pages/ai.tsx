import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Bot } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { ConversationHistory } from '@/features/ai/ConversationHistory';
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
  const router = useRouter();
  const initialPrompt = typeof router.query.prompt === 'string' ? router.query.prompt.slice(0, 6000) : '';

  return (
    <div className="flex min-h-[100dvh] flex-col lg:min-h-0 lg:flex-1">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta name="description" content="在 AI 對話中掌握個股分析、多股比較、技術指標、新聞與系統功能，直接點選建議問題繼續探索。" />
      </Head>
      <SiteHeader icon={Bot} title="AI 對話" subtitle="個股、多股比較、技術指標與新聞重點（不構成投資建議）" />

      <main aria-label="AI 對話" className="mx-auto flex w-full max-w-7xl flex-col px-4 py-3 sm:px-6 sm:py-6 lg:min-h-0 lg:flex-1 lg:px-8">
        <div className="mx-auto flex w-full flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <ConversationHistory signedIn={chat.signedIn} ready={chat.ready} items={chat.conversations}
            selectedId={chat.conversationId} search={chat.search} loading={chat.historyLoading}
            error={chat.historyError} hasMore={chat.hasMore} onSearch={chat.setSearch}
            onOpen={chat.openConversation} onNew={chat.newConversation} onRetry={chat.refreshHistory} onMore={chat.loadMore} />
          <div className="flex min-w-0 w-full flex-col overflow-visible rounded-xl border bg-card shadow-raised lg:max-h-[calc(100dvh-var(--app-header-height)-4rem-var(--app-safe-area-bottom))] lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
              <p role="status">{chat.notice ?? (chat.signedIn ? '對話自動儲存於帳號，可從歷史清單開啟並繼續提問。' : '訪客對話僅在目前頁面顯示，登入後可儲存歷史對話。')}</p>
            </div>
            <ChatArea
              messages={chat.messages}
              loading={chat.loading}
              streamingMessageId={chat.streamingMessageId}
              exampleQuestions={EXAMPLE_QUESTIONS}
              onSend={chat.send}
            />
            <div className="shrink-0">
              <ChatInput key={`${chat.conversationId ?? 'new'}:${initialPrompt}`} initialValue={chat.conversationId ? '' : initialPrompt} onSend={(text) => {
                if (initialPrompt) void router.replace('/ai', undefined, { shallow: true });
                chat.send(text);
              }} disabled={chat.loading || !chat.ready}
                onStop={chat.streamingMessageId ? chat.stop : undefined} stopNotice={chat.stopNotice} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
