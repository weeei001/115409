import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { parseChatSources } from '@/lib/types/chat';
import { CHAT_CITATION_RE, chatAnswerBody, citationLabels } from '@/lib/utils/chatCitations';
import { useMediaQuery, usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useStoredPreference } from '@/lib/hooks/useStoredPreference';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { LoadingRows } from '@/components/common/Notice';
import { LedgerHeading, LightGlyph } from '@/components/common/Ledger';
import { ChatDashboard } from './ChatDashboard';
import { ChatMessage } from './ChatMessage';
import { CHAT_COLUMN, DATA_RATIO_DEFAULT, DATA_RATIO_KEY, clampDataRatio, parseDataRatio } from './layout';

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
  /** 回饋這則回覆（有幫助／沒幫助，null 取消）；不傳就不顯示回饋鈕 */
  onRate?: (messageId: string, rating: 'up' | 'down' | null) => void;
  /** lg 以上對話欄標題列的標題（目前對話的名稱） */
  title?: string;
  /** 對話欄最上方的說明列（提示、手機的歷史對話鈕） */
  status?: ReactNode;
  /** 輸入列：手機固定在視窗底部，lg 以上固定在對話欄底部 */
  composer?: ReactNode;
}

/** 往上找第一個會捲動的容器（桌機是訊息欄，手機是整頁） */
function getScrollContainer(marker: HTMLElement | null): HTMLElement {
  let element = marker?.parentElement;
  while (element && element !== document.body) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return document.documentElement;
}

/** 手機區塊導覽列的高度（min-h-11＋底線）：導覽列還沒出現時先預留，它出現後回覆開頭才不會被蓋住 */
const NAV_RESERVE = 45;

/**
 * 元素頂端要捲到的位置：手機整頁捲動時扣掉頁首與黏在上方的區塊導覽，也不算條目進場動畫的位移。
 * lg 以上的標題列在訊息欄外面，不用扣。reserveNav：手機的導覽列還沒出現時也先扣掉它的高度。
 */
function scrollTopFor(element: HTMLElement, container: HTMLElement, nav: HTMLElement | null, reserveNav = false): number {
  const transform = getComputedStyle(element).transform;
  const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
  const isPage = container === document.documentElement;
  // 頁首高度可能是 rem（樣式表）或 px（頁首量測後寫入），同 pages/ai 的換算
  const raw = isPage ? getComputedStyle(container).getPropertyValue('--app-header-height').trim() : '';
  const header = isPage ? (raw.endsWith('rem') ? parseFloat(raw) * parseFloat(getComputedStyle(container).fontSize) : parseFloat(raw)) || 0 : 0;
  const navHeight = nav && container.contains(nav) ? nav.offsetHeight : 0;
  const toolbar = navHeight || (reserveNav && isPage ? NAV_RESERVE : 0);
  const origin = isPage ? 0 : container.getBoundingClientRect().top;
  return element.getBoundingClientRect().top - shift - origin + container.scrollTop - header - toolbar;
}

/** lg 以上是工作台版面：訊息欄、資料欄各自捲動，中間的分隔線可以拖曳 */
const DESKTOP_QUERY = '(min-width: 1024px)';

type Section = 'answer' | 'citations' | 'data';
/** 資料欄：並排（預設）、放大蓋住對話欄、收起 */
type DataView = 'split' | 'max' | 'hidden';

/**
 * 對話區：串流新回覆時自動往下跟隨，跟到這則回覆的開頭碰到上緣就停（長回覆完成後停在開頭，不用往回捲）；
 * 使用者往上捲就停止跟隨，回到離底部 80px 內再恢復（那之後照常跟到底）。
 * 從歷史開啟對話時（不是正在串流）桌機把最新一輪的提問放在訊息欄頂端，資料欄回到頂端。
 *
 * lg 以上是工作台：左邊對話欄（說明列、標題列、訊息、輸入列），右邊資料欄（最近一則有面板的訊息）從頂端到底。
 * 兩欄之間的分隔線可拖曳、可用方向鍵調整，寬度記在這個瀏覽器；資料欄可放大蓋住對話欄（Esc 還原）或收起。
 * 手機依序是說明列、區塊導覽、訊息、資料、輸入列，整頁捲動。
 */
