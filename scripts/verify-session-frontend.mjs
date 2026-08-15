#!/usr/bin/env node
// verify-session-frontend.mjs — SPEC-341 frontend acceptance (static source check).
//
// The frontend (src/App.tsx) has no React test harness in this repo, so these
// assertions hold the session-related UI behaviour to account at the source
// level: interactive challenge only when required, a single retry after
// establishing a trusted session, and the preserved SSE polling flow.
//
// Run: node scripts/verify-session-frontend.mjs

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')

let pass = 0, fail = 0
const ok = (n) => { pass++; console.log(`  ok  ${n}`) }
const NG = (n, why = '') => { fail++; console.log(`  FAIL ${n}${why ? ': ' + why : ''}`) }
const chk = (n, cond, why = '') => (cond ? ok(n) : NG(n, why))

console.log('# verify-session-frontend.mjs (icon-forge SPEC-341: frontend session behaviour)')

// ---------- 1. Managed Turnstile (interactive only when required) ----------
chk('turnstile: renders with appearance=interaction-only', /appearance:\s*'interaction-only'/.test(src))
chk('turnstile: size=normal (real clickable host, not invisible)', /size:\s*'normal'/.test(src))
chk('turnstile: no invisible (0x0) widget remains', !/size:\s*'invisible'/.test(src))
chk('turnstile: widget host is visible & positioned (300px, not 0x0)', /width:300px/.test(src) && !/width:0/.test(src))

// ---------- 2. lazy session establishment: turnstile-first, PoW fallback ----------
chk('session: establishTrustedSession tries Turnstile first', /const turnstileToken = await getTurnstileToken\(\)/.test(src))
chk('session: falls back to first-party PoW on Turnstile failure', /catch[\s\S]{0,300}solvePow\(\)/.test(src))
chk('session: posts with credentials=include (HttpOnly cookie)', /credentials:\s*'include'/.test(src))

// ---------- 3. single retry after verification_required (no loop) ----------
chk('retry: handles 401 verification_required branch', /res\.status === 401[\s\S]{0,200}verification_required/.test(src))
chk('retry: establishes session then retries once', /await establishTrustedSession\(\)[\s\S]{0,80}sendGenerate\(\)/.test(src))
chk('retry: marks the single retry explicitly', /\/\/ one retry only/.test(src))
// The 401→retry block must not contain a while/for loop (bounded retry).
{
  const m = src.match(/if \(res\.status === 401[\s\S]*?\n      \}/)
  const block = m?.[0] || ''
  chk('retry: no unbounded loop in the 401 branch', !/while\s*\(|for\s*\(/.test(block))
}

// ---------- 4. SSE polling flow preserved ----------
chk('sse: uses EventSource on /generate/stream?taskId', /\/generate\/stream\?taskId=/.test(src) && /new EventSource\(/.test(src))
chk('sse: listens for queued', /es\.addEventListener\('queued'/.test(src))
chk('sse: listens for generating', /es\.addEventListener\('generating'/.test(src))
chk('sse: listens for icon_ready', /es\.addEventListener\('icon_ready'/.test(src))
chk('sse: listens for complete', /es\.addEventListener\('complete'/.test(src))
chk('sse: listens for error', /es\.addEventListener\('error'/.test(src))
chk('sse: closes stream and clears ref on complete', /es\.close\(\)[\s\S]{0,80}eventSourceRef\.current = null/.test(src))

// ---------- 5. offline reconnect (visibilitychange reopen) ----------
chk('sse: reconnects on visibilitychange (mobile lock/unlock)', /addEventListener\('visibilitychange'/.test(src))

// ---------- 6. distinct machine-readable error handling ----------
// The worker returns distinct codes; the UI must map them without swallowing
// 401 as a generic failure. 401 is handled by the dedicated verification branch.
chk('ui: 429 sets rate-limited state + message', /res\.status === 429[\s\S]{0,120}setRateLimited\(true\)/.test(src))
chk('ui: 503 triggers retry countdown', /res\.status === 503[\s\S]{0,200}startRetryCountdown\(/.test(src))

// ---------- 7. no fingerprinting / account / login introduced ----------
chk('privacy: no fingerprinting hook', !/fingerprint|crypto\.getRandomValues\(\)/.test(src))
chk('privacy: no account/login system', !/\b(login|signup|sign-in|password)\b/i.test(src))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)