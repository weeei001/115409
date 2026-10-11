import assert from 'node:assert/strict';
import apiClient from './client';
import { fetchNewsDetail, fetchNewsIndustries } from './news';

async function check() {
  const requests: Array<{ url?: string; stock?: string }> = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push({ url: config.url, ...config.params });
    return { data: { article_id: 'a', content: 'current' },
      status: 200, statusText: 'OK', headers: {}, config };
  };
  const [first, duplicate, current] = await Promise.all([
    fetchNewsDetail('a', '2330'), fetchNewsDetail('a', '2330'), fetchNewsDetail('a'),
  ]);
  assert.equal(first.content, 'current');
  assert.equal(duplicate.content, 'current');
  assert.equal(current.content, 'current');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], { url: '/news/a', stock: '2330' });
  assert.deepEqual(requests[1], { url: '/news/a' });
  console.log('News requests fetch current articles and dedupe identical stock queries.');

  // /news/industries: openapi has no response schema, so malformed items are dropped; the list is cached.
  let industryCalls = 0;
  apiClient.defaults.adapter = async (config) => {
    industryCalls += 1;
    assert.equal(config.url, '/news/industries');
    return { data: { items: [{ id: 'TWSE:24', name: '上市 · 半導體業' }, { id: 24, name: 'bad' }, null, { id: 'TPEx:24' }] },
      status: 200, statusText: 'OK', headers: {}, config };
  };
  assert.deepEqual(await fetchNewsIndustries(), [{ id: 'TWSE:24', name: '上市 · 半導體業' }]);
  assert.deepEqual(await fetchNewsIndustries(), [{ id: 'TWSE:24', name: '上市 · 半導體業' }]);
  assert.equal(industryCalls, 1, 'industry list is cached');
  console.log('News industry list keeps only well-formed items and is cached.');
}
void check();
