import assert from 'node:assert/strict';
import type { InternalAxiosRequestConfig } from 'axios';
import apiClient from './client';
import { fetchAdminRun } from './admin';

async function main() {
  const requests: InternalAxiosRequestConfig[] = [];
  const originalAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { id: Number(config.url!.split('/').at(-1)) }, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    const controller = new AbortController();
    for (const value of [1, '7', 2147483647, '2147483647']) {
      const data = await fetchAdminRun(value, controller.signal);
      const config = requests.at(-1)!;
      assert.equal(data.id, Number(value));
      assert.equal(config.url, `/admin/runs/${Number(value)}`);
      assert.equal(config.signal, controller.signal);
      assert.equal(new URL(config.url!, config.baseURL).origin, new URL(config.baseURL!).origin);
    }
    const beforeInvalid = requests.length;
    for (const value of [
      undefined, null, {}, ['7'], 0, -1, 7.5, NaN, Infinity, 2147483648,
      '', '0', '007', '+7', '7.0', '7e1', '7 ', '7#fragment', '7?url=https://outside.test',
      '../7', '7/../../stocks', '7%2f..', '//outside.test', 'https://outside.test', '\\outside.test',
    ]) {
      await assert.rejects(fetchAdminRun(value), /Invalid run identifier/);
    }
    assert.equal(requests.length, beforeInvalid, 'Invalid run identifiers must never reach the API adapter.');
  } finally {
    apiClient.defaults.adapter = originalAdapter;
  }
  console.log('Admin run requests enforce the positive 32-bit identifier contract before dispatch.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
