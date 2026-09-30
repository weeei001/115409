import assert from 'node:assert/strict';
import apiClient from './client';
import { fetchNewsDetail } from './news';

async function check() {
  const requests: Array<{ url?: string; stock?: string; revision_id?: string }> = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push({ url: config.url, ...config.params });
    return { data: { article_id: 'a', content: config.params.revision_id ?? 'current' },
      status: 200, statusText: 'OK', headers: {}, config };
  };
  const revision = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const [first, duplicate, second, current] = await Promise.all([
    fetchNewsDetail('a', '2330', revision), fetchNewsDetail('a', '2330', revision),
    fetchNewsDetail('a', '2330', other), fetchNewsDetail('a'),
  ]);
  assert.equal(first.content, revision);
  assert.equal(duplicate.content, revision);
  assert.equal(second.content, other);
  assert.equal(current.content, 'current');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0], { url: '/news/a', stock: '2330', revision_id: revision });
  console.log('News revision requests preserve query identity and dedupe only identical versions.');
}
void check();
