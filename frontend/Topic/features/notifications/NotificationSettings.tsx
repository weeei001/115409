import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { fetchNotificationInbox, fetchNotificationPreferences, saveNotificationPreferences, type InboxNotification, type NotificationPreferences } from '@/lib/api/notifications';
import { deviceEnabled, disablePush, enablePush, pushConfigured, PUSH_EVENT } from '@/lib/notifications/push';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { notificationAccountSnapshot, subscribeNotificationAccount } from '@/lib/notifications/account';

const buttonClass = 'min-h-11 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60';
const inputClass = 'min-h-11 w-full rounded-lg border bg-background px-3 py-2';
export function NotificationSettings() {
  const account = useSyncExternalStore(subscribeNotificationAccount, notificationAccountSnapshot, () => '');
  return account ? <AccountNotificationSettings key={account} account={account} /> : null;
}

function AccountNotificationSettings({ account }: { account: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setEnabled(deviceEnabled());
    setError('');
    void Promise.all([fetchNotificationPreferences(), fetchNotificationInbox()]).then(([prefs, inbox]) => {
      if (active && notificationAccountSnapshot() === account) { setPreferences(prefs); setItems(inbox); }
    }).catch((err) => { if (active && notificationAccountSnapshot() === account) setError(userFacingMessage(err, '無法載入通知，請重試。')); });
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
  return <section id="notifications" aria-labelledby="notifications-heading" className="scroll-mt-36 rounded-2xl border bg-card p-5 shadow-card sm:p-6">
    <h2 id="notifications-heading" className="mb-3 flex items-center gap-2 text-base font-semibold"><Bell size={18} aria-hidden />通知設定</h2>
    <p className="mb-4 text-sm text-muted-foreground">每日摘要、漲跌幅與重大事件集中在這裡。啟用裝置通知後，也能收到推播。</p>
    {error && <p id="notification-error" role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
    {!preferences ? <button type="button" className={buttonClass} onClick={() => setRevision((value) => value + 1)}>重新載入通知</button> : <form className="space-y-4" aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      void run(async () => { setPreferences(await saveNotificationPreferences(preferences)); setMessage('通知偏好已儲存。'); });
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
        <div className="grid grid-cols-2 gap-3">
          {(['quiet_start', 'quiet_end'] as const).map((key) => <label key={key} className="text-sm">{key === 'quiet_start' ? '安靜時段開始' : '安靜時段結束'}
            <select value={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: Number(event.target.value) })} className={inputClass} aria-describedby="quiet-notification-help">
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </label>)}
        </div>
        <p id="quiet-notification-help" className="text-xs text-muted-foreground">台灣時間。開始與結束相同代表不啟用安靜時段。</p>
        <button type="submit" className={buttonClass}>{busy ? '處理中…' : '儲存通知偏好'}</button>
      </fieldset>
    </form>}
    <div className="my-5 rounded-xl bg-muted p-4">
      <p className="mb-2 text-sm">此裝置：{enabled ? '已啟用推播' : '尚未啟用推播'}</p>
      {!pushConfigured() && <p className="mb-2 text-xs text-muted-foreground">推播服務尚未設定完成；仍可查看下方通知紀錄。</p>}
      <button type="button" disabled={busy || !pushConfigured()} className={buttonClass} onClick={() => void run(async () => {
        if (enabled) await disablePush(); else await enablePush();
        setEnabled(deviceEnabled()); setMessage(enabled ? '已關閉此裝置推播。' : '此裝置已啟用推播。');
      })}>{enabled ? '關閉此裝置推播' : '啟用此裝置推播'}</button>
    </div>
    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">最近通知</h3><button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => { setItems(await fetchNotificationInbox()); setMessage('通知紀錄已更新。'); })}>重新整理通知</button></div>
    {items.length === 0 ? <p className="text-sm text-muted-foreground">尚無通知。收藏個股並開啟通知種類後，符合條件的事件會出現在這裡。</p> : <ul className="space-y-3">
      {items.map((item) => <li key={item.id} className="rounded-xl border p-3">
        <Link href={safeReturnUrl(item.url) || '/favorites#notifications'} className="text-sm font-medium text-brand-text underline-offset-4 hover:underline">{item.title}</Link>
        <p className="mt-1 whitespace-pre-line text-sm text-subtle">{item.body}</p>
        <time dateTime={item.created_at} className="mt-2 block text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</time>
      </li>)}
    </ul>}
  </section>;
}
