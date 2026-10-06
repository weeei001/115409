import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, CalendarDays, Newspaper, RefreshCw, TrendingUp } from 'lucide-react';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Ledger, LedgerPanel, LightGlyph } from '@/components/common/Ledger';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { fieldLabelClass, inputClass } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/cn';
import { fetchNotificationInbox, fetchNotificationPreferences, saveNotificationPreferences, type InboxNotification, type NotificationPreferences } from '@/lib/api/notifications';
import { deviceEnabled, disablePush, enablePush, pushConfigured, PUSH_EVENT } from '@/lib/notifications/push';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';
import { formatTaipei } from '@/lib/utils/date';

/** 標籤下方的輸入框（全站同一套外觀，見 components/ui/input） */
const fieldInput = cn('mt-1.5', inputClass);
const checkboxClass = 'mt-0.5 size-4 shrink-0 cursor-pointer accent-current disabled:cursor-not-allowed disabled:opacity-50';
/** 整列可點的勾選列：hover 換淺色底（DESIGN.md 條目列） */
const checkRowClass = 'cursor-pointer px-2 transition-colors duration-(--dur-flash) hover:bg-accent';

/** 操作結果寫在按下的那顆按鈕旁邊；寫在頁首的話，捲到下方按儲存時看不到（04-T1） */
export type FeedbackArea = 'inbox' | 'device' | 'prefs';
export interface Feedback {
  area: FeedbackArea;
  tone: 'success' | 'danger';
  text: string;
}

/** 偏好表單的內容（含安靜時段開關），用來判斷有沒有改了沒存 */
export function preferencesSnapshot(preferences: NotificationPreferences | null, quietEnabled: boolean): string {
  return preferences ? JSON.stringify([preferences, quietEnabled]) : '';
}

export function FeedbackLine({ feedback, area }: { feedback: Feedback | null; area: FeedbackArea }) {
  if (feedback?.area !== area) return null;
  return <Notice tone={feedback.tone} className="mt-3">{feedback.text}</Notice>;
}
const notificationKinds: Record<string, { label: string; icon: typeof Bell }> = {
  daily_summary: { label: '每日摘要', icon: CalendarDays },
  price_alert: { label: '漲跌幅提醒', icon: TrendingUp },
  major_news: { label: '重大新聞／公告', icon: Newspaper },
};

export function NotificationSettings() {
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');
  return account ? <AccountNotificationSettings key={account} account={account} /> : null;
}

