import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell, CalendarDays, Newspaper, TrendingUp } from 'lucide-react';
import { fetchNotificationInbox, fetchNotificationPreferences, saveNotificationPreferences, type InboxNotification, type NotificationPreferences } from '@/lib/api/notifications';
import { deviceEnabled, disablePush, enablePush, pushConfigured, PUSH_EVENT } from '@/lib/notifications/push';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

const buttonClass = 'min-h-11 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60';
const inputClass = 'min-h-11 w-full rounded-lg border bg-background px-3 py-2';
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
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setEnabled(deviceEnabled());
    setError('');
    setLoading(true);
    void Promise.all([fetchNotificationPreferences(), fetchNotificationInbox()]).then(([prefs, inbox]) => {
      if (active && notificationAccountSnapshot() === account) {
        const hasQuietHours = prefs.quiet_start !== prefs.quiet_end;
        setQuietEnabled(hasQuietHours);
        setPreferences(hasQuietHours ? prefs : { ...prefs, quiet_start: 22, quiet_end: 8 });
        setItems(inbox);
      }
    }).catch((err) => { if (active && notificationAccountSnapshot() === account) setError(userFacingMessage(err, '無法載入通知，請重試。')); })
      .finally(() => { if (active && notificationAccountSnapshot() === account) setLoading(false); });
    const refreshInbox = () => { void fetchNotificationInbox().then((inbox) => { if (active && notificationAccountSnapshot() === account) setItems(inbox); }).catch(() => {}); };
    window.addEventListener(PUSH_EVENT, refreshInbox);
    return () => { active = false; window.removeEventListener(PUSH_EVENT, refreshInbox); };
  }, [revision, account]);
  async function run(action: () => Promise<void>) {
    if (notificationAccountSnapshot() !== account) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (err) { setError(userFacingMessage(err, '操作失敗，請稍後重試。')); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {error && <p id="notification-error" role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    <p role="status" className={message ? 'text-sm text-muted-foreground' : 'sr-only'}>{message}</p>
    <section aria-labelledby="notifications-heading" className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="notifications-heading" className="text-base font-semibold">最近通知</h2>
        <button type="button" className={buttonClass} disabled={busy || loading} onClick={() => void run(async () => { setItems(await fetchNotificationInbox()); setMessage('通知紀錄已更新。'); })}>重新整理通知</button>
      </div>
      {loading ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">載入通知中…</p> : items === null ? (
        <button type="button" className={buttonClass} onClick={() => setRevision((value) => value + 1)}>重新載入通知</button>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <Bell size={28} className="mx-auto mb-3 text-muted-foreground" aria-hidden />
          <p className="font-medium">尚無通知</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">收藏個股並在下方開啟通知種類後，符合條件的每日摘要、漲跌幅與重大新聞會出現在這裡。</p>
          <Link href="/favorites" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline-offset-4 hover:underline">管理收藏股</Link>
        </div>
      ) : <ul className="divide-y">
        {items.map((item) => {
          const { label, icon: Icon } = notificationKinds[item.kind] ?? { label: '通知', icon: Bell };
          return <li key={item.id} className="py-5 first:pt-0 last:pb-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Icon size={14} aria-hidden />{label}</span>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</time>
            </div>
            <Link href={safeReturnUrl(item.url) || '/notifications'} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline-offset-4 hover:underline">{item.title}</Link>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-subtle">{item.body}</p>
          </li>;
        })}
      </ul>}
    </section>
    <section aria-labelledby="device-notifications-heading" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
      <div>
        <h2 id="device-notifications-heading" className="text-sm font-semibold">此裝置推播</h2>
        <p className="mt-1 text-sm text-muted-foreground">{enabled ? '已啟用，重要消息會推播到此裝置。' : '啟用後，不必開啟網站也能收到提醒。'}</p>
        {!pushConfigured() && <p className="mt-2 text-xs text-muted-foreground">推播服務尚未設定完成；仍可查看通知紀錄。</p>}
      </div>
      <button type="button" disabled={busy || !pushConfigured()} className={buttonClass} onClick={() => void run(async () => {
        if (enabled) await disablePush(); else await enablePush();
        setEnabled(deviceEnabled()); setMessage(enabled ? '已關閉此裝置推播。' : '此裝置已啟用推播。');
      })}>{enabled ? '關閉此裝置推播' : '啟用此裝置推播'}</button>
    </section>
    <section aria-labelledby="notification-preferences-heading" className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="notification-preferences-heading" className="mb-1 text-base font-semibold">通知偏好</h2>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">設定通知種類、漲跌幅門檻與安靜時段</summary>
        {!preferences ? <button type="button" disabled={loading} className={buttonClass} onClick={() => setRevision((value) => value + 1)}>{loading ? '載入設定中…' : '重新載入設定'}</button> : <form className="mt-3 space-y-4" aria-busy={busy} onSubmit={(event) => {
          event.preventDefault();
          if (quietEnabled && preferences.quiet_start === preferences.quiet_end) return;
          void run(async () => {
            // Preserve the existing API representation of disabled quiet hours.
            await saveNotificationPreferences(quietEnabled ? preferences : { ...preferences, quiet_start: 0, quiet_end: 0 });
            setMessage('通知偏好已儲存。');
          });
        }}>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="sr-only">通知種類</legend>
            {([
              ['daily_summary', '收藏股每日摘要', '交易日收盤後，彙整收藏股漲跌與重要新聞。'],
              ['price_alert', '單日漲跌幅提醒', '依最近儲存行情判定，非盤中即時報價。'],
              ['major_news', '重大新聞／公告', '收藏公司出現重要事件時通知，合併可辨識的重複事件。'],
            ] as const).map(([key, label, description]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
              <input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} className="mt-1 size-4 accent-current" />
              <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{description}</span></span>
            </label>)}
            <label className="block text-sm">漲跌幅門檻（%）
              <input type="number" min="1" max="30" step="0.1" required value={preferences.price_threshold} onChange={(event) => setPreferences({ ...preferences, price_threshold: Number(event.target.value) })} className={inputClass} aria-describedby="price-notification-help" />
            </label>
            <p id="price-notification-help" className="text-xs text-muted-foreground">相較前一交易日收盤價；每檔股票的上漲、下跌方向每日各提醒一次。</p>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input type="checkbox" role="switch" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} className="size-4 accent-current" aria-describedby="quiet-notification-help" />
              啟用安靜時段
            </label>
            <p id="quiet-notification-help" className="text-xs text-muted-foreground">{quietEnabled ? '指定時段內暫停推播，通知紀錄仍可查看。時間以台灣時間為準。' : '不限制推播時間。'}</p>
            {quietEnabled && <><div className="grid grid-cols-2 gap-3">
              {(['quiet_start', 'quiet_end'] as const).map((key) => <label key={key} className="text-sm">{key === 'quiet_start' ? '安靜時段開始' : '安靜時段結束'}
                <select value={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: Number(event.target.value) })} className={inputClass} aria-invalid={preferences.quiet_start === preferences.quiet_end} aria-describedby="quiet-time-help">
                  {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                </select>
              </label>)}
            </div>
            <p id="quiet-time-help" className={`text-xs ${preferences.quiet_start === preferences.quiet_end ? 'text-danger' : 'text-muted-foreground'}`}>
              {preferences.quiet_start === preferences.quiet_end ? '結束時間不能與開始時間相同，請選擇其他時間。' : `每日 ${String(preferences.quiet_start).padStart(2, '0')}:00 至${preferences.quiet_start > preferences.quiet_end ? '隔日 ' : ' '}${String(preferences.quiet_end).padStart(2, '0')}:00 暫停推播。`}
            </p></>}
            <button type="submit" disabled={quietEnabled && preferences.quiet_start === preferences.quiet_end} className={buttonClass}>{busy ? '處理中…' : '儲存通知偏好'}</button>
          </fieldset>
        </form>}
      </details>
    </section>
  </div>;
}
