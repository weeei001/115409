import assert from 'node:assert/strict';
import { acknowledgeRiskNotice, hasAcknowledgedRiskNotice, RISK_NOTICE_KEY } from './riskNotice';

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
};

assert.equal(hasAcknowledgedRiskNotice(storage), false, 'first visit shows the notice');
acknowledgeRiskNotice(storage);
assert.equal(memory.get(RISK_NOTICE_KEY), '1');
assert.equal(hasAcknowledgedRiskNotice(storage), true, 'acknowledged visitors do not see it again');

const blocked = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};
assert.equal(hasAcknowledgedRiskNotice(blocked), false, 'unreadable storage still shows the notice');
assert.doesNotThrow(() => acknowledgeRiskNotice(blocked));
assert.equal(hasAcknowledgedRiskNotice(null), false);
assert.doesNotThrow(() => acknowledgeRiskNotice(undefined));

console.log('Risk notice passed: shown until acknowledged, tolerant of blocked storage.');
