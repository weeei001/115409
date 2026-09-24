import assert from 'node:assert/strict';
import { forwardViewLabel } from './textBriefLabels';

const view = { stance: 'uncertain', reason: '', invalidation: '' };
assert.equal(forwardViewLabel(view), '資料不足');
assert.equal(forwardViewLabel({ ...view, validation_status: null }), '資料不足');
assert.equal(forwardViewLabel({ ...view, validation_status: 'rejected' }), '內容未通過檢查');
assert.equal(forwardViewLabel({ ...view, stance: 'mixed' }), '多空交雜');
assert.equal(forwardViewLabel({ ...view, stance: 'unknown' }), 'unknown');
