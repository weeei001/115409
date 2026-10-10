import assert from 'node:assert/strict';
import { TIMEOUT_MESSAGE, genericMessageForStatus, isUserReadable, pickDetailMessage, userFacingMessage, withDateRangeHint } from './errorDetail';

// The news 404 detail once came back as mojibake that still contains CJK characters.
const garbled = '?\u66C6??\u5533?\u6470\uEAF2??\u5557??\uF2EB?';

assert.equal(isUserReadable('找不到指定的新聞文章'), true);
assert.equal(isUserReadable('找不到股票 0000 的價格資料'), true);
assert.equal(isUserReadable('要比較哪幾檔股票？'), true, 'full-width question mark is normal copy');
assert.equal(isUserReadable('Not Found'), false);
assert.equal(isUserReadable(garbled), false, 'mojibake with CJK must not be shown');
assert.equal(isUserReadable('找不到\uFFFD資料'), false, 'replacement character means a decoding failure');
assert.equal(isUserReadable('找不到\uE000資料'), false, 'private-use characters mean a decoding failure');

assert.equal(pickDetailMessage({ detail: garbled }, 404), genericMessageForStatus(404));
assert.equal(pickDetailMessage({ detail: '找不到指定的新聞文章' }, 404), '找不到指定的新聞文章');
assert.equal(userFacingMessage(new Error(garbled), 'fallback'), 'fallback');

// 模型服務的結構化錯誤只顯示可讀訊息，不展開代碼或內部診斷內容。
const modelMessage = '模型服務暫時無法回應，請稍後重試';
const modelDetail = {
  code: 'upstream_model_error', message: modelMessage,
  context: { token: 'fixture-secret-token', upstream: 'http://internal-provider', trace: 'Traceback' },
};
assert.equal(pickDetailMessage({ detail: modelDetail }, 503), modelMessage);
assert.equal(pickDetailMessage({ detail: { ...modelDetail, msg: '請稍候再試' } }, 503), '請稍候再試');
for (const message of [null, 123, {}, [], '', 'Model unavailable', garbled,
  '模型服務錯誤 APIConnectionError', '模型服務錯誤 https://internal-provider']) {
  assert.equal(pickDetailMessage({ detail: { ...modelDetail, message } }, 503), genericMessageForStatus(503));
}
assert.equal(pickDetailMessage({ detail: { code: modelDetail.code, context: modelDetail.context } }, 503), genericMessageForStatus(503));

// Backend details that embed technical content fall back to generic copy (05-D1, 02-F3).
assert.equal(isUserReadable('start_time 不得晚於 end_time'), false, 'snake_case field names');
assert.equal(isUserReadable('as_of 格式錯誤，請用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS'), false);
assert.equal(isUserReadable('找不到資料 http://10.0.0.12:8002/internal'), false, 'http URL');
assert.equal(isUserReadable('找不到資料 https://example.com/a'), false, 'https URL');
assert.equal(isUserReadable('發生錯誤 traceback (most recent call last)'), false, 'traceback, any case');
assert.equal(isUserReadable('發生錯誤 File "/app/main.py", line 88'), false);
assert.equal(isUserReadable('查詢失敗 select * from news'), false, 'SQL, any case');
assert.equal(isUserReadable('查詢失敗 psycopg2 連線中斷'), false);
assert.equal(isUserReadable('查詢失敗 ValueError 例外'), false, 'exception class names');
assert.equal(isUserReadable("無效的股票代號，支援：['2330', '2317']"), false, 'Python list repr (retrieval/service.py)');
assert.equal(isUserReadable("移動平均線週期格式錯誤: invalid literal for int() with base 10: 'x'"), false, 'exception text (market/service.py)');
const injected = '找不到新聞<img src=x onerror="push(1)"> psycopg2.errors.UndefinedTable: relation "news_v2" does not exist; '
  + 'SELECT * FROM news_v2 WHERE id=\'x\' -- http://10.0.0.12:8002/internal Traceback (most recent call last): File "/app/app/features/news/service.py", line 88';
assert.equal(pickDetailMessage({ detail: injected }, 404), genericMessageForStatus(404), 'sec-probe news-error 404');
assert.equal(pickDetailMessage({ detail: injected }, 500), genericMessageForStatus(500), 'sec-probe news-error 500');
assert.equal(pickDetailMessage({ detail: 'start_time 不得晚於 end_time' }, 400), genericMessageForStatus(400));
assert.equal(userFacingMessage(new Error('start_time 不得晚於 end_time'), 'fallback'), 'fallback');
// Plain Chinese details from the backend stay as they are.
for (const ok of ['帳號或密碼錯誤', '此 email 已註冊', '此 email 已綁定其他 Google 帳號', '持股不足：此標的目前可賣 3 張，無法賣出 5 張',
  '找不到股票 2330 在 2026-10-01 的日線資料，請改選交易日', '移動平均線週期格式錯誤: 最多支援5條移動平均線', 'AI 服務尚未設定，請稍後重試']) {
  assert.equal(isUserReadable(ok), true, ok);
}

// Generic copy per status (05 copy review).
assert.equal(genericMessageForStatus(401), '登入已過期，請重新登入。');
assert.equal(genericMessageForStatus(403), '這個帳號沒有權限使用此功能。');
assert.equal(genericMessageForStatus(409), '這筆資料已經存在，請確認後再試。');
assert.equal(genericMessageForStatus(429), '操作太頻繁，請稍等一下再試。');
assert.equal(genericMessageForStatus(418), '暫時無法完成，請稍後再試。');
for (const status of [400, 401, 403, 404, 409, 418, 422, 429, 500]) {
  assert.ok(!/請求|HTTP|\d{3}/.test(genericMessageForStatus(status)), `no technical wording for ${status}`);
}

// formatAdvisorError detects timeouts by the word 逾時.
assert.ok(TIMEOUT_MESSAGE.includes('逾時'));
assert.notEqual(withDateRangeHint(TIMEOUT_MESSAGE), TIMEOUT_MESSAGE, 'date-range charts add a next step on timeout');
assert.ok(withDateRangeHint(TIMEOUT_MESSAGE).includes('逾時'));
assert.equal(withDateRangeHint(genericMessageForStatus(500)), genericMessageForStatus(500), 'other errors stay unchanged');

console.log('errorDetail rejects mojibake and technical details, maps statuses to plain copy, and only adds the date-range hint on timeouts.');
