import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Dialog } from 'radix-ui';
import { useChat } from '@/features/ai/useChat';
import { useCanHoverTilt, useHtmlDarkClass, useHydrated, useMediaQuery, usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { parseFlag, serializeFlag, useStoredPreference } from '@/lib/hooks/useStoredPreference';
import { browserStorage, hasAcknowledgedRiskNotice, RISK_NOTICE_ACK_EVENT } from '@/lib/riskNotice';
import { cn } from '@/lib/cn';
import { AssistantPanel, ASSISTANT_INPUT_ID } from './AssistantPanel';
import { LighthouseMascot } from './LighthouseMascot';
import { assistantContext, selectionQuestion } from './context';
import { useAssistantTopic } from './topic';
import { PageTour } from './PageTour';
import { availableSteps, MIN_TOUR_STEPS, tourFor, type TourStep } from './tours';
import type { MascotLook, MascotMood } from './sprite';

/** AI 對話頁本身就是完整的助手，不再放小燈 */
const HIDDEN_ROUTES = new Set(['/ai']);
/** 首頁觀測台的 id（pages/index.tsx 的 TERMINAL_ID）：捲到觀測台才出現 */
const HOME_TERMINAL_ID = 'terminal';
/** 第一次出現時的自我介紹泡泡，看過就不再出現 */
const INTRO_KEY = 'tei:assistant-intro:v1';
const INTRO_MS = 8000;
/** 「這頁怎麼看」提示過的頁面（每頁只主動提一次） */
const TOUR_OFFERED_KEY = 'tei:assistant-tour-offered:v1';
const OFFER_DELAY_MS = 1500;
const OFFER_MS = 10_000;
/** 「暫停小燈動作」記在這個瀏覽器 */
const STILL_KEY = 'tei:assistant-still:v1';
/** 這麼久沒有任何操作就打瞌睡 */
const SLEEP_MS = 45_000;
/** 小燈（含海浪）高度加間距：回到頂部鈕疊在它上方（components/layout/ScrollToTop.tsx） */
const DOCK_OFFSET = '5rem';
/** 選取文字時跟著出現的「問小燈」：這個屬性底下的文字不算（避免選到小燈自己） */
const ASSISTANT_UI_ATTR = 'data-assistant-ui';

function offeredTours(): string[] {
  try {
    const value: unknown = JSON.parse(browserStorage()?.getItem(TOUR_OFFERED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** 記下這頁提示過了；儲存空間不能用時回 false（那就不主動提示，免得每次都跳出來） */
function markTourOffered(id: string): boolean {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    const seen = offeredTours();
    if (!seen.includes(id)) storage.setItem(TOUR_OFFERED_KEY, JSON.stringify([...seen, id]));
    return true;
  } catch {
    return false;
  }
}

/** 首次造訪的風險提示條佔住底部時先不出現，按「我已了解」後才出來 */
function useRiskNoticeAcknowledged(): boolean {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setAcknowledged(hasAcknowledgedRiskNotice(browserStorage()));
    const onAcknowledge = () => setAcknowledged(true);
    window.addEventListener(RISK_NOTICE_ACK_EVENT, onAcknowledge);
    return () => window.removeEventListener(RISK_NOTICE_ACK_EVENT, onAcknowledge);
  }, []);
  return acknowledged;
}

/** 首頁觀測台算不算「到了」：觀測台上緣在視窗上半部 */
export function homeTerminalReached(terminalTop: number | undefined, viewportHeight: number): boolean {
  return terminalTop !== undefined && terminalTop < viewportHeight / 2;
}

/**
 * 首頁：觀測台到了才算（homeTerminalReached）；其他頁一律 true。
 * 每次捲動重新找元素再量（rAF 節流）：觀測台在 hydrate 時可能換成新的節點，觀察舊節點會一直等不到。
 */
function useHomeTerminalReached(onHome: boolean): boolean {
  const [reached, setReached] = useState(false);
  useEffect(() => {
    if (!onHome) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const top = document.getElementById(HOME_TERMINAL_ID)?.getBoundingClientRect().top;
      setReached(homeTerminalReached(top, window.innerHeight));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [onHome]);
  return !onHome || reached;
}

/** 太久沒有操作就打瞌睡；一有動靜就醒來（onWake 讓它嚇一跳、打招呼） */
function useDrowsy(enabled: boolean, onWake: () => void): boolean {
  const [drowsy, setDrowsy] = useState(false);
  useEffect(() => {
    setDrowsy(false);
    if (!enabled) return;
    let asleep = false;
    let timer = 0;
    let armedAt = 0;
    const arm = () => {
      armedAt = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        asleep = true;
        setDrowsy(true);
      }, SLEEP_MS);
    };
    const onActivity = () => {
      if (asleep) {
        asleep = false;
        setDrowsy(false);
        onWake();
        arm();
      } else if (Date.now() - armedAt > 1000) {
        arm();
      }
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    arm();
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
    };
  }, [enabled, onWake]);
  return drowsy;
}

/** 頁面正在捲動（停下來 0.6 秒後結束）：海浪流快一點 */
function useSurfing(enabled: boolean): boolean {
  const [surfing, setSurfing] = useState(false);
  useEffect(() => {
    setSurfing(false);
    if (!enabled) return;
    let timer = 0;
    const onScroll = () => {
      setSurfing(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSurfing(false), 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, [enabled]);
  return surfing;
}

interface PageSelection {
  text: string;
  x: number;
  top: number;
  bottom: number;
}

/** 頁面上選取的文字（輸入框、對話框、小燈自己的文字不算）與它在視窗上的位置 */
function usePageSelection(enabled: boolean): [PageSelection | null, () => void] {
  const [selection, setSelection] = useState<PageSelection | null>(null);
  useEffect(() => {
    setSelection(null);
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const current = window.getSelection();
      const text = current && !current.isCollapsed && current.rangeCount ? current.toString() : '';
      const node = current?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      if (!text.trim() || !element || element.closest(`input, textarea, select, [contenteditable="true"], [role="dialog"], [${ASSISTANT_UI_ATTR}]`)) {
        setSelection(null);
        return;
      }
      const box = current!.getRangeAt(0).getBoundingClientRect();
      // 選取範圍捲出視窗就先收起來，捲回來再出現
      // 只給畫面上看得到的文字：視覺隱藏（sr-only，1px）的標題不算
      if ((box.width < 2 && box.height < 2) || box.bottom < 0 || box.top > window.innerHeight) {
        setSelection(null);
        return;
      }
      setSelection({ text, x: box.left + box.width / 2, top: box.top, bottom: box.bottom });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [enabled]);
  const clear = useCallback(() => setSelection(null), []);
  return [selection, clear];
}

/**
 * 站內助手「小燈」：右下角站在海浪上的像素燈塔，點開是一個可以直接對話的面板（DESIGN.md 第 12 節）。
 * 掛在 AppShell，換頁時對話還在；面板在桌面是不擋操作的浮動面板，手機是從底部升起的全寬面板。
 */
export function AssistantDock() {
  const router = useRouter();
  const hydrated = useHydrated();
  const chat = useChat({ listHistory: false });
  const reduced = usePrefersReducedMotion();
  const phone = useMediaQuery('(max-width: 639px)');
  const finePointer = useCanHoverTilt();
  const dark = useHtmlDarkClass();
  const acknowledged = useRiskNoticeAcknowledged();
  const terminalReached = useHomeTerminalReached(router.pathname === '/');
  const visible = hydrated && acknowledged && terminalReached && !HIDDEN_ROUTES.has(router.pathname);
  const [stillPref, storeStill] = useStoredPreference(STILL_KEY, parseFlag, serializeFlag);
  const still = stillPref ?? false;

  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [unread, setUnread] = useState(false);
  const [freshAnswer, setFreshAnswer] = useState(false);
  const [look, setLook] = useState<MascotLook>(0);
  const [stockOnly, setStockOnly] = useState(true);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const onStockPage = router.pathname.startsWith('/stock/[id]');
  const stockInfos = useStockInfos({ enabled: open && onStockPage });
  const stockName = onStockPage ? stockInfos.data?.find((stock) => stock.symbol === router.query.id)?.name : null;
  const topic = useAssistantTopic();
  const context = assistantContext(router.pathname, router.query.id, stockName, topic);
  const stockCode = context.stock?.code ?? null;
  const tour = tourFor(router.pathname);
  const [touring, setTouring] = useState<TourStep[] | null>(null);
  const [tourSteps, setTourSteps] = useState(0);
  const [offer, setOffer] = useState(false);

  const greet = useCallback(() => setGreeting(true), []);
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(() => setGreeting(false), 2000);
    return () => window.clearTimeout(timer);
  }, [greeting]);

  const drowsy = useDrowsy(visible && !open && !chat.loading && !touring, greet);
  const surfing = useSurfing(visible && !reduced && !still);
  const [selection, clearSelection] = usePageSelection(visible && finePointer && !phone);

  // 出現時打招呼；第一次出現另外說明自己是誰
  useEffect(() => {
    if (!visible) {
      setOpen(false);
      return;
    }
    greet();
    const storage = browserStorage();
    if (!storage) return;
    try {
      if (storage.getItem(INTRO_KEY) === '1') return;
      storage.setItem(INTRO_KEY, '1');
    } catch {
      return;
    }
    setIntro(true);
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [visible, greet]);

  // 這頁的導覽：面板打開時數一下畫面上有幾個區塊（資料讀完前可能比較少）
  useEffect(() => {
    if (open && tour) setTourSteps(availableSteps(tour).length);
  }, [open, tour]);

  // 第一次來這頁：等區塊讀出來，泡泡問要不要看導覽（每頁只問一次）
  useEffect(() => {
    setOffer(false);
    if (!visible || !tour || offeredTours().includes(tour.id)) return;
    let hide = 0;
    const timer = window.setTimeout(() => {
      if (availableSteps(tour).length < MIN_TOUR_STEPS || !markTourOffered(tour.id)) return;
      setOffer(true);
      hide = window.setTimeout(() => setOffer(false), OFFER_MS);
    }, OFFER_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hide);
    };
  }, [visible, tour]);

  // 自我介紹只在這頁的導覽開得起來時才提（沒登入時有些頁的區塊不在畫面上）；區塊讀出來後再看一次
  const [introTour, setIntroTour] = useState(false);
  useEffect(() => {
    setIntroTour(false);
    if (!intro || !tour) return;
    const check = () => setIntroTour(availableSteps(tour).length >= MIN_TOUR_STEPS);
    check();
    const timer = window.setTimeout(check, OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [intro, tour]);

  // 換頁就結束導覽
  useEffect(() => {
    setTouring(null);
  }, [router.pathname]);

  const startTour = () => {
    const steps = tour ? availableSteps(tour) : [];
    if (!tour || steps.length < MIN_TOUR_STEPS) return false;
    markTourOffered(tour.id);
    setOpen(false);
    setIntro(false);
    setOffer(false);
    setTouring(steps);
    return true;
  };

  // 換班（切換晨海／夜海）時跳一下、光束全開
  const themeSeen = useRef<boolean | null>(null);
  useEffect(() => {
    if (themeSeen.current !== null && themeSeen.current !== dark) greet();
    themeSeen.current = dark;
  }, [dark, greet]);

  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.style.setProperty('--assistant-dock-offset', DOCK_OFFSET);
    return () => {
      root.style.removeProperty('--assistant-dock-offset');
    };
  }, [visible]);

  // 換到另一檔股票時，「回答只看這檔」回到預設勾選
  useEffect(() => setStockOnly(true), [stockCode]);

  // 手機的面板蓋住整個畫面：點了回覆裡的頁面連結就收起來，看得到新頁
  useEffect(() => {
    if (phone) setOpen(false);
  }, [router.asPath, phone]);

  // 回答完成：面板開著就亮 5 秒「有新回覆」的光束；關著就一直亮到打開為止
  const last = chat.messages.at(-1);
  const lastStatus = last?.role === 'assistant' ? last.status : undefined;
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !chat.loading && lastStatus === 'completed') {
      setFreshAnswer(true);
      if (!open) setUnread(true);
    }
    wasLoading.current = chat.loading;
  }, [chat.loading, lastStatus, open]);
  useEffect(() => {
    if (!freshAnswer || !open) return;
    const timer = window.setTimeout(() => setFreshAnswer(false), 5000);
    return () => window.clearTimeout(timer);
  }, [freshAnswer, open]);
  useEffect(() => {
    if (open) {
      setUnread(false);
      setIntro(false);
    } else {
      // 看過了才關起來：回到待機，不再亮著「有新回覆」的光束
      setFreshAnswer(false);
    }
  }, [open]);

  // 眼睛跟著滑鼠往左右看（只在滑鼠裝置、沒有減少動態時）
  useEffect(() => {
    if (!visible || reduced || still || !finePointer) {
      setLook(0);
      return;
    }
    let frame = 0;
    let x = 0;
    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = launcherRef.current?.getBoundingClientRect();
        if (!box) return;
        const dx = x - (box.left + box.width / 2);
        setLook(dx < -160 ? -1 : dx > 160 ? 1 : 0);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [visible, reduced, still, finePointer]);

  const failed = Boolean(chat.notice) || lastStatus === 'failed';
  const mood: MascotMood = chat.loading ? 'thinking' : failed ? 'error' : unread || freshAnswer ? 'done' : greeting ? 'greet' : 'idle';
  /** scoped：個股頁勾了「回答只看這檔」時送 stock_id；選取文字的解釋不送 */
  const send = (text: string, { scoped = true }: { scoped?: boolean } = {}) => {
    setFreshAnswer(false);
    void chat.send(text, { stockId: scoped && context.stock && stockOnly ? context.stock.code : null });
  };

  if (!visible) return null;

  const launcherLabel = chat.loading ? '小燈正在回覆，開啟站內助手'
    : unread ? '小燈有新回覆，開啟站內助手' : '開啟站內助手小燈';
  // 旁邊的對話泡泡：自我介紹、有新回覆、整理中一直顯示；其他時候滑鼠移上去才出現
  const bubble = open ? null
    : intro ? { text: introTour ? '我是小燈。第一次來嗎？點我，帶你看這頁怎麼看。' : '我是小燈。查個股、看懂指標、找網站功能，點我就能問。', always: true }
    : offer ? { text: '第一次來這頁？點我帶你看看', always: true }
    : unread ? { text: '回覆好了，點我看', always: true }
    : chat.loading ? { text: '整理中…', always: true }
    : failed ? { text: '這次沒有回覆成功，點我再問一次', always: false }
    : { text: drowsy ? '我醒著！有問題問我' : '有問題問我', always: false };
  const selectionAsk = selection ? selectionQuestion(selection.text) : null;
  // 「問小燈」放在選取範圍上方；太靠近頁首就改放下方
  const chipBelow = selection ? selection.top < 120 : false;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen} modal={phone}>
        {selection && selectionAsk ? (
          <button
            type="button"
            {...{ [ASSISTANT_UI_ATTR]: '' }}
            disabled={chat.loading}
            style={{
              left: Math.min(Math.max(selection.x, 64), window.innerWidth - 64),
              top: chipBelow ? selection.bottom + 8 : selection.top - 8,
            }}
            // 按下去時不要讓瀏覽器清掉選取
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              clearSelection();
              setOpen(true);
              send(selectionAsk, { scoped: false });
            }}
            className={cn(
              'fixed z-50 inline-flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-border-strong bg-card pr-3 pl-0.5 text-sm font-medium text-foreground shadow-raised transition-colors duration-(--dur-flash) hover:bg-accent focus-lamp disabled:opacity-60 print:hidden',
              !chipBelow && '-translate-y-full',
            )}
          >
            <LighthouseMascot mood="greet" scale={1.25} still className="-my-1" />
            問小燈
          </button>
        ) : null}
        <Dialog.Trigger asChild>
          <button
            ref={launcherRef}
            type="button"
            aria-label={launcherLabel}
            {...{ [ASSISTANT_UI_ATTR]: '' }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') greet();
            }}
            // 泡泡說「點我帶你看」時，點下去直接開始導覽，不開面板
            onClick={(event) => {
              if (((intro && introTour) || offer) && startTour()) event.preventDefault();
            }}
            // 沒有外框：小燈站在自己的一小片海上。點擊範圍是整張圖，focus 時外圈照常出現
            className="group fixed right-[calc(0.5rem+var(--app-safe-area-right))] bottom-[calc(0.25rem+var(--app-safe-area-bottom))] z-40 rounded-md p-1 focus-lamp sm:right-[calc(1rem+var(--app-safe-area-right))] sm:bottom-[calc(0.75rem+var(--app-safe-area-bottom))] print:hidden"
          >
            <LighthouseMascot
              mood={mood}
              scale={3}
              look={look}
              drowsy={drowsy}
              surfing={surfing}
              still={still}
              className="h-auto w-[65px] sm:w-[78px]"
            />
            {bubble ? (
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute top-1 right-full mr-1 w-max max-w-[min(15rem,calc(100vw-6rem))] rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-left text-sm leading-relaxed text-foreground shadow-raised transition-opacity duration-(--dur-sweep)',
                  bubble.always ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
                )}
              >
                {bubble.text}
              </span>
            ) : null}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          {phone ? (
            <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--dur-sweep) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-beam) print:hidden" />
          ) : null}
          <Dialog.Content
            ref={contentRef}
            tabIndex={-1}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              // 手機不直接叫出鍵盤：焦點放在面板上，讓使用者先看到推薦的問題
              if (phone) contentRef.current?.focus();
              else document.getElementById(`${ASSISTANT_INPUT_ID}-message`)?.focus();
            }}
            // 桌面不擋操作：點頁面、捲動頁面時面板留著，用關閉鈕、Esc 或再按一次小燈收起
            onInteractOutside={(event) => {
              if (!phone) event.preventDefault();
            }}
            className={cn(
              'fixed z-50 flex flex-col overflow-hidden border-border-strong bg-background shadow-raised outline-none print:hidden',
              'inset-x-0 bottom-0 h-[min(88dvh,calc(100dvh-var(--app-safe-area-top)-1rem))] border-t-2',
              'data-[state=closed]:animate-out data-[state=closed]:duration-(--dur-sweep) data-[state=open]:animate-in data-[state=open]:duration-(--dur-beam)',
              'max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom',
              // sm 以上：浮在小燈上方，只淡入淡出（浮層不縮放、不滑動）
              'sm:inset-x-auto sm:right-[calc(1rem+var(--app-safe-area-right))] sm:bottom-[calc(6.25rem+var(--app-safe-area-bottom))] sm:h-[min(40rem,calc(100dvh-var(--app-header-height)-8.5rem))] sm:w-[25rem] sm:border',
              'sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0',
            )}
          >
            <AssistantPanel
              chat={chat}
              context={context}
              mood={mood}
              stockOnly={stockOnly}
              onStockOnlyChange={setStockOnly}
              onSend={(text) => send(text)}
              reducedMotion={reduced}
              still={still}
              onStillChange={storeStill}
              selectionTip={finePointer && !phone}
              tourSteps={tourSteps >= MIN_TOUR_STEPS ? tourSteps : 0}
              onStartTour={startTour}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {/* 導覽是另一個 modal，不放在面板的 Dialog 裡：開始導覽時面板會先關掉 */}
      {touring && tour ? (
        <PageTour
          title={tour.title}
          steps={touring}
          still={still}
          onClose={() => {
            setTouring(null);
            greet();
          }}
          onCloseAutoFocus={() => launcherRef.current?.focus()}
        />
      ) : null}
    </>
  );
}
