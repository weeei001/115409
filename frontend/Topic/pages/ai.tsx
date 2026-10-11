import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { History } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ConversationHistory } from '@/features/ai/ConversationHistory';
import { ChatArea, type ExampleQuestionGroup } from '@/features/ai/ChatArea';
import { ChatInput } from '@/features/ai/ChatInput';
import { useChat } from '@/features/ai/useChat';
import { useHydrated, useIsMobile, useMediaQuery } from '@/lib/hooks/useClientEnv';
import { parseFlag, serializeFlag, useStoredPreference } from '@/lib/hooks/useStoredPreference';
import { HISTORY_COLLAPSED_KEY } from '@/features/ai/layout';
import { cn } from '@/lib/cn';

/** 範例問題依示範的內容分組（只放原有的五則，不新增能力） */
const EXAMPLE_QUESTIONS: ExampleQuestionGroup[] = [
  { caption: '個股與指標', questions: ['整理台積電的走勢、法人與營收重點', '用 KD 和量價分析台積電目前的走勢'] },
  { caption: '多股比較', questions: ['比較台積電、聯發科與鴻海的報酬和風險'] },
  { caption: '新聞與使用說明', questions: ['最近有哪些影響台股的新聞？', '這個網站可以幫我做什麼？'] },
];

export default function AiPage() {
  const chat = useChat();
  const router = useRouter();
  /** 其他頁（例如模擬投資）用 /ai?prompt= 帶入的預填問題；只在新對話時填入輸入框 */
  const initialPrompt = typeof router.query.prompt === 'string' ? router.query.prompt.slice(0, 6000) : '';
  const isMobile = useIsMobile();
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * lg 以上的歷史欄收合成細條：使用者按過就照他的選擇（記在這個瀏覽器）；沒按過時 1440 以上展開、以下收合，
   * 筆電寬度把空間留給對話與資料。掛載前一律展開（避免大螢幕先收再展開）。
   */
  const hydrated = useHydrated();
  const wide = useMediaQuery('(min-width: 1440px)');
  const [historyPref, storeHistoryPref] = useStoredPreference(HISTORY_COLLAPSED_KEY, parseFlag, serializeFlag);
  const historyCollapsed = historyPref ?? (hydrated && !wide);
  const columnRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * 從抽屜開啟對話後，把視窗帶到這則對話的開頭（頁首下方），而不是整頁最底的資料面板。
   * 抽屜關閉動畫期間 Radix 鎖住頁面捲動，所以要等「訊息到了」與「抽屜關好」兩件事都成立才捲。
   */
  const revealRef = useRef<{ target: string | null; sheetBusy: boolean }>({ target: null, sheetBusy: false });
  const latestRef = useRef({ id: chat.conversationId, count: chat.messages.length });
  const revealFrames = useRef<number[]>([]);
  const tryReveal = () => {
    const pending = revealRef.current;
    const { id, count } = latestRef.current;
    if (!pending.target || pending.sheetBusy || pending.target !== id || !count) return;
    pending.target = null;
    // 等 ChatArea 的自動跟隨（下一個 frame）跑完再捲
    revealFrames.current.forEach(cancelAnimationFrame);
    revealFrames.current = [requestAnimationFrame(() => {
      revealFrames.current.push(requestAnimationFrame(() => {
        const column = columnRef.current;
        if (!column) return;
        // 頁首高度可能是 rem（樣式表）或 px（頁首量測後寫入）
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height').trim();
        const header = (raw.endsWith('rem') ? parseFloat(raw) * 16 : parseFloat(raw)) || 56;
        // 多輪對話落在最新一輪的提問（扣掉 sticky 的區塊導覽）；只有一輪時落在對話欄開頭，「歷史對話」鈕也在視窗內
        const questions = column.querySelectorAll<HTMLElement>('[data-message-role="user"]');
        const latest = questions.length > 1 ? questions[questions.length - 1] : null;
        const toolbar = latest ? column.querySelector<HTMLElement>('[data-chat-toolbar]')?.offsetHeight ?? 0 : 0;
        // 條目進場動畫的位移（translateY）不算進落點
        const transform = latest ? getComputedStyle(latest).transform : 'none';
        const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
        const top = (latest ?? column).getBoundingClientRect().top - shift + window.scrollY - header - toolbar;
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      }));
    })];
  };

  // 換成 lg 以上的版面時，歷史對話回到左欄，抽屜要關掉
  useEffect(() => {
    if (!isMobile) setHistoryOpen(false);
  }, [isMobile]);

  /** 小燈面板的「在 AI 對話頁開啟」用 /ai?c=對話 ID 帶過來：登入狀態確認後開啟，再把參數從網址拿掉 */
  const openId = typeof router.query.c === 'string' ? router.query.c : null;
  const { openConversation } = chat;
  const handledOpenId = useRef<string | null>(null);
  useEffect(() => {
    if (!router.isReady || !openId || !chat.ready || handledOpenId.current === openId) return;
    handledOpenId.current = openId;
    if (chat.signedIn && /^[0-9a-f-]{36}$/i.test(openId)) void openConversation(openId);
    const query = { ...router.query };
    delete query.c;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [router, openId, chat.ready, chat.signedIn, openConversation]);

  useEffect(() => {
    latestRef.current = { id: chat.conversationId, count: chat.messages.length };
    // 開啟失敗（出現提示）就不再等
    if (chat.notice) revealRef.current.target = null;
    tryReveal();
  });

  useEffect(() => () => revealFrames.current.forEach(cancelAnimationFrame), []);

  const historyProps = {
    signedIn: chat.signedIn, ready: chat.ready, items: chat.conversations, selectedId: chat.conversationId,
    search: chat.search, loading: chat.historyLoading, error: chat.historyError, hasMore: chat.hasMore,
    onSearch: chat.setSearch, onRetry: chat.refreshHistory, onMore: chat.loadMore,
  };
  // 抽屜裡選了對話或開新對話就關閉，焦點回到「歷史對話」鈕（見 onCloseAutoFocus）
  const openFromSheet = (id: string) => {
    revealRef.current = { target: id, sheetBusy: true };
    setHistoryOpen(false);
    chat.openConversation(id);
  };
  const newFromSheet = () => {
    setHistoryOpen(false);
    chat.newConversation();
  };
  const count = chat.signedIn && chat.conversations.length ? chat.conversations.length : 0;
  /** 對話欄標題列（lg 以上）：歷史清單裡的名稱；還沒存進清單（訪客、剛送出的新對話）就用第一個提問 */
  const conversationTitle = chat.conversations.find((item) => item.id === chat.conversationId)?.title
    || chat.messages.find((message) => message.role === 'user')?.content.trim().replace(/\s+/g, ' ')
    || '新對話';

  return (
    /*
     * lg 以上是全螢幕工作台：頁首下方直接是工作台（標題區只留給螢幕報讀器、沒有頁尾），剛好一個視窗高，整頁不捲動。
     * 工作台四周留一圈頁面底色；歷史欄、對話欄、資料欄各自捲動，輸入列固定在對話欄底部。
     * 手機維持整頁捲動：標題區、對話、資料、固定在視窗底部的輸入列。
     */
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:min-h-[36rem]">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta name="description" content="在 AI 對話中掌握個股分析、多股比較、技術指標、新聞與系統功能，直接點選建議問題繼續探索。" />
      </Head>
      <SiteHeader title="AI 對話" subtitle="個股、比較、指標與新聞重點" workspace />

      <main aria-label="AI 對話" className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-4 pt-4 sm:px-6 lg:max-w-none lg:min-h-0 lg:p-4">
        {/*
          值班日誌：lg 以上左欄是日誌索引、右邊是對話與資料，欄與欄之間用 1px 線分隔；手機的日誌索引收進抽屜，對話先出現。
          工作台裡好幾個欄位各自捲動，捲軸樣式用全站那一組（styles/main.css）
        */}
        <div className="flex w-full flex-1 flex-col gap-px border border-b-0 bg-border lg:min-h-0 lg:flex-row lg:border-b">
          <div className="hidden lg:flex lg:min-h-0">
            <ConversationHistory {...historyProps} onOpen={chat.openConversation} onNew={chat.newConversation}
              collapsed={historyCollapsed} onToggleCollapsed={() => storeHistoryPref(!historyCollapsed)} />
          </div>
          <div ref={columnRef} className="flex w-full min-w-0 flex-1 flex-col bg-card lg:min-h-0 lg:overflow-hidden">
            <ChatArea
              messages={chat.messages}
              loading={chat.loading}
              streamingMessageId={chat.streamingMessageId}
              exampleQuestions={EXAMPLE_QUESTIONS}
              signedIn={chat.signedIn}
              onSend={chat.send}
              onRate={chat.rate}
              title={conversationTitle}
              status={
                /* 說明列：lg 以上只在出現提示時顯示（儲存方式已寫在值班日誌與歷史欄；仍留給螢幕報讀器） */
                <div className={cn('flex min-h-11 shrink-0 items-center gap-3 border-b px-4 py-2 sm:px-5 lg:px-6', !chat.notice && 'lg:sr-only')}>
                  <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
                    <SheetTrigger asChild>
                      <Button ref={triggerRef} type="button" variant="outline" className="-my-1 lg:hidden">
                        <History className="size-[18px] text-muted-foreground" aria-hidden />
                        歷史對話
                        {count ? <>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-hidden>{count}{chat.hasMore ? '+' : ''}</span>
                          <span className="sr-only">（已載入 {count} 則{chat.hasMore ? '，還有更多' : ''}）</span>
                        </> : null}
                      </Button>
                    </SheetTrigger>
                    <SheetContent
                      side="left"
                      closeLabel="關閉歷史對話"
                      className="w-full gap-0 border-r border-border-strong bg-card p-0 pt-[var(--app-safe-area-top)] pb-[var(--app-safe-area-bottom)] sm:max-w-sm"
                      onOpenAutoFocus={(event) => {
                        // 打開時焦點放在目前的對話（沒有就交給抽屜本身），不要落在「新增對話」上
                        event.preventDefault();
                        const content = event.currentTarget as HTMLElement | null;
                        (content?.querySelector<HTMLElement>('[aria-current="true"]') ?? content)?.focus();
                      }}
                      onCloseAutoFocus={(event) => {
                        // 焦點回到「歷史對話」鈕，但不要為了它捲動視窗（剛開啟的對話由上面的 effect 決定位置）
                        event.preventDefault();
                        triggerRef.current?.focus({ preventScroll: true });
                        revealRef.current.sheetBusy = false;
                        tryReveal();
                      }}
                    >
                      <SheetTitle className="sr-only">歷史對話</SheetTitle>
                      <SheetDescription className="sr-only">選一則對話繼續提問，或開新對話。</SheetDescription>
                      <ConversationHistory {...historyProps} variant="sheet" onOpen={openFromSheet} onNew={newFromSheet} />
                    </SheetContent>
                  </Sheet>
                  <span className="hidden size-1.5 shrink-0 rounded-full bg-muted-foreground lg:block" aria-hidden />
                  <p role="status" className="min-w-0 text-xs leading-relaxed text-muted-foreground">{chat.notice ?? (chat.signedIn ? '對話自動儲存於帳號，可從歷史清單開啟並繼續提問。' : '訪客對話僅在目前頁面顯示，登入後可儲存歷史對話。')}</p>
                </div>
              }
              composer={
                <ChatInput key={`${chat.conversationId ?? 'new'}:${initialPrompt}`} initialValue={chat.conversationId ? '' : initialPrompt} onSend={(text) => {
                  if (initialPrompt) void router.replace('/ai', undefined, { shallow: true });
                  chat.send(text);
                }} disabled={chat.loading || !chat.ready}
                  onStop={chat.streamingMessageId ? chat.stop : undefined} stopNotice={chat.stopNotice} />
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}
