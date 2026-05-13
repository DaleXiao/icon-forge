#!/usr/bin/env node
// spec-179.unit.mjs — SPEC-179 / T-282.
//
// Static-grep coverage for the four icon-forge worker / front-end fixes:
//   B-1  synthesizePrompts + critiqueAndFix request body declares
//        max_tokens: LLM_CHAT_MAX_TOKENS (cap reasoning explosion).
//   B-2  Both chat fetches use an AbortController + LLM_CHAT_TIMEOUT_MS.
//   B-3  TASK_TIMEOUT_MS bumped 120_000 → 180_000.
//   B-4  src/App.tsx has an explicit res.status === 403 branch that
//        rewrites the message in `?test` mode.
//
// Plus a regression guard: no enable_thinking:true chat call remains
// without a max_tokens cap.
//
// Run: node tests/spec-179.unit.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..');
const workerSrc = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
const appSrc = readFileSync(join(repoRoot, 'src', 'App.tsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const NG = (n, why = '') => { fail++; console.log(`  FAIL ${n}${why ? ': ' + why : ''}`); };
const chk = (n, cond, why = '') => cond ? ok(n) : NG(n, why);

console.log('# spec-179.unit.mjs (SPEC-179 / T-282)');

// ─── B-1: max_tokens caps ────────────────────────────────────────────
console.log('\n## B-1: max_tokens caps');
chk(
  'worker declares LLM_CHAT_MAX_TOKENS constant',
  /const\s+LLM_CHAT_MAX_TOKENS\s*=\s*2400/.test(workerSrc),
);
// synthesizePrompts requestBody has max_tokens
const synthBlock = workerSrc.match(
  /function\s+synthesizePrompts[\s\S]*?const\s+requestBody:[\s\S]*?\};/,
);
chk('found synthesizePrompts requestBody block', synthBlock !== null);
chk(
  'synthesizePrompts requestBody sets max_tokens: LLM_CHAT_MAX_TOKENS',
  synthBlock !== null && /max_tokens:\s*LLM_CHAT_MAX_TOKENS/.test(synthBlock[0]),
);
// critiqueAndFix requestBody has max_tokens
const critiqueBlock = workerSrc.match(
  /function\s+critiqueAndFix[\s\S]*?const\s+requestBody:[\s\S]*?\};/,
);
chk('found critiqueAndFix requestBody block', critiqueBlock !== null);
chk(
  'critiqueAndFix requestBody sets max_tokens: LLM_CHAT_MAX_TOKENS',
  critiqueBlock !== null && /max_tokens:\s*LLM_CHAT_MAX_TOKENS/.test(critiqueBlock[0]),
);

// Regression guard: no `enable_thinking: true` chat body without max_tokens.
// We approximate by walking every chat requestBody literal.
const enableThinkingHits = (workerSrc.match(/enable_thinking:\s*true/g) || []).length;
const enableThinkingWithCap = (
  workerSrc.match(/enable_thinking:\s*true[\s\S]{0,400}?max_tokens:\s*LLM_CHAT_MAX_TOKENS/g) || []
).length;
chk(
  `every enable_thinking:true also has max_tokens cap (${enableThinkingWithCap}/${enableThinkingHits})`,
  enableThinkingHits > 0 && enableThinkingHits === enableThinkingWithCap,
);

// ─── B-2: AbortController on chat fetches ────────────────────────────
console.log('\n## B-2: AbortController on chat fetches');
chk(
  'worker declares LLM_CHAT_TIMEOUT_MS = 60_000',
  /const\s+LLM_CHAT_TIMEOUT_MS\s*=\s*60_000/.test(workerSrc),
);
chk(
  'synthesizePrompts wraps chat fetch with AbortController',
  /function\s+synthesizePrompts[\s\S]*?new\s+AbortController\(\)[\s\S]*?signal:\s*ac\.signal[\s\S]*?CHAT_PATH/.test(workerSrc)
    || /function\s+synthesizePrompts[\s\S]*?new\s+AbortController\(\)[\s\S]*?CHAT_PATH[\s\S]*?signal:\s*ac\.signal/.test(workerSrc),
);
chk(
  'synthesizePrompts schedules ac.abort() with LLM_CHAT_TIMEOUT_MS',
  /function\s+synthesizePrompts[\s\S]*?setTimeout\(\s*\(\)\s*=>\s*ac\.abort\(\)\s*,\s*LLM_CHAT_TIMEOUT_MS\s*\)/.test(workerSrc),
);
chk(
  'critiqueAndFix wraps chat fetch with AbortController',
  /function\s+critiqueAndFix[\s\S]*?new\s+AbortController\(\)[\s\S]*?signal:\s*ac\.signal/.test(workerSrc),
);
chk(
  'critiqueAndFix schedules ac.abort() with LLM_CHAT_TIMEOUT_MS',
  /function\s+critiqueAndFix[\s\S]*?setTimeout\(\s*\(\)\s*=>\s*ac\.abort\(\)\s*,\s*LLM_CHAT_TIMEOUT_MS\s*\)/.test(workerSrc),
);
chk(
  'synthesizePrompts treats AbortError as retryable / surfaces timeout',
  /AbortError[\s\S]{0,400}?continue/.test(workerSrc)
    && /Prompt API timeout after \$\{LLM_CHAT_TIMEOUT_MS\}ms/.test(workerSrc),
);
chk(
  'critiqueAndFix surfaces AbortError as critique API timeout',
  /critique API timeout after \$\{LLM_CHAT_TIMEOUT_MS\}ms/.test(workerSrc),
);

// ─── B-3: TASK_TIMEOUT_MS bump ───────────────────────────────────────
console.log('\n## B-3: TASK_TIMEOUT_MS bump');
chk(
  'TASK_TIMEOUT_MS = 180_000',
  /const\s+TASK_TIMEOUT_MS\s*=\s*180_000/.test(workerSrc),
);
chk(
  'old 120_000 envelope is gone (regression guard)',
  !/const\s+TASK_TIMEOUT_MS\s*=\s*120_000/.test(workerSrc),
);

// ─── B-4: front-end 403 branch ───────────────────────────────────────
console.log('\n## B-4: front-end 403 branch');
chk(
  'App.tsx has explicit res.status === 403 handler',
  /if\s*\(\s*res\.status\s*===\s*403\s*\)/.test(appSrc),
);
chk(
  'App.tsx 403 handler rewrites message in TEST_PARAM mode',
  /res\.status\s*===\s*403[\s\S]{0,500}?TEST_PARAM\s*\?[\s\S]{0,200}?'\u6d4b\u8bd5\u6a21\u5f0f/.test(appSrc),
);
chk(
  'App.tsx 403 handler still falls back to data.message when not in test',
  /res\.status\s*===\s*403[\s\S]{0,500}?data\.message/.test(appSrc),
);
chk(
  '403 branch sits BEFORE the generic !res.ok fallback',
  appSrc.indexOf('res.status === 403') < appSrc.indexOf('if (!res.ok)'),
);

// ─── summary ─────────────────────────────────────────────────────────
console.log(`\n# spec-179.unit.mjs: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
