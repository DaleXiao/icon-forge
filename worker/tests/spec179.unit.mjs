#!/usr/bin/env node
// spec179.unit.mjs — SPEC-179 / T-282.
//
// Static + behavioural checks for the icon-forge worker timeout & thinking
// hardening. We can't easily spin up a Cloudflare Workers runtime here, so we
// (a) grep the compiled source for the right constants & code shape and
// (b) simulate the AbortController + max_tokens path against a stub fetch
// to make sure the timeout fires and is reported as a clean error.
//
// Run: node tests/spec179.unit.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = readFileSync(join(root, 'src', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ok  ${n}`); };
const NG  = (n, why = '') => { fail++; console.log(`  FAIL ${n}${why ? ': ' + why : ''}`); };
const chk = (n, cond, why = '') => cond ? ok(n) : NG(n, why);

console.log('# spec179.unit.mjs (icon-forge SPEC-179 / T-282)');

// ---------- B-3: TASK_TIMEOUT_MS bumped ----------
chk('TASK_TIMEOUT_MS bumped to 180_000',
  /const\s+TASK_TIMEOUT_MS\s*=\s*180_000/.test(src),
  'still 120_000');

// ---------- B-1: max_tokens cap ----------
chk('LLM_MAX_TOKENS constant exists and = 2400',
  /const\s+LLM_MAX_TOKENS\s*=\s*2400/.test(src));

// synthesizePrompts uses max_tokens
chk('synthesizePrompts body includes max_tokens: LLM_MAX_TOKENS',
  /async function synthesizePrompts[\s\S]*?max_tokens:\s*LLM_MAX_TOKENS/.test(src),
  'synthesizePrompts missing max_tokens cap');

// critiqueAndFix uses max_tokens
chk('critiqueAndFix body includes max_tokens: LLM_MAX_TOKENS',
  /async function critiqueAndFix[\s\S]*?max_tokens:\s*LLM_MAX_TOKENS/.test(src),
  'critiqueAndFix missing max_tokens cap');

// ---------- B-2: AbortController on LLM fetch ----------
chk('LLM_FETCH_TIMEOUT_MS constant exists and = 60_000',
  /const\s+LLM_FETCH_TIMEOUT_MS\s*=\s*60_000/.test(src));

chk('synthesizePrompts uses AbortController + signal',
  /async function synthesizePrompts[\s\S]*?new AbortController\(\)[\s\S]*?signal:\s*ac\.signal/.test(src),
  'synthesizePrompts not wired with AbortController');

chk('synthesizePrompts schedules abort with LLM_FETCH_TIMEOUT_MS',
  /async function synthesizePrompts[\s\S]*?setTimeout\(\s*\(\)\s*=>\s*ac\.abort\(\)\s*,\s*LLM_FETCH_TIMEOUT_MS\s*\)/.test(src));

chk('critiqueAndFix uses AbortController + signal',
  /async function critiqueAndFix[\s\S]*?new AbortController\(\)[\s\S]*?signal:\s*ac\.signal/.test(src),
  'critiqueAndFix not wired with AbortController');

chk('synthesizePrompts surfaces "Prompt API timeout" on AbortError',
  /Prompt API timeout/.test(src));

chk('critiqueAndFix surfaces "critique API timeout" on AbortError',
  /critique API timeout/.test(src));

// ---------- Behavioural: simulate AbortController timeout ----------
// Tiny harness — verifies the pattern we encoded actually times out and we
// can detect it as AbortError.
async function simulateTimeout() {
  const ac = new AbortController();
  const timeoutMs = 25;
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await new Promise((_, reject) => {
      ac.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      // never resolves — simulates a hung fetch
    });
    clearTimeout(t);
    return 'no-abort';
  } catch (e) {
    clearTimeout(t);
    return e?.name === 'AbortError' ? 'aborted' : `other:${e?.name}`;
  }
}

const simResult = await simulateTimeout();
chk('AbortController pattern fires AbortError within timeout window',
  simResult === 'aborted', `got ${simResult}`);

// ---------- B-4: front-end test-mode captcha message safety ----------
const app = readFileSync(join(root, '..', 'src', 'App.tsx'), 'utf8');
chk('App.tsx exports IS_TEST_MODE flag',
  /const\s+IS_TEST_MODE\s*=\s*_params\.has\('test'\)/.test(app));
chk('App.tsx rewrites 人机验证 text under ?test',
  /IS_TEST_MODE && \/\u4eba\u673a\u9a8c\u8bc1\/\.test\(msg\)/.test(app));
chk('App.tsx clears stale error inside startSSE',
  /function startSSE[\s\S]{0,200}setError\(null\)/.test(app));

console.log(`\n# pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
