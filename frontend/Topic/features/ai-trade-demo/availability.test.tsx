import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiTradeDemo } from './AiTradeDemo';
import { getDemoApiBase } from './config';
import { FOOTER_NAV, PRIMARY_NAV } from '../../lib/nav';

if (process.argv.includes('--fixture')) {
  const configured = Boolean(process.env.NEXT_PUBLIC_AI_TRADE_DEMO_API_URL?.trim());
  const markup = renderToStaticMarkup(<AiTradeDemo />);
  const demo = PRIMARY_NAV.find((item) => item.path === '/ai-trade-demo');
  assert.equal(FOOTER_NAV, PRIMARY_NAV);
  assert.doesNotMatch(markup, /NEXT_PUBLIC_|API 網址/);
  if (configured) {
    assert.equal(getDemoApiBase(), 'http://127.0.0.1:18003');
    assert.equal(demo?.label, 'AI 模擬下單 Demo');
    assert.match(markup, /<form/);
    assert.match(markup, /開始模擬/);
    assert.doesNotMatch(markup, /尚未開放|<fieldset disabled=""/);
  } else {
    assert.equal(getDemoApiBase(), null);
    assert.equal(demo?.label, 'AI Demo（尚未開放）');
    assert.match(markup, /AI模擬下單Demo尚未開放/);
    assert.match(markup, /href="\/"/);
    assert.match(markup, /href="\/ai"/);
    assert.match(markup, /href="\/order"/);
    assert.doesNotMatch(markup, /<form|<input|開始模擬/);
  }
} else {
  for (const value of ['', '   ', '  http://127.0.0.1:18003///  ']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--fixture'], {
      env: { ...process.env, NEXT_PUBLIC_AI_TRADE_DEMO_API_URL: value }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  console.log('Demo availability fixtures passed: empty/whitespace configuration, friendly deep link, shared navigation, and configured form. No requests.');
}
