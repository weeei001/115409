import { useId, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage as ChatMessageData } from '@/lib/types/chat';
import { parseChatSources } from '@/lib/types/chat';
import { isChatFollowUpAction, isChatNavigationAction, isPaperOrderDraftAction } from '@/lib/nav';
import { PaperOrderDraft } from '@/features/order/PaperOrderDraft';
import { MarkdownBlock } from '@/lib/utils/markdown';
import { isStructuredRagReply } from '@/lib/utils/parseRagStructuredReply';
import { CHAT_CITATION_RE, chatAnswerBody, chatCopyText, citationLabels, newsCitationPath } from '@/lib/utils/chatCitations';
import { cn } from '@/lib/cn';
import { Button, textLinkClass } from '@/components/ui/button';
import { RagStructuredReply } from './RagStructuredReply';
import { StreamCursor } from './StreamCursor';
import { formatTaipei } from '@/lib/utils/date';

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

/** 日誌時間：只顯示訊息本身帶的時間；沒有或無法解析就不顯示 */
function entryTime(value: string): string | null {
  return formatTaipei(value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) || null;
}

/** 建議追問：底線文字鈕，至少 44px 高 */
const followUpClass = cn('inline-flex min-h-11 max-w-full items-center text-left text-sm text-foreground', textLinkClass, 'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50');
/** 相關功能（換頁）：次要連結，底線文字加小箭頭、至少 44px 高 */
const navLinkClass = 'group inline-flex min-h-11 max-w-full items-center gap-1.5 text-left text-sm text-foreground transition-colors duration-(--dur-flash) focus-visible:outline-2 focus-visible:outline-offset-2';
const rowArrow = <ArrowRight size={14} className="shrink-0 text-muted-foreground transition-transform duration-(--dur-flash) group-hover:translate-x-0.5" aria-hidden />;