function AccountNotificationSettings({ account }: { account: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 載入失敗：只在頁首說一次，下面各區只寫「載入失敗」（05：避免同時 3 個錯誤、3 個重試） */
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /** 最近一次載入或儲存成功的偏好；和目前的表單不同就標「尚未儲存」 */
  const [savedPrefs, setSavedPrefs] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setEnabled(deviceEnabled());
    setError('');
    setLoading(true);
    void Promise.all([fetchNotificationPreferences(), fetchNotificationInbox()]).then(([prefs, inbox]) => {
      if (active && notificationAccountSnapshot() === account) {
        const hasQuietHours = prefs.quiet_start !== prefs.quiet_end;
        const loaded = hasQuietHours ? prefs : { ...prefs, quiet_start: 22, quiet_end: 8 };
        setQuietEnabled(hasQuietHours);
        setPreferences(loaded);
        setSavedPrefs(preferencesSnapshot(loaded, hasQuietHours));
        setItems(inbox);
      }
    }).catch((err) => { if (active && notificationAccountSnapshot() === account) setError(userFacingMessage(err, '無法載入通知，請重試。')); })
      .finally(() => { if (active && notificationAccountSnapshot() === account) setLoading(false); });
    const refreshInbox = () => { void fetchNotificationInbox().then((inbox) => { if (active && notificationAccountSnapshot() === account) setItems(inbox); }).catch(() => {}); };
    window.addEventListener(PUSH_EVENT, refreshInbox);
    return () => { active = false; window.removeEventListener(PUSH_EVENT, refreshInbox); };
  }, [revision, account]);
  async function run(area: FeedbackArea, action: () => Promise<string>) {
    if (notificationAccountSnapshot() !== account) return;
    setBusy(true); setFeedback(null);
    try { setFeedback({ area, tone: 'success', text: await action() }); }
    catch (err) { setFeedback({ area, tone: 'danger', text: userFacingMessage(err, '操作失敗，請稍後重試。') }); }
    finally { setBusy(false); }
  }
  const reload = () => { setFeedback(null); setRevision((value) => value + 1); };
  const quietInvalid = preferences != null && quietEnabled && preferences.quiet_start === preferences.quiet_end;
  const prefsDirty = preferences != null && preferencesSnapshot(preferences, quietEnabled) !== savedPrefs;

  let inbox: ReactNode;
  if (loading) {
    inbox = <div className="bg-card"><LoadingRows label="載入通知中…" className="h-[176px]" /></div>;
  } else if (items === null) {
    // 錯誤與「重試」只在頁首出現一次；這裡只寫狀態
    inbox = <LedgerPanel>{error ? <p className="text-sm text-muted-foreground">載入失敗</p> : <><p className="text-sm text-muted-foreground">通知紀錄沒有載入。</p><Button variant="outline" className="mt-3" onClick={reload}><RefreshCw aria-hidden />重試</Button></>}</LedgerPanel>;
  } else if (items.length === 0) {
    inbox = (
      <LedgerPanel>
        <EmptyState className="py-6" action={<Button asChild variant="outline" className="mt-2"><Link href="/favorites">管理收藏股</Link></Button>}>
          尚無通知。收藏個股並開啟通知種類後，符合條件的每日摘要、漲跌幅與重大新聞會出現在這裡。
        </EmptyState>
      </LedgerPanel>
    );
  } else {
    inbox = (
      <ul className="divide-y bg-card">
        {items.map((item) => {
          const { label, icon: Icon } = notificationKinds[item.kind] ?? { label: '通知', icon: Bell };
          return (
            <li key={item.id}>
              <Link href={safeReturnUrl(item.url) || '/notifications'} className="lamp-row group block px-4 py-3.5 sm:px-5">
                <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="characteristic inline-flex items-center gap-1.5"><Icon size={14} aria-hidden />{label}</span>
                  <time dateTime={item.created_at} className="characteristic">{formatTaipei(item.created_at)}</time>
                </span>
                <span className="mt-1.5 block text-[15px] font-medium underline decoration-transparent underline-offset-4 transition-colors duration-(--dur-flash) group-hover:decoration-input">{item.title}</span>
                <span className="mt-1 block text-sm leading-relaxed whitespace-pre-line text-subtle">{item.body}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return <div className="space-y-6">
    {error ? <Notice tone="danger" action={<Button variant="outline" onClick={reload}><RefreshCw aria-hidden />重試</Button>}>{error}</Notice> : null}
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
      <AnimatedSection className="min-w-0 lg:col-span-7">
        <Ledger
          aria-labelledby="notifications-heading"
          title={<span id="notifications-heading">最近通知</span>}
          stamp={<span className="inline-flex items-center gap-1.5"><LightGlyph state={loading ? 'loading' : items === null ? 'error' : 'ready'} />{loading ? '載入中' : items === null ? '載入失敗' : `${items.length} 則 · 台灣時間`}</span>}
        >
          {inbox}
          {/* 重新整理放在清單尾端：標題列不放按鈕，左右兩欄的帳頁標題才會對齊 */}
          {items !== null && !loading ? <div className="bg-card px-2 py-1 sm:px-3">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run('inbox', async () => { setItems(await fetchNotificationInbox()); return '通知紀錄已更新。'; })}><RefreshCw aria-hidden />重新整理通知</Button>
            <FeedbackLine feedback={feedback} area="inbox" />
          </div> : null}
        </Ledger>
      </AnimatedSection>

      <AnimatedSection delay={0.05} className="min-w-0 space-y-10 lg:col-span-5 lg:space-y-16">
        <Ledger aria-labelledby="device-notifications-heading" title={<span id="device-notifications-heading">此裝置推播</span>} stamp={enabled ? '已啟用' : '未啟用'}>
          <LedgerPanel>
            <p className="text-sm leading-relaxed text-subtle">{enabled ? '已啟用，重要消息會推播到此裝置。' : '啟用後，不必開啟網站也能收到提醒。'}</p>
            {!pushConfigured() && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">推播服務尚未設定完成；仍可查看通知紀錄。</p>}
            <Button variant="outline" className="mt-4 w-full sm:w-auto" disabled={busy || !pushConfigured()} onClick={() => void run('device', async () => {
              if (enabled) await disablePush(); else await enablePush();
              setEnabled(deviceEnabled());
              return enabled ? '已關閉此裝置推播。' : '此裝置已啟用推播。';
            })}>{enabled ? '關閉此裝置推播' : '啟用此裝置推播'}</Button>
            <FeedbackLine feedback={feedback} area="device" />
          </LedgerPanel>
        </Ledger>

        <Ledger aria-labelledby="notification-preferences-heading" title={<span id="notification-preferences-heading">通知偏好</span>}>
          <LedgerPanel>
            {!preferences ? (
              loading ? <LoadingRows label="載入設定中…" className="h-[132px]" />
                : error ? <p className="text-sm text-muted-foreground">載入失敗</p>
                  : <><p className="text-sm text-muted-foreground">通知偏好沒有載入。</p><Button variant="outline" className="mt-3" onClick={reload}><RefreshCw aria-hidden />重試</Button></>
            ) : <form aria-busy={busy} onSubmit={(event) => {
              event.preventDefault();
              if (quietInvalid) return;
              const submitted = preferencesSnapshot(preferences, quietEnabled);
              void run('prefs', async () => {
                // Preserve the existing API representation of disabled quiet hours.
                await saveNotificationPreferences(quietEnabled ? preferences : { ...preferences, quiet_start: 0, quiet_end: 0 });
                setSavedPrefs(submitted);
                return '通知偏好已儲存。';
              });
            }}>
              <fieldset disabled={busy} className="min-w-0 space-y-5">
                <legend className="sr-only">通知種類</legend>
                <div className="grid gap-px border-y bg-border">
                  {([
                    ['daily_summary', '收藏股每日摘要', '交易日收盤後，彙整收藏股漲跌與重要新聞。'],
                    ['price_alert', '單日漲跌幅提醒', '依每日收盤資料判斷，不是盤中即時。'],
                    ['major_news', '重大新聞／公告', '收藏公司有重要事件時通知；重複的事件只通知一次。'],
                  ] as const).map(([key, label, description]) => <label key={key} className={cn('flex min-h-11 items-start gap-3 bg-card py-3', checkRowClass)}>
                    <input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} className={checkboxClass} />
                    <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs leading-relaxed text-muted-foreground">{description}</span></span>
                  </label>)}
                </div>
                <div>
                  <label className={fieldLabelClass}>漲跌幅門檻（%）
                    <input type="number" min="1" max="30" step="0.1" required value={preferences.price_threshold} onChange={(event) => setPreferences({ ...preferences, price_threshold: Number(event.target.value) })} className={cn(fieldInput, 'font-mono tabular-nums')} aria-describedby="price-notification-help" />
                  </label>
                  <p id="price-notification-help" className="mt-1.5 text-xs leading-relaxed text-muted-foreground">相較前一交易日收盤價；每檔股票的上漲、下跌方向每日各提醒一次。</p>
                </div>
                <div className="border-t pt-4">
                  <label className={cn('flex min-h-11 items-center gap-3 text-sm font-medium', checkRowClass)}>
                    <input type="checkbox" role="switch" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} className={cn(checkboxClass, 'mt-0')} aria-describedby="quiet-notification-help" />
                    啟用安靜時段
                  </label>
                  <p id="quiet-notification-help" className="text-xs leading-relaxed text-muted-foreground">{quietEnabled ? '指定時段內暫停推播，通知紀錄仍可查看。時間以台灣時間為準。' : '不限制推播時間。'}</p>
                  {quietEnabled && <>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {(['quiet_start', 'quiet_end'] as const).map((key) => <label key={key} className={fieldLabelClass}>{key === 'quiet_start' ? '安靜時段開始' : '安靜時段結束'}
                        <NativeSelect wrapperClassName="mt-1.5" value={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: Number(event.target.value) })} className="font-mono tabular-nums" aria-invalid={quietInvalid} aria-describedby="quiet-time-help">
                          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                        </NativeSelect>
                      </label>)}
                    </div>
                    <p id="quiet-time-help" className={cn('mt-1.5 text-xs leading-relaxed', quietInvalid ? 'text-danger' : 'text-muted-foreground')}>
                      {quietInvalid ? '結束時間不能與開始時間相同，請選擇其他時間。' : `每日 ${String(preferences.quiet_start).padStart(2, '0')}:00 至${preferences.quiet_start > preferences.quiet_end ? '隔日 ' : ' '}${String(preferences.quiet_end).padStart(2, '0')}:00 暫停推播。`}
                    </p>
                  </>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Button type="submit" disabled={quietInvalid} aria-busy={busy || undefined} aria-describedby={prefsDirty ? 'notification-prefs-dirty' : undefined} className="w-full sm:w-auto sm:min-w-44">{busy ? '處理中…' : '儲存通知偏好'}</Button>
                  {prefsDirty ? <span id="notification-prefs-dirty" className="text-[13px] font-medium text-warning">尚未儲存</span> : null}
                </div>
              </fieldset>
              <FeedbackLine feedback={feedback} area="prefs" />
            </form>}
          </LedgerPanel>
        </Ledger>
      </AnimatedSection>
    </div>
  </div>;
}