export function ChatArea({ messages, loading, streamingMessageId, exampleQuestions, signedIn = false, onSend, onRate, title, status, composer }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dataBodyRef = useRef<HTMLDivElement>(null);
  const dataToggleRef = useRef<HTMLButtonElement>(null);
  const targetScope = useId();
  const followRef = useRef(true);
  /** 已經停在開頭的串流回覆 id：使用者自己捲回底部後，這則就照常跟到底 */
  const pinnedRef = useRef<string | null>(null);
  const streamingRef = useRef(streamingMessageId);
  streamingRef.current = streamingMessageId;
  /** 自動跟隨剛捲到的位置：它觸發的 scroll 事件不算使用者操作（不然停在開頭時離底部不到 80px 會又開始跟隨） */
  const autoTopRef = useRef<number | null>(null);
  const reduce = usePrefersReducedMotion();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  /** 資料欄的顯示方式：只在 lg 以上有作用，留在元件狀態裡（換對話也保留） */
  const [dataView, setDataView] = useState<DataView>('split');
  const [storedRatio, storeRatio] = useStoredPreference(DATA_RATIO_KEY, parseDataRatio);
  /** 對話欄＋資料欄的總寬：用來把比例夾在兩欄的最小寬度之間（分隔線的 aria 數值也用它） */
  const [gridWidth, setGridWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ id: number; right: number; width: number; ratio: number } | null>(null);
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
  const maxed = hasDashboard && dataView === 'max';
  const ratio = gridWidth ? clampDataRatio(storedRatio ?? DATA_RATIO_DEFAULT, gridWidth) : storedRatio ?? DATA_RATIO_DEFAULT;
  /** 資料面板的來源編號和所屬回覆的引用用同一組號碼 */
  const dashboardLabels = dashboardMessage && activeDashboard
    ? citationLabels(chatAnswerBody(dashboardMessage.content), parseChatSources(dashboardMessage.sources), activeDashboard.blocks.flatMap((block) => block.source_ids))
    : null;
  const latestAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && chatAnswerBody(m.content).trim());
  const hasSources = Boolean(latestAnswer && parseChatSources(latestAnswer.sources).length && [...chatAnswerBody(latestAnswer.content).matchAll(CHAT_CITATION_RE)].length);
  const showNavigation = hasDashboard || hasSources || Boolean(latestAnswer && chatAnswerBody(latestAnswer.content).length >= 600);
  const answerId = `chat-answer-${targetScope}`;
  const citationsId = `chat-citations-${targetScope}`;
  const dataId = `chat-data-${targetScope}`;
  const dataPanelId = `chat-data-panel-${targetScope}`;
  const openKey = `${messages[0]?.id ?? ''}|${latestUserId ?? ''}`;

  /**
   * 目前所在區塊：和回答同一個捲動容器裡、頂端已經捲到導覽列下方的最後一個區塊；捲到底時改看最後一個露出來的區塊。
   * 桌機的資料欄自己捲動，不在這裡算。
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
    const container = getScrollContainer(target);
    const toolbarHeight = container.contains(navigationRef.current) ? navigationRef.current?.offsetHeight ?? 0 : 0;
    const top = target.getBoundingClientRect().top + container.scrollTop
      - (container === document.documentElement ? 0 : container.getBoundingClientRect().top) - toolbarHeight;
    target.focus({ preventScroll: true });
    container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  };

  /** 收起資料欄：按鈕跟著消失，焦點交給標題列的「資料」開關 */
  const hideData = () => {
    setDataView('hidden');
    requestAnimationFrame(() => dataToggleRef.current?.focus());
  };

  // 對話欄＋資料欄的寬度（只有 lg 以上需要）
  useEffect(() => {
    const grid = gridRef.current;
    if (!desktop || !grid) return;
    const observer = new ResizeObserver(() => setGridWidth(grid.getBoundingClientRect().width));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [desktop]);

  /** 分隔線：拖曳時直接改 CSS 變數（不重繪整個對話），放開才寫進狀態與 localStorage */
  const onSplitterDown = (event: PointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (event.button !== 0 || !grid) return;
    const rect = grid.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, right: rect.right, width: rect.width, ratio };
    setDragging(true);
  };
  const onSplitterMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    drag.ratio = clampDataRatio((drag.right - event.clientX) / drag.width, drag.width);
    gridRef.current?.style.setProperty('--data-ratio', String(drag.ratio));
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(drag.ratio * 100)));
  };
  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    storeRatio(drag.ratio);
  };
  /** 方向鍵移動分隔線（左鍵＝資料欄變寬，Shift 一次 10%）；Home／End 到資料欄最窄／最寬 */
  const onSplitterKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const next = { ArrowLeft: ratio + step, ArrowRight: ratio - step, Home: 0, End: 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    storeRatio(clampDataRatio(next, gridWidth || gridRef.current?.getBoundingClientRect().width || 0));
  };

  /**
   * 最新一輪的提問換了：
   * - 正在串流（剛送出新問題）→ 恢復跟隨到底；
   * - 沒有串流（從歷史開啟對話）→ 桌機把這一輪的提問捲到訊息欄頂端、資料欄回到頂端，不跟隨到底。
   *   手機是整頁捲動，由 pages/ai 在抽屜關好後把對話開頭帶到頁首下方。
   * 換了對話時放大的資料欄回到並排，對話才看得到。
   */
  useEffect(() => {
    followRef.current = true;
    setDataView((view) => (view === 'max' ? 'split' : view));
    if (!latestUserId || streamingMessageId) return;
    const pane = getScrollContainer(endRef.current);
    if (pane === document.documentElement) return;
    followRef.current = false;
    const frame = requestAnimationFrame(() => {
      const question = pane.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(latestUserId)}"]`);
      if (question) pane.scrollTo({ top: Math.max(0, scrollTopFor(question, pane, navigationRef.current)), behavior: 'auto' });
      dataBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
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
      // 資料欄等獨立捲動的區塊不算
      if (event.target instanceof Element && !event.target.contains(endRef.current)) return;
      const { top, remaining } = position();
      if (autoTopRef.current !== null && Math.abs(top - autoTopRef.current) <= 1) {
        autoTopRef.current = null;
        previousTop = top;
        syncCurrent();
        return;
      }
      // 內容變矮時瀏覽器把捲動位置往上夾（離底部仍是 0），那不是使用者往上捲
      if (top < previousTop - 1 && remaining > 1) {
        followRef.current = false;
        // 使用者自己往上捲過：之後捲回底部就照常跟到底，不再拉回回覆開頭
        pinnedRef.current = streamingRef.current;
      }
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
        let top = el.scrollHeight;
        const reply = streamingMessageId && pinnedRef.current !== streamingMessageId
          ? el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(streamingMessageId)}"]`) : null;
        if (reply) {
          // 長回覆一定會出現區塊導覽（600 字以上），手機先預留它的高度
          const start = Math.max(0, scrollTopFor(reply, el, navigationRef.current, true));
          if (start < el.scrollHeight - el.clientHeight) {
            // 回覆開頭已經到上緣：停在這裡，不再跟到底
            top = start;
            followRef.current = false;
            pinnedRef.current = streamingMessageId;
          }
        }
        const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
        autoTopRef.current = Math.abs(target - el.scrollTop) > 1 ? target : null;
        el.scrollTo({ top, behavior: 'instant' });
      }
      syncCurrent();
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollKey, loading, messages.length, streamingMessageId, syncCurrent]);

  const waitingForReply = loading && messages[messages.length - 1]?.role !== 'assistant';

  /** 區塊導覽鈕：手機是一排左對齊、右側分隔線；lg 以上靠右、和 56px 的標題列同高、左側分隔線 */
  const navButtonClass = 'relative min-h-11 border-r px-4 text-sm font-medium text-subtle transition-colors duration-(--dur-flash) hover:bg-accent hover:text-foreground focus-lamp-inset lg:h-full lg:border-r-0 lg:border-l';
  /** 目前所在區塊：墨色粗線壓在導覽列底線上（不用燈色） */
  const currentClass = 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground';
  const anchorProps = (section: Section) => ({
    'aria-current': current === section ? ('location' as const) : undefined,
    className: cn(navButtonClass, current === section && currentClass),
  });
  const dataStatusText = dashboardState && activeDashboard
    ? { loading: '整理中', ready: `${activeDashboard.blocks.length} 個區塊`, error: '回覆失敗' }[dashboardState] : null;

  return (
    <div
      ref={gridRef}
      style={{ '--data-ratio': ratio } as CSSProperties}
      className={cn(
        // 手機的輸入列固定在視窗底部：鍵盤 focus 或 scrollIntoView 帶到的元素要停在它上方，不被蓋住
        'flex min-w-0 flex-1 flex-col max-lg:[&_*]:scroll-mb-40',
        // lg 以上：第一欄由上到下是說明列、標題列、訊息、輸入列；資料欄占第二欄的整個高度
        'lg:relative lg:grid lg:min-h-0 lg:grid-rows-[auto_auto_minmax(0,1fr)_auto] lg:overflow-hidden',
        // 資料欄寬＝比例 × 總寬，夾在 22rem 與（總寬 − 24rem）之間（同 layout.ts 的最小寬度）
        hasDashboard && dataView !== 'hidden'
          ? 'lg:grid-cols-[minmax(0,1fr)_clamp(22rem,calc(var(--data-ratio)*100%),calc(100%_-_24rem))]'
          : 'lg:grid-cols-1',
      )}
    >
      {status ? <div inert={maxed} className="min-w-0 lg:col-start-1 lg:row-start-1">{status}</div> : null}

      {/*
        標題列：lg 以上和歷史欄、資料欄的標題列同高（h-14）、底下同一條粗線，左邊是對話名稱、右邊是區塊導覽與「資料」開關。
        手機只在需要區塊導覽時出現，黏在頁首下方。
      */}
      <div
        ref={navigationRef}
        data-chat-toolbar
        inert={maxed}
        className={cn(
          'sticky top-[var(--app-header-height)] z-10 flex min-w-0 border-b bg-card',
          'lg:static lg:col-start-1 lg:row-start-2 lg:h-14 lg:border-border-strong',
          !showNavigation && 'max-lg:hidden',
        )}
      >
        {title ? (
          <h2 className="hidden min-w-0 flex-1 items-center px-6 lg:flex">
            <span className="truncate text-[15px] font-medium" title={title}>{title}</span>
          </h2>
        ) : <span className="hidden flex-1 lg:block" aria-hidden />}
        {showNavigation ? <nav aria-label="回答區塊導覽" className="flex flex-wrap lg:shrink-0 lg:flex-nowrap">
          {latestAnswer ? <button type="button" aria-controls={answerId} onClick={() => navigate(answerId, true, 'answer')}
            {...anchorProps('answer')}>回答</button> : null}
          {hasSources ? <button type="button" aria-controls={citationsId} onClick={() => navigate(citationsId, true, 'citations')}
            {...anchorProps('citations')}>引用</button> : null}
          {activeDashboard ? (desktop ? (
            // lg 以上：「資料」是開關（展開／收起右側資料欄），不是錨點；燈質記號照樣標出資料狀態
            <button ref={dataToggleRef} type="button" aria-expanded={dataView !== 'hidden'} aria-controls={dataPanelId}
              onClick={() => setDataView((view) => (view === 'hidden' ? 'split' : 'hidden'))}
              className={cn(navButtonClass, 'inline-flex items-center gap-2')}>
              {dataView === 'hidden' ? <PanelRightOpen size={16} className="shrink-0" aria-hidden /> : <PanelRightClose size={16} className="shrink-0" aria-hidden />}
              資料
              {dashboardState ? <LightGlyph state={dashboardState} /> : null}
            </button>
          ) : <button type="button" aria-controls={dataId} onClick={() => navigate(dataId, false, 'data')}
            {...anchorProps('data')}>資料</button>) : null}
        </nav> : null}
      </div>

      <div inert={maxed} className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain">
        {showNavigation && latestAnswer ? <h2 className="sr-only">回答</h2> : null}
        {messages.length === 0 && !loading ? (
          <motion.div
            className="flex flex-1 flex-col px-4 py-4 sm:px-5 sm:py-6 lg:py-10"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.625, ease: [0.2, 0, 0, 1] }}
          >
            {/*
              值班日誌：帳頁標題＋一行燈質列（範例問題的說明）＋粗線，底下直接是有線的範例條目。
              不放歡迎句；分組名寫在左側欄（sm 以上），像日誌的分類欄，手機只留條目。
            */}
            <div className={cn('mx-auto w-full', CHAT_COLUMN)}>
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
            onRate={onRate}
            followUpDisabled={loading}
            streamActive={msg.role === 'assistant' && msg.id === streamingMessageId}
            answerTargetId={msg.id === latestAnswer?.id ? answerId : undefined}
            citationsTargetId={msg.id === latestAnswer?.id && hasSources ? citationsId : undefined}
          />
        ))}

        {waitingForReply ? (
          <motion.div
            className="border-b bg-card px-4 py-4 sm:px-5 lg:px-6"
            aria-live="polite"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            <div className={cn('mx-auto w-full', CHAT_COLUMN)}>
              <p className="characteristic">AI 回覆</p>
              {/* 載入＝燈質 Q：有線的空白列加一道掃過的光帶 */}
              <LoadingRows label="正在查詢資料…" className="mt-2 h-[88px] border" />
            </div>
          </motion.div>
        ) : null}
        <div ref={endRef} className="h-0 shrink-0" aria-hidden />
      </div>

      {activeDashboard ? (
        <aside
          id={dataPanelId}
          aria-label="分析資料面板"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !maxed) return;
            event.stopPropagation();
            setDataView('split');
          }}
          className={cn(
            'flex min-w-0 flex-col border-t border-border-strong bg-card lg:min-h-0 lg:border-t-0',
            maxed
              // 放大：蓋住整個對話欄（對話欄設 inert，捲動位置不變），還原後回到原本的並排
              ? 'lg:absolute lg:inset-0 lg:z-30'
              : 'lg:relative lg:col-start-2 lg:row-span-full lg:row-start-1 lg:border-l lg:border-l-border',
            // 收起時不顯示（CSS 決定，伺服器輸出與第一次繪製也一致）
            dataView === 'hidden' && 'lg:hidden',
          )}
        >
          {desktop && dataView === 'split' ? (
            /*
              分隔線：壓在資料欄左緣、12px 寬的拖曳區（中間是原本的 1px 線），中段一小截握把提示可以拖。
              hover 時線加粗成墨色、拖曳中全黑；focus 用燈色內框。連按兩下回到預設寬度。
            */
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="調整資料欄寬度"
              aria-controls={dataPanelId}
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={Math.round(clampDataRatio(0, gridWidth) * 100)}
              aria-valuemax={Math.round(clampDataRatio(1, gridWidth) * 100)}
              aria-valuetext={`資料欄占 ${Math.round(ratio * 100)}%`}
              tabIndex={0}
              title="拖曳調整寬度，連按兩下回到預設"
              onPointerDown={onSplitterDown}
              onPointerMove={onSplitterMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onKeyDown={onSplitterKey}
              onDoubleClick={() => storeRatio(DATA_RATIO_DEFAULT)}
              className="group absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none focus-lamp-inset"
            >
              <span aria-hidden className={cn('absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors duration-(--dur-flash)',
                dragging ? 'bg-foreground' : 'bg-transparent group-hover:bg-border-strong')} />
              <span aria-hidden className={cn('absolute top-1/2 left-1/2 h-8 w-1 -translate-1/2 rounded-sm transition-colors duration-(--dur-flash)',
                dragging ? 'bg-foreground' : 'bg-border-strong group-hover:bg-foreground')} />
            </div>
          ) : null}
          {/* 拖曳中整個畫面都是調整寬度的游標，滑過按鈕、文字也不會換成別的游標 */}
          {dragging ? <div className="fixed inset-0 z-50 cursor-col-resize" aria-hidden /> : null}

          <div className="flex items-center justify-between gap-3 border-b border-border-strong px-4 py-2.5 sm:px-5 lg:h-14 lg:shrink-0 lg:py-0 lg:pr-1.5">
            <div className="flex min-w-0 items-center gap-3">
              <h2 id={dataId} tabIndex={-1} className="font-serif text-xl leading-snug font-black tracking-[0.06em] focus:outline-2 focus:outline-offset-2 focus:outline-focus">資料</h2>
              {dashboardState ? (
                <span className="characteristic inline-flex items-center gap-1.5 text-foreground">
                  <LightGlyph state={dashboardState} />
                  <span className="text-muted-foreground">{dataStatusText}</span>
                </span>
              ) : null}
            </div>
            {desktop ? (
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="ghost" size="icon" aria-pressed={maxed} aria-label="放大資料欄"
                  title={maxed ? '還原並排（Esc）' : '放大資料欄'} onClick={() => setDataView(maxed ? 'split' : 'max')}
                  className={cn('text-muted-foreground hover:text-foreground', maxed && 'text-foreground')}>
                  {maxed ? <Minimize2 className="size-[18px]" aria-hidden /> : <Maximize2 className="size-[18px]" aria-hidden />}
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="收起資料欄" title="收起資料欄" onClick={hideData}
                  className="text-muted-foreground hover:text-foreground">
                  <PanelRightClose className="size-[18px]" aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
          <div ref={dataBodyRef} className="min-w-0 px-4 py-4 sm:px-5 sm:py-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain">
            {/* 放大時版面很寬：內容最寬 96rem 置中，圖表與表格不會拉成一條 */}
            <div className={cn('min-w-0', maxed && 'mx-auto max-w-[96rem]')}>
              <ChatDashboard dashboard={activeDashboard} sourceLabel={dashboardLabels ? (id) => dashboardLabels.get(id) ?? id : undefined} />
            </div>
          </div>
        </aside>
      ) : null}

      {composer ? (
        <div inert={maxed} className="sticky bottom-0 z-20 mt-auto shrink-0 lg:static lg:col-start-1 lg:row-start-4 lg:mt-0">{composer}</div>
      ) : null}
    </div>
  );
}
