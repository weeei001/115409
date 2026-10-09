import assert from 'node:assert/strict';
import type { InternalAxiosRequestConfig } from 'axios';
import apiClient, { ApiRequestError } from './client';
import { adminChatErrorMessage, fetchAdminChat, fetchAdminChats, INITIAL_ADMIN_CHAT_FILTERS, type AdminChatFilters } from './adminChat';

async function main() {
  const requests: InternalAxiosRequestConfig[] = [];
  const previousAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { id: config.url?.split('/').at(-1), items: [], total: 0, retention_days: 14 }, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    const controller = new AbortController();
    await fetchAdminChats({ days: 7, outcome: 'repaired', reason: 'numbers', q: '  2330 &offset=999  ' }, 20, controller.signal);
    const list = requests.at(-1)!;
    assert.equal(list.url, '/admin/ai-conversations');
    assert.deepEqual(list.params, { days: 7, limit: 20, offset: 20, outcome: 'repaired', reason: 'numbers', q: '2330 &offset=999' });
    assert.equal(list.signal, controller.signal);
    await fetchAdminChats({ ...INITIAL_ADMIN_CHAT_FILTERS, outcome: '', q: ' ', reason: '' });
    assert.deepEqual(requests.at(-1)!.params, { days: 14, limit: 20, offset: 0 });

    const id = 'c327bda8-8c63-469a-9f42-77a09a914ee7';
    const detail = await fetchAdminChat(id, controller.signal);
    const config = requests.at(-1)!;
    assert.equal(detail.id, id);
    assert.equal(config.url, `/admin/ai-conversations/${id}`);
    assert.equal(config.signal, controller.signal);
    assert.equal(new URL(config.url!, config.baseURL).origin, new URL(config.baseURL!).origin);

    const beforeInvalid = requests.length;
    for (const invalid of [undefined, null, {}, [id], 1, '', '../admin', `${id}/../../stocks`, `${id}?url=https://outside.test`, `${id}#fragment`, '//outside.test', 'https://outside.test']) {
      await assert.rejects(fetchAdminChat(invalid), /Invalid chat review identifier/);
    }
    for (const invalid of [0, -1, 15, NaN, 1.5]) {
      await assert.rejects(fetchAdminChats({ ...INITIAL_ADMIN_CHAT_FILTERS, days: invalid }), /Invalid chat review date range/);
    }
    for (const invalid of [-1, NaN, 1.5, 100001]) {
      await assert.rejects(fetchAdminChats(INITIAL_ADMIN_CHAT_FILTERS, invalid), /Invalid chat review offset/);
    }
    await assert.rejects(fetchAdminChats({ ...INITIAL_ADMIN_CHAT_FILTERS, outcome: 'unexpected' as AdminChatFilters['outcome'] }), /Invalid chat review outcome/);
    await assert.rejects(fetchAdminChats({ ...INITIAL_ADMIN_CHAT_FILTERS, q: 'a'.repeat(121) }), /Invalid chat review filter length/);
    await assert.rejects(fetchAdminChats({ ...INITIAL_ADMIN_CHAT_FILTERS, reason: 'a'.repeat(65) }), /Invalid chat review filter length/);
    assert.equal(requests.length, beforeInvalid, 'Malformed routes and filters never reach the adapter.');

    const schemaError = new ApiRequestError('AI 對話檢核資料表尚未初始化，請完成資料庫更新後再試。', 503);
    assert.match(adminChatErrorMessage(schemaError), /資料表尚未初始化.*HTTP 503/);
    assert.match(adminChatErrorMessage(new ApiRequestError('找不到', 404), true), /保存期限.*原對話已刪除/);
    assert.doesNotMatch(adminChatErrorMessage(new Error('Traceback secret SQL SELECT * FROM users')), /Traceback|secret|SQL/);
  } finally {
    apiClient.defaults.adapter = previousAdapter;
  }
  console.log('Admin chat API checks passed: fixed routes, bounded filters, pagination, cancellation signals, and actionable errors.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
