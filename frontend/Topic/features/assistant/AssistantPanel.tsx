import { Fragment, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Dialog } from 'radix-ui';
import { ArrowRight, Compass, Maximize2, Pause, Play, SquarePen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/common/Disclosure';
import { Notice } from '@/components/common/Notice';
import { ChatMessage } from '@/features/ai/ChatMessage';
import { ChatDashboard } from '@/features/ai/ChatDashboard';
import { ChatInput } from '@/features/ai/ChatInput';
import { AskQuota, useAskQuotaReached } from '@/features/pricing/AskQuota';
import type { useChat } from '@/features/ai/useChat';
import { LighthouseMascot } from './LighthouseMascot';
import type { AssistantContext } from './context';
import type { MascotMood } from './sprite';

/** 面板輸入框的 id 前綴（AssistantDock 打開面板時把焦點放進去） */
export const ASSISTANT_INPUT_ID = 'assistant-input';

type Chat = Pick<ReturnType<typeof useChat>,
  'messages' | 'loading' | 'notice' | 'stopNotice' | 'streamingMessageId' | 'signedIn' | 'conversationId' | 'rate' | 'stop' | 'newConversation'>;

/** 完整對話頁：登入使用者帶這則對話過去（/ai?c=），訪客的對話不保存，只能開新的 */
export function fullChatHref(signedIn: boolean, conversationId: string | null): string {
  return signedIn && conversationId ? `/ai?c=${encodeURIComponent(conversationId)}` : '/ai';
}

/**
 * 小燈面板的內容（外框、定位與開關在 AssistantDock）。
 * 版面：標題列（h-14、粗線）→ 對話（沒有訊息時是招呼與「可以這樣問」）→ 輸入列（含 AI 免責一行）。
 */
export function AssistantPanel({ chat, context, mood, stockOnly, onStockOnlyChange, onSend, reducedMotion, still, onStillChange, selectionTip, tourSteps = 0, onStartTour }: {
  chat: Chat;
  context: AssistantContext;
  mood: MascotMood;
  stockOnly: boolean;
  onStockOnlyChange: (value: boolean) => void;
  onSend: (text: string) => void;
  reducedMotion: boolean;
  /** 使用者按了「暫停小燈動作」（記在這個瀏覽器） */
  still: boolean;
  onStillChange: (value: boolean) => void;
  /** 滑鼠裝置才有「選取文字問小燈」，才提這個小技巧 */
  selectionTip: boolean;
  /** 這頁的「這頁怎麼看」導覽有幾步（畫面上找得到的區塊）；0 是這頁沒有導覽 */
  tourSteps?: number;
  onStartTour?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const askReached = useAskQuotaReached();
  const empty = chat.messages.length === 0;
  const last = chat.messages.at(-1);

  // 送出、回答完成時把最新一則提問捲到頂端：回答從開頭讀起，不是停在最底
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const questions = box.querySelectorAll<HTMLElement>('[data-message-role="user"]');
    const latest = questions[questions.length - 1];
    box.scrollTop = latest ? latest.offsetTop : 0;
  }, [chat.messages.length, last?.status]);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b-2 border-border-strong bg-card pr-1 pl-2">
        <LighthouseMascot mood={mood} scale={1.75} still={still} />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-serif text-lg leading-tight font-black tracking-[0.06em]">小燈</Dialog.Title>
          <Dialog.Description className="truncate text-xs text-muted-foreground">股海明燈站內助手 · AI 回覆</Dialog.Description>
        </div>
        {/* 會自己動的內容要能停下來（WCAG 2.2.2）：暫停後所有小燈都只畫靜止的圖 */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="暫停小燈動作"
          aria-pressed={still}
          onClick={() => onStillChange(!still)}
          className={cn('border', still ? 'border-border-strong text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {still ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
        </Button>
        {tourSteps && onStartTour ? (
          <Button type="button" variant="ghost" size="icon" aria-label="這頁怎麼看（導覽）" onClick={onStartTour} className="text-muted-foreground hover:text-foreground">
            <Compass size={18} aria-hidden />
          </Button>
        ) : null}
        {!empty ? (
          <Button type="button" variant="ghost" size="icon" aria-label="開新對話" onClick={chat.newConversation} className="text-muted-foreground hover:text-foreground">
            <SquarePen size={18} aria-hidden />
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Link href={fullChatHref(chat.signedIn, chat.conversationId)} aria-label="在 AI 對話頁開啟">
            <Maximize2 size={18} aria-hidden />
          </Link>
        </Button>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="關閉小燈" className="text-muted-foreground hover:text-foreground">
            <X size={18} aria-hidden />
          </Button>
        </Dialog.Close>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {empty ? (
          <div className="bg-card">
            <div className="px-4 py-4">
              <p className="text-[15px] leading-[1.8]">
                嗨，我是小燈。{context.viewing ? `你正在看${/^[「『]/.test(context.viewing) ? '' : ' '}${context.viewing}；` : ''}
                個股走勢、法人、技術指標、新聞，或網站的功能在哪裡，都可以問我。
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {chat.signedIn ? '已登入：對話會存進 AI 對話紀錄。' : '訪客：對話不會保存，離開網站就清除。'}
              </p>
              {tourSteps && onStartTour ? (
                <Button type="button" variant="outline" onClick={onStartTour} className="mt-3 w-full justify-between">
                  <span className="inline-flex items-center gap-2"><Compass size={16} aria-hidden />帶我看這頁怎麼看</span>
                  <span className="characteristic">{tourSteps} 步</span>
                </Button>
              ) : null}
            </div>
            <div role="group" aria-label="可以這樣問" className="border-t">
              <p className="px-4 pt-3 pb-1 text-[13px] font-medium tracking-[0.04em] text-muted-foreground" aria-hidden>可以這樣問</p>
              <div className="divide-y border-b">
                {context.questions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={chat.loading || askReached}
                    onClick={() => onSend(question)}
                    className="lamp-row group flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-foreground focus-lamp-inset"
                  >
                    <span className="min-w-0">{question}</span>
                    <ArrowRight size={16} className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--dur-flash) group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-4">
              <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">小技巧</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-subtle">
                {selectionTip ? <li>在頁面上選取看不懂的字或句子，按旁邊的「問小燈」，我會用白話解釋。</li> : null}
                <li>換頁時我會跟著你，這裡的對話不會中斷。</li>
                <li>回覆裡的「相關功能」可以直接帶你到對應的頁面。</li>
              </ul>
            </div>
          </div>
        ) : (
          chat.messages.map((message) => (
            <Fragment key={message.id}>
              <ChatMessage
                message={message}
                reducedMotion={reducedMotion}
                streamActive={message.id === chat.streamingMessageId}
                onFollowUp={onSend}
                onRate={chat.rate}
                followUpDisabled={chat.loading}
              />
              {/* 資料面板在 AI 對話頁是右側一欄；面板太窄，收在回覆下方，要看再展開 */}
              {message.role === 'assistant' && message.dashboard && message.status !== 'streaming' ? (
                <Disclosure
                  className="border-b bg-card px-4"
                  summary={<span className="text-sm">資料面板：{message.dashboard.title}</span>}
                >
                  <div className="pb-4">
                    <ChatDashboard dashboard={message.dashboard} />
                  </div>
                </Disclosure>
              ) : null}
            </Fragment>
          ))
        )}
        {chat.notice ? <Notice tone="danger" className="m-4">{chat.notice}</Notice> : null}
      </div>

      <ChatInput
        id={ASSISTANT_INPUT_ID}
        placeholder="問小燈…"
        onSend={onSend}
        disabled={chat.loading || askReached}
        onStop={chat.loading ? chat.stop : undefined}
        stopNotice={chat.stopNotice}
        quota={<AskQuota stock={context.stock} />}
        toolbar={context.stock ? (
          <label className="-mt-1 mb-1 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-subtle">
            <Checkbox checked={stockOnly} onCheckedChange={(value) => onStockOnlyChange(value === true)} />
            <span className="min-w-0">回答只看 {context.stock.label}</span>
          </label>
        ) : null}
      />
    </>
  );
}