export function ChatMessage({ message, reducedMotion, streamActive, onFollowUp, followUpDisabled, answerTargetId, citationsTargetId }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const sourceScope = useId();
  const content = isUser ? message.content : chatAnswerBody(message.content);
  const sources = parseChatSources(message.sources);
  const sourceMap = new Map(sources.map((source) => [source.citation_id, source]));
  const citedIds = [...new Set([...content.matchAll(CHAT_CITATION_RE)].map((match) => match[1]))];
  /** 畫面上的引用編號（依正文出現順序 1、2、3…）；錨點與比對仍用原本的 citation_id */
  const labels = isUser ? new Map<string, string>() : citationLabels(content, sources);
  const labelOf = (id: string) => labels.get(id) ?? id;
  const sourceId = (id: string) => `chat-source-${sourceScope}-${id}`;
  /**
   * 引用標記：行內是上標式的等寬小字（內文色、細底線、沒有框）；引用清單裡放在左側欄、撐滿列高。
   */
  const renderCitation = (id: string, place: 'inline' | 'margin' = 'inline') => {
    const source = sourceMap.get(id);
    if (!source) return place === 'margin'
      ? <span className="pt-3 font-mono text-xs text-muted-foreground tabular-nums">[{id}]</span>
      : <span className="text-muted-foreground">[{id}]（來源無法使用）</span>;
    const path = newsCitationPath(source);
    return <a href={path ?? `#${sourceId(id)}`}
      aria-label={`引用 ${labelOf(id)}：${source.title}${path ? '，查看本站新聞' : '，查看引用來源'}`}
      className={cn(
        'font-mono text-foreground tabular-nums underline decoration-1 underline-offset-2 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2',
        place === 'inline'
          ? 'mx-px align-super text-[0.68em] leading-none font-medium decoration-muted-foreground'
          : 'flex min-h-11 items-start pt-3 text-xs decoration-input',
      )}
      onClick={path ? undefined : (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const target = document.getElementById(sourceId(id));
        if (!target) return;
        event.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
      }}>[{labelOf(id)}]</a>;
  };
  const structured = !isUser && isStructuredRagReply(content);
  const cursor = !isUser && streamActive;
  const navActions = !isUser && (!streamActive || message.dashboard) ? (message.actions ?? []).filter(isChatNavigationAction) : [];
  const followUps = !isUser && !streamActive && onFollowUp ? (message.actions ?? []).filter(isChatFollowUpAction) : [];
  const drafts = !isUser && !streamActive ? (message.actions ?? []).filter(isPaperOrderDraftAction) : [];

  const handleCopy = async () => {
    try {
      // 複製畫面上的正文與來源標題，引用編號和畫面一致。
      await navigator.clipboard.writeText(chatCopyText(message.content, sources));
      setCopied(true);
      toast.success('已複製回覆');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('無法複製，請手動選取文字');
    }
  };

  const time = entryTime(message.timestamp);
  const statusLabel = !isUser && message.status
    ? { streaming: '生成中', completed: '已完成', failed: '回覆失敗', interrupted: '回覆已中斷；可重新提問。' }[message.status]
    : null;

  return (
    <motion.div
      id={answerTargetId}
      data-message-id={message.id}
      data-message-role={message.role}
      tabIndex={answerTargetId ? -1 : undefined}
      className={cn(
        'min-w-0 border-b px-4 py-4 sm:px-5',
        // 日誌條目：提問用左側 2px 粗線與淺底區分，回覆是一般的有線區塊
        isUser ? 'border-l-2 border-l-border-strong bg-muted' : 'bg-card',
        answerTargetId && 'focus:outline-2 focus:outline-offset-[-2px] focus:outline-focus',
      )}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: [0.2, 0, 0, 1] }}
    >
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="characteristic flex flex-wrap items-center gap-x-2">
          <span className={isUser ? 'text-subtle' : undefined}>{isUser ? '提問' : 'AI 回覆'}</span>
          {time ? <><span aria-hidden>·</span><time dateTime={message.timestamp}>{time}</time></> : null}
        </p>
        <div className="flex items-center gap-1">
          {statusLabel ? <p className={cn('characteristic', message.status === 'failed' && 'text-danger')} aria-live="polite">
            {statusLabel}
            {message.status === 'failed' && message.error ? `：${message.error}` : ''}
          </p> : null}
          {!isUser && message.content.trim() ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void handleCopy()}
              aria-label={copied ? '已複製' : '複製回覆'}
              className="-my-2.5 -mr-2.5 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check size={16} className="text-success" aria-hidden /> : <Copy size={16} aria-hidden />}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('mt-2 min-w-0 text-[15px] leading-[1.8]', !message.dashboard && !structured && 'max-w-[46em]')}>
        {!isUser && message.dashboard ? <h4 className="mb-1 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">AI 解讀</h4> : null}
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
            {cursor ? <StreamCursor /> : null}
          </>
        )}
      </div>

      {!isUser && citedIds.length > 0 ? <div id={citationsTargetId}
        tabIndex={citationsTargetId ? -1 : undefined} aria-label="引用來源"
        className={cn('mt-4 border-t', citationsTargetId && 'focus:outline-2 focus:outline-offset-2 focus:outline-focus')}>
      {citedIds.length ? (
        <section className="pt-3 text-sm" aria-label="引用來源">
          <h3 className="mb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">引用來源</h3>
          {/* 有線的列：標記在左側欄，標題在右 */}
          <ul className="divide-y border-y leading-relaxed">
            {[...citedIds].sort((a, b) => Number(labels.get(a) ?? Infinity) - Number(labels.get(b) ?? Infinity)).map((id) => <li key={id} id={sourceId(id)} tabIndex={-1} className="focus:outline-2 focus:outline-offset-2 focus:outline-focus grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2">
              {renderCitation(id, 'margin')}
              <span className="py-2.5 break-words whitespace-pre-wrap text-subtle">{sourceMap.get(id)?.title ?? '來源無法使用'}</span>
            </li>)}
          </ul>
        </section>
      ) : null}

      </div> : null}

      {followUps.length > 0 ? (
        <div className="mt-4" role="group" aria-label="建議追問">
          <p className="mb-1 text-[13px] font-medium tracking-[0.04em] text-muted-foreground" aria-hidden>建議追問</p>
          {/* 追問是送出問題，不是換頁：用精簡的底線文字鈕排成一列（可換行），和有箭頭的導覽列分開層級 */}
          <div className="flex flex-wrap gap-x-5">
            {followUps.map((action, index) => (
              <button
                key={`${action.query}-${index}`}
                type="button"
                disabled={followUpDisabled}
                onClick={() => onFollowUp?.(action.query)}
                className={followUpClass}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {drafts.map((action) => <div className="mt-4" key={action.draft_id}><PaperOrderDraft initial={action} requestId={action.draft_id} /></div>)}

      {navActions.length > 0 ? (
        <nav className="mt-4" aria-label="相關功能">
          <p className="mb-1 text-[13px] font-medium tracking-[0.04em] text-muted-foreground" aria-hidden>相關功能</p>
          {/* 換頁是次要連結：底線文字（至少 44px 高），後面一個小箭頭表示會離開對話 */}
          <div className="flex flex-wrap gap-x-5">
            {navActions.map((action, index) => (
              <Link key={`${action.path}-${index}`} href={action.path} className={navLinkClass}>
                <span className="min-w-0 underline decoration-input underline-offset-4 group-hover:decoration-foreground">{action.label}</span>
                {rowArrow}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </motion.div>
  );
}
