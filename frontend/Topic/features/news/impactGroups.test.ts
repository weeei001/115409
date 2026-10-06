import assert from 'node:assert/strict';
import type { NewsImpact } from '../../lib/types/api';
import { groupImpactsByTarget, summarizeDirection } from './impactGroups';

const impact = (over: Partial<NewsImpact>): NewsImpact => ({
  event_key: 'e1', target_type: 'company', target_id: '2308', target_name: null,
  direction: 'positive', importance: 'medium', basis: 'reported', reason: 'r', evidence: [], ...over,
});

// 同方向：只給一個方向，事件數為不重複 event_key
const same = groupImpactsByTarget([
  impact({ event_key: 'e1', target_name: '台達電' }),
  impact({ event_key: 'e2', importance: 'high' }),
  impact({ event_key: 'e3', importance: 'low' }),
]);
assert.equal(same.length, 1);
assert.equal(same[0].direction, 'positive');
assert.equal(same[0].importance, 'high', 'Importance is the highest of the group');
assert.equal(same[0].eventCount, 3);
assert.equal(same[0].label, '台達電', 'Uses any available target_name');
assert.equal(same[0].impacts.length, 3, 'No impact is dropped');

// 正負對立：正負並存（中性）
const mixed = groupImpactsByTarget([
  impact({ target_id: '6235', direction: 'negative' }),
  impact({ target_id: '6235', direction: 'negative', event_key: 'e2' }),
  impact({ target_id: '6235', direction: 'positive', event_key: 'e3' }),
]);
assert.equal(mixed[0].direction, 'mixed');
assert.equal(mixed[0].label, '6235', 'Company without a name falls back to its code');

// 方向不同但沒有正負對立：方向未明（中性），不硬說成正負並存
assert.equal(summarizeDirection(['positive', 'neutral']), 'uncertain');
assert.equal(summarizeDirection(['negative', 'mixed']), 'mixed');
assert.equal(summarizeDirection(['neutral']), 'neutral');

// 依對象分組、保留第一次出現的順序；同代號不同範圍不混在一起
const many = groupImpactsByTarget([
  impact({ target_id: '2330' }),
  impact({ target_type: 'market', target_id: 'TW', direction: 'uncertain' }),
  impact({ target_id: '2317', direction: 'negative' }),
  impact({ target_id: '2330', event_key: 'e1' }),
]);
assert.deepEqual(many.map((g) => g.key), ['company:2330', 'market:TW', 'company:2317']);
assert.equal(many[0].eventCount, 1, 'Two impacts from the same event count as one event');
assert.equal(many[0].impacts.length, 2);
assert.equal(many[1].label, '大盤', '影響範圍統一叫「大盤／產業／個股」');
assert.equal(many.reduce((n, g) => n + g.impacts.length, 0), 4);
assert.deepEqual(groupImpactsByTarget([]), []);
console.log('News impact grouping (one tag per target, mixed is neutral, nothing dropped) checks passed.');
