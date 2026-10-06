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
import { useIsMobile } from '@/lib/hooks/useClientEnv';
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
        const toolbar = latest ? column.querySelector<HTMLElement>('nav[aria-label="回答區塊導覽"]')?.offsetHeight ?? 0 : 0;
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
  /** 對話已開啟：lg 以上收起對話欄頂端的說明列、縮小面板上下的留白，把高度留給訊息與資料 */
  const conversationOpen = chat.messages.length > 0 || chat.loading;
  /** lg 以上且對話已開啟：收起頁首副標（手機整頁捲動，維持原樣） */
  const compactChrome = conversationOpen && !isMobile;

  return (
    /*
     * lg 以上：整頁剛好一個視窗高（頁首＋標題區＋對話面板），面板吃掉剩下的高度、
     * 訊息欄與資料欄各自在面板裡捲動，輸入列固定在面板底部。頁尾在視窗下方，往下捲才看到。
     */
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh] lg:min-h-[34rem] lg:flex-none">
      <Head>
        <title>股海明燈｜AI 對話</title>
        <meta name="description" content="在 AI 對話中掌握個股分析、多股比較、技術指標、新聞與系統功能，直接點選建議問題繼續探索。" />
      </Head>
      {/* 對話開啟後（lg 以上）收起副標：免責已固定在輸入列下方，高度留給訊息 */}
      <SiteHeader title="AI 對話" subtitle={compactChrome ? undefined : '個股、比較、指標與新聞重點（非投資建議）'} />

      <main aria-label="AI 對話" className={cn(
        'mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-4 pt-4 sm:px-6 lg:min-h-0 lg:px-10',
        // 對話開啟：面板直接接在標題區粗線下、貼齊視窗底，不留上下空白
        conversationOpen ? 'lg:py-0' : 'lg:py-5',
      )}>
        {/* 值班日誌：lg 以上左欄是日誌索引、右欄是對話，兩欄之間用 1px 線分隔；手機的日誌索引收進抽屜，對話先出現 */}
        <div className={cn(
          'flex w-full flex-1 flex-col gap-px border border-b-0 bg-border lg:max-h-[calc(100dvh-var(--app-header-height)-1.5rem)] lg:min-h-0 lg:flex-1 lg:flex-row lg:border-b',
          // 上緣改由標題區的粗線充當，避免兩條線疊在一起
          conversationOpen && 'lg:border-t-0',
        )}>
          <div className="hidden lg:flex lg:min-h-0">
            <ConversationHistory {...historyProps} onOpen={chat.openConversation} onNew={chat.newConversation} />
          </div>
          <div ref={columnRef} className="flex w-full min-w-0 flex-1 flex-col overflow-visible bg-card lg:min-h-0 lg:overflow-hidden">
            {/* 說明列：對話開啟後在 lg 以上收起（仍留給螢幕報讀器，出現提示時再展開） */}
            <div className={cn('flex min-h-11 shrink-0 items-center gap-3 border-b px-4 py-2 sm:px-5', conversationOpen && !chat.notice && 'lg:sr-only')}>
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
            <ChatArea
              messages={chat.messages}
              loading={chat.loading}
              streamingMessageId={chat.streamingMessageId}
              exampleQuestions={EXAMPLE_QUESTIONS}
              signedIn={chat.signedIn}
              onSend={chat.send}
            />
            {/* 輸入列（含免責）固定在底部：手機黏在視窗底部、閃開底部手勢區；lg 以上是固定高度面板的最後一列 */}
            <div className="sticky bottom-0 z-20 mt-auto shrink-0">
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
