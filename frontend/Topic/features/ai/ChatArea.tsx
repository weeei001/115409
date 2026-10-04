import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { parseChatSources } from '@/lib/types/chat';
import { chatAnswerBody } from '@/lib/utils/chatCitations';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';
import { LoadingRows } from '@/components/common/Notice';
import { LedgerHeading, LightGlyph } from '@/components/common/Ledger';
import { ChatDashboard } from './ChatDashboard';
import { ChatMessage } from './ChatMessage';

/** 範例問題依「示範什麼」分組；caption 是那一組的小標 */
export interface ExampleQuestionGroup {
  caption: string;
  questions: string[];
}

interface Props {
  messages: ChatMessageData[];
  loading: boolean;
  /** 正在接收串流的助理訊息 id */
  streamingMessageId: string | null;
  exampleQuestions: ExampleQuestionGroup[];
  /** 日誌開頭的燈質列：只寫程式確定的事實（登入會保存、訪客不保存） */
  signedIn?: boolean;
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

/** lg 到 1439px：資料欄收在「資料」開關後面（預設收起），訊息欄拿到整個面板寬；1440 以上兩欄並排 */
const COLLAPSIBLE_DATA_QUERY = '(min-width: 1024px) and (max-width: 1439.98px)';

function useMediaMatch(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

type Section = 'answer' | 'citations' | 'data';

/**
 * 對話區：串流新回覆時自動捲到底，使用者往上捲就停止跟隨，回到離底部 80px 內再恢復。
 * 從歷史開啟對話時（不是正在串流）桌機把最新一輪的提問放在訊息欄頂端，資料欄回到頂端。
 * 有資料面板時 1440 以上分兩欄，右欄顯示最近一則有面板的訊息；lg～1439 收進「資料」開關；手機放在對話下方。
 */
export function ChatArea({ messages, loading, streamingMessageId, exampleQuestions, signedIn = false, onSend }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const targetScope = useId();
  const followRef = useRef(true);
  const reduce = usePrefersReducedMotion();
  const dataCollapsible = useMediaMatch(COLLAPSIBLE_DATA_QUERY);
  /** 「資料」開關：只在 lg～1439 有作用，選擇留在元件狀態裡（換對話也保留） */
  const [dataOpen, setDataOpen] = useState(false);
  /** 區塊導覽目前所在的區塊（錨點，不是篩選） */
  const [current, setCurrent] = useState<Section>('answer');
  const scrollKey = messages.map((m) => `${m.id}:${m.content.length}`).join('|');
  const latestUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;
  const dashboardMessage = [...messages].reverse().find((m) => m.dashboard);
  const activeDashboard = dashboardMessage?.dashboard;
  /** 資料欄的燈質：所屬回覆還在串流＝Q、回覆失敗＝熄燈、其餘＝F（只看訊息已有的狀態） */
  const dashboardState = !dashboardMessage ? null
    : dashboardMessage.id === streamingMessageId || dashboardMessage.status === 'streaming' ? 'loading' as const
    : dashboardMessage.status === 'failed' ? 'error' as const : 'ready' as const;
  const hasDashboard = Boolean(activeDashboard);
  const latestAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && chatAnswerBody(m.content).trim());
  const hasSources = Boolean(latestAnswer && parseChatSources(latestAnswer.sources).length);
  const showNavigation = hasDashboard || hasSources || Boolean(latestAnswer && chatAnswerBody(latestAnswer.content).length >= 600);
  const answerId = `chat-answer-${targetScope}`;
  const citationsId = `chat-citations-${targetScope}`;
  const dataId = `chat-data-${targetScope}`;
  const dataPanelId = `chat-data-panel-${targetScope}`;
  const openKey = `${messages[0]?.id ?? ''}|${latestUserId ?? ''}`;

  /**
   * 目前所在區塊：和回答同一個捲動容器裡、頂端已經捲到導覽列下方的最後一個區塊；捲到底時改看最後一個露出來的區塊。
   * 桌機的資料欄自己捲動，不在這裡算（點「資料」時直接標示）。
   */
  const syncCurrent = useCallback(() => {
    const nav = navigationRef.current;
    const answer = document.getElementById(answerId);
    if (!nav || !answer) return;
    const container = getScrollContainer(answer);
    const line = nav.getBoundingClientRect().bottom + 24;
    const viewBottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
    const atEnd = container.scrollHeight - container.clientHeight - container.scrollTop <= 2;
    let next: HTMLElement = answer;
    for (const id of [answerId, citationsId, dataId]) {
      const element = document.getElementById(id);
      if (!element || !element.getClientRects().length || getScrollContainer(element) !== container) continue;
      const top = element.getBoundingClientRect().top;
      if (top <= line || (atEnd && top < viewBottom)) next = element;
    }
    setCurrent(next.id === citationsId ? 'citations' : next.id === dataId ? 'data' : 'answer');
  }, [answerId, citationsId, dataId]);

  const navigate = (id: string, answerColumn: boolean, section: Section) => {
    const target = document.getElementById(id);
    if (!target) return;
    setCurrent(section);
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

  /**
   * 最新一輪的提問換了：
   * - 正在串流（剛送出新問題）→ 恢復跟隨到底；
   * - 沒有串流（從歷史開啟對話）→ 桌機把這一輪的提問捲到訊息欄頂端、資料欄回到頂端，不跟隨到底。
   *   手機是整頁捲動，由 pages/ai 在抽屜關好後把對話開頭帶到頁首下方。
   */
  useEffect(() => {
    followRef.current = true;
    if (!latestUserId || streamingMessageId) return;
    const pane = getScrollContainer(endRef.current);
    if (pane === document.documentElement) return;
    followRef.current = false;
    const frame = requestAnimationFrame(() => {
      const question = pane.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(latestUserId)}"]`);
      if (question) {
        const nav = navigationRef.current;
        const toolbarHeight = nav && pane.contains(nav) ? nav.offsetHeight : 0;
        // 條目進場動畫的位移（translateY）不算進落點
        const transform = getComputedStyle(question).transform;
        const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
        const top = question.getBoundingClientRect().top - shift - pane.getBoundingClientRect().top + pane.scrollTop - toolbarHeight;
        pane.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      }
      asideRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      syncCurrent();
    });
    return () => cancelAnimationFrame(frame);
    // 依賴刻意只放 openKey：只在換了一輪（或換了對話）時決定落點；串流中的內容更新交給下面的跟隨
  }, [openKey]);

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
      syncCurrent();
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
  }, [hasDashboard, syncCurrent]);

  useEffect(() => {
    if (messages.length === 0 && !loading) return;
    const frame = requestAnimationFrame(() => {
      if (followRef.current) {
        const el = getScrollContainer(endRef.current);
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
      }
      syncCurrent();
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollKey, loading, messages.length, syncCurrent]);

  const waitingForReply = loading && messages[messages.length - 1]?.role !== 'assistant';

  const navButtonClass = 'relative min-h-11 border-r px-4 text-sm font-medium text-subtle transition-colors duration-(--dur-flash) hover:bg-accent hover:text-foreground focus-lamp-inset';
  /** 目前所在區塊：墨色粗線壓在導覽列底線上（不用燈色） */
  const currentClass = 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground';
  const anchorProps = (section: Section) => ({
    'aria-current': current === section ? ('location' as const) : undefined,
    className: cn(navButtonClass, current === section && currentClass),
  });

  return (
    <div
      className={cn(
        // 手機的輸入列固定在視窗底部：鍵盤 focus 或 scrollIntoView 帶到的元素要停在它上方，不被蓋住
        'min-w-0 flex-none overflow-visible max-lg:[&_*]:scroll-mb-40 lg:min-h-0 lg:flex-1 lg:overflow-hidden',
        hasDashboard
          ? cn('lg:grid',
            // 1440 以上兩欄並排；lg～1439 只有展開「資料」時才分兩欄，收起時訊息欄獨佔整列
            dataOpen ? 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]' : 'lg:max-[1440px]:grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]',
            showNavigation ? 'lg:grid-rows-[auto_minmax(0,1fr)]' : 'lg:grid-rows-1')
          : 'lg:overflow-y-auto lg:overscroll-y-contain',
      )}
    >
      {showNavigation ? <nav ref={navigationRef} aria-label="回答區塊導覽"
        className="sticky top-[var(--app-header-height)] z-10 flex flex-wrap border-b bg-card lg:top-0 lg:col-span-full">
        {latestAnswer ? <button type="button" aria-controls={answerId} onClick={() => navigate(answerId, true, 'answer')}
          {...anchorProps('answer')}>回答</button> : null}
        {hasSources ? <button type="button" aria-controls={citationsId} onClick={() => navigate(citationsId, true, 'citations')}
          {...anchorProps('citations')}>引用</button> : null}
        {activeDashboard ? (dataCollapsible ? (
          // lg～1439：「資料」是開關（展開／收起右側資料欄），不是錨點；燈質記號照樣標出資料狀態
          <button type="button" aria-expanded={dataOpen} aria-controls={dataPanelId} onClick={() => setDataOpen((open) => !open)}
            className={cn(navButtonClass, 'ml-auto inline-flex items-center gap-2 border-r-0 border-l', dataOpen && 'bg-accent text-foreground')}>
            {dataOpen ? <PanelRightClose size={16} className="shrink-0" aria-hidden /> : <PanelRightOpen size={16} className="shrink-0" aria-hidden />}
            資料
            {dashboardState ? <LightGlyph state={dashboardState} /> : null}
          </button>
        ) : <button type="button" aria-controls={dataId} onClick={() => navigate(dataId, false, 'data')}
          {...anchorProps('data')}>資料</button>) : null}
      </nav> : null}
      <div className={cn('flex min-w-0 flex-col', hasDashboard && 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain')}>
        {showNavigation && latestAnswer ? <h2 className="sr-only">回答</h2> : null}
        {messages.length === 0 && !loading ? (
          <motion.div
            className="flex flex-1 flex-col px-4 py-4 sm:px-5 sm:py-6"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.625, ease: [0.2, 0, 0, 1] }}
          >
            {/*
              值班日誌：帳頁標題＋一行燈質列（範例問題的說明）＋粗線，底下直接是有線的範例條目。
              不放歡迎句；分組名寫在左側欄（sm 以上），像日誌的分類欄，手機只留條目。
            */}
            <div className="mx-auto w-full max-w-2xl">
              <LedgerHeading title="值班日誌" stamp={`範例問題 · ${signedIn ? '已登入，對話會保存' : '訪客，離頁不保存'}`} />
              {exampleQuestions.some((group) => group.questions.length) ? (
                <div className="divide-y border-b" role="group" aria-label="範例問題">
                  {exampleQuestions.filter((group) => group.questions.length).map((group) => (
                    <div key={group.caption} role="group" aria-label={group.caption} className="sm:grid sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                      <p className="characteristic hidden pt-3.5 pr-3 sm:block" aria-hidden>{group.caption}</p>
                      <div className="divide-y">
                        {group.questions.map((q, idx) => (
                          <button
                            key={`${idx}-${q}`}
                            type="button"
                            onClick={() => onSend(q)}
                            className="lamp-row group flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-foreground focus-lamp-inset"
                          >
                            <span className="min-w-0">{q}</span>
                            {/* 整列就是按鈕；箭頭只在 hover／鍵盤 focus 時出現，平常不和站內換頁列混在一起 */}
                            <ArrowRight size={16} className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--dur-flash) group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
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
            className="border-b bg-card px-4 py-4 sm:px-5"
            aria-live="polite"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            <p className="characteristic">AI 回覆</p>
            {/* 載入＝燈質 Q：有線的空白列加一道掃過的光帶 */}
            <LoadingRows label="正在查詢與整理系統資料…" className="mt-2 h-[88px] border" />
          </motion.div>
        ) : null}
        <div ref={endRef} className="h-0 shrink-0" aria-hidden />
      </div>

      {activeDashboard ? (
        <aside
          ref={asideRef}
          id={dataPanelId}
          aria-label="分析資料面板"
          className={cn(
            'min-w-0 border-t border-border-strong bg-card px-4 py-4 sm:px-5 sm:py-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:border-t-0 lg:border-l lg:border-l-border',
            // lg～1439 收起時不顯示（CSS 決定，伺服器輸出與第一次繪製也一致）
            !dataOpen && 'lg:max-[1440px]:hidden',
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <LedgerHeading title="資料" headingProps={{ id: dataId, tabIndex: -1, className: 'focus:outline-2 focus:outline-offset-2 focus:outline-focus' }} />
            {dashboardState ? (
              <span className="characteristic inline-flex items-center gap-1.5 text-foreground">
                <LightGlyph state={dashboardState} />
                <span className="text-muted-foreground">{{ loading: '整理中', ready: `${activeDashboard.blocks.length} 個區塊`, error: '回覆失敗' }[dashboardState]}</span>
              </span>
            ) : null}
          </div>
          <ChatDashboard dashboard={activeDashboard} />
        </aside>
      ) : null}
    </div>
  );
}
