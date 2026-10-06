import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NotificationPreferences } from '../../lib/api/notifications';
import { FeedbackLine, preferencesSnapshot } from './NotificationSettings';

const prefs: NotificationPreferences = {
  daily_summary: true,
  price_alert: false,
  major_news: true,
  price_threshold: 5,
  quiet_start: 22,
  quiet_end: 8,
};

// 「尚未儲存」：表單和最近一次載入／儲存的內容不同才標示（04-T1）
const saved = preferencesSnapshot(prefs, true);
assert.equal(preferencesSnapshot({ ...prefs }, true), saved, 'Same values must not be dirty');
assert.notEqual(preferencesSnapshot({ ...prefs, price_alert: true }, true), saved, 'Toggling a kind must be dirty');
assert.notEqual(preferencesSnapshot({ ...prefs, price_threshold: 6 }, true), saved, 'Changing the threshold must be dirty');
assert.notEqual(preferencesSnapshot(prefs, false), saved, 'Turning quiet hours off must be dirty');
assert.equal(preferencesSnapshot(null, true), '', 'No form yet means nothing to save');

// 操作結果只出現在按下的那一區（儲存鈕旁），不在頁首
const success = { area: 'prefs' as const, tone: 'success' as const, text: '通知偏好已儲存。' };
assert.match(renderToStaticMarkup(<FeedbackLine feedback={success} area="prefs" />), /role="status"[^>]*>.*通知偏好已儲存。/);
assert.equal(renderToStaticMarkup(<FeedbackLine feedback={success} area="inbox" />), '', 'Feedback must stay in its own area');
assert.equal(renderToStaticMarkup(<FeedbackLine feedback={null} area="prefs" />), '');
const failure = { area: 'prefs' as const, tone: 'danger' as const, text: '目前無法連線到伺服器，請稍後再試。' };
assert.match(renderToStaticMarkup(<FeedbackLine feedback={failure} area="prefs" />), /role="alert"/, 'Save failures must be announced next to the button');

console.log('Notification settings tests passed: dirty detection and feedback placement.');
