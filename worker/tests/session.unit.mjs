#!/usr/bin/env node
// session.unit.mjs — SPEC-341 acceptance tests (trusted anonymous session).
//
// Tests the REAL worker module (worker/src/index.ts) by transpiling it to ESM
// and exercising the actual `default.fetch` request handler with a mock Env.
// Nothing here is a re-implemented copy of the logic under test — the session
// sign/verify/expiry/tamper, bootstrap, quota, burst and PoW paths all run the
// compiled source. The only re-implemented pieces are (a) the WebCrypto helpers
// used to FORGE cookies/proofs from a known secret, and (b) a mock WebCrypto/
// KV/DO environment, both of which are test-only scaffolding.
//
// Run: node tests/session.unit.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ---------- scaffolding: transpile the real source ----------
const src = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const tmpDir = mkdtempSync(join(tmpdir(), 'icon-forge-session-'))
const outPath = join(tmpDir, 'index.mjs')
writeFileSync(outPath, js)
const worker = await import(outPath)

// ---------- test helpers (WebCrypto mirrors for forging, not for assertions) ----------
const te = new TextEncoder()
const b64u = (bytes) =>
  Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
const b64uFromB64 = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(message)))
  return Buffer.from(sig).toString('base64')
}

const SESSION_CONTEXT = 'trusted-session-v1'
const SESSION_COOKIE = 'trusted_session'
const SECRET = 'test-turnstile-secret'

async function forgeSessionCookie(secret, sid, exp) {
  const payload = b64u(Buffer.from(JSON.stringify({ sid, exp }), 'utf8'))
  const sig = b64uFromB64(await hmacSign(secret, `${SESSION_CONTEXT}.${payload}`))
  return `${payload}.${sig}`
}

function leadingZeroBits(bytes) {
  let bits = 0
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

// ---------- mock environment ----------
function makeKV(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    async get(k) { return store.has(k) ? store.get(k) : null },
    async put(k, v /*, _opts */) { store.set(k, String(v)) },
    _store: store,
  }
}

function makeEnv(overrides = {}) {
  const kv = makeKV()
  const doCalls = [] // spy: capture Durable Object fetch invocations
  const GENERATION_QUEUE = {
    idFromName: () => ({ toString: () => 'singleton' }),
    get: () => ({
      fetch: async (req) => {
        doCalls.push({ url: req.url, body: await req.text().catch(() => '') })
        return new Response(JSON.stringify({ taskId: 't-1', position: 1 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    }),
  }
  return [{
    RATE_LIMIT: kv,
    LLM_SERVICE_TOKEN: 'tok',
    LLM_GATEWAY_URL: 'https://llm.test',
    ENVIRONMENT: 'test',
    GENERATION_QUEUE,
    TURNSTILE_SECRET: SECRET,
    ...overrides,
  }, doCalls]
}

// Mock `fetch` so Turnstile siteverify resolves without network. Counts calls so
// we can assert a trusted session does not re-verify per generation.
let turnstileCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).includes('siteverify')) {
    turnstileCalls++
    const body = new URLSearchParams(init?.body || '')
    const success = body.get('response') === 'good-token'
    return new Response(JSON.stringify({ success }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return realFetch(url, init)
}

function jsonReq(path, body, headers = {}) {
  return new Request(`https://api-icon.openclawd.co${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://icon.openclawd.co',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// ---------- assertions ----------
let pass = 0, fail = 0
const ok = (n) => { pass++; console.log(`  ok  ${n}`) }
const NG = (n, why = '') => { fail++; console.log(`  FAIL ${n}${why ? ': ' + why : ''}`) }
const chk = (n, cond, why = '') => (cond ? ok(n) : NG(n, why))

console.log('# session.unit.mjs (icon-forge SPEC-341: trusted anonymous session)')
console.log(`# compiled ${js.length} bytes of worker/src/index.ts`)

// Build one shared, freshly-bootstrapped trusted session cookie used across tests.
{
  const [env] = makeEnv()
  const res = await worker.default.fetch(
    jsonReq('/api/session', { turnstileToken: 'good-token' }),
    env,
  )
  chk('bootstrap: turnstile success → 200', res.status === 200, `got ${res.status}`)
  const setCookie = res.headers.get('Set-Cookie') || ''
  chk('bootstrap: Sets HttpOnly cookie', /HttpOnly/.test(setCookie))
  chk('bootstrap: Sets Secure cookie', /Secure/.test(setCookie))
  chk('bootstrap: Sets SameSite=Strict cookie', /SameSite=Strict/.test(setCookie))
  chk('bootstrap: Sets Max-Age', /Max-Age=/.test(setCookie))
  chk('bootstrap: Sets Path=/api', /Path=\/api/.test(setCookie))
  const m = setCookie.match(/trusted_session=([^;]+)/)
  chk('bootstrap: cookie carries a value', !!m, setCookie)
  const cookie = m?.[1] || ''
  const body = await res.json()
  chk('bootstrap: body has ok:true and numeric expiresAt', body.ok === true && Number.isFinite(body.expiresAt))
  const [payload] = cookie.split('.')
  const session = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  chk('bootstrap: payload has sid + exp', !!session.sid && Number.isFinite(session.exp))

  // -------- missing session → denial, must not reach provider --------
  {
    const [env2, doCalls] = makeEnv()
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }),
      env2,
    )
    chk('generate: missing session → 401', r.status === 401, `got ${r.status}`)
    const b = await r.json()
    chk('generate: error is verification_required', b.error === 'verification_required', `${b.error}`)
    chk('generate: missing session never reaches DO/provider', doCalls.length === 0, `doCalls=${doCalls.length}`)
  }

  // -------- trusted generation reuses session, no repeat turnstile --------
  {
    const [env3, doCalls] = makeEnv()
    const before = turnstileCalls
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${cookie}` }),
      env3,
    )
    chk('generate: valid session → 202', r.status === 202, `got ${r.status}`)
    const b = await r.json()
    chk('generate: returns taskId', !!b.taskId, JSON.stringify(b))
    chk('generate: enqueues to DO exactly once', doCalls.length === 1, `doCalls=${doCalls.length}`)
    chk('generate: no repeated Turnstile verify', turnstileCalls === before, `turnstileCalls Δ=${turnstileCalls - before}`)
  }

  // -------- tamper: flipped signature byte fails closed --------
  {
    const [env4, doCalls] = makeEnv()
    const [payload, sig] = cookie.split('.')
    // Flip the FIRST base64url char (the most-significant 6 bits of byte 0).
    // Flipping the LAST char can be a no-op: for a 32-byte HMAC the final char
    // only carries 4 payload bits and 2 dropped padding bits, so e.g. 'A'→'B'
    // decodes to identical bytes. First-char flip always changes byte 0.
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${payload}.${flipped}` }),
      env4,
    )
    chk('generate: tampered signature → 401', r.status === 401, `got ${r.status}`)
    chk('generate: tampered signature never reaches DO', doCalls.length === 0, `doCalls=${doCalls.length}`)
  }

  // -------- tamper: altered payload fails closed (signature mismatch) --------
  {
    const [env5, doCalls] = makeEnv()
    const [payload, sig] = cookie.split('.')
    const alteredPayload = (payload.endsWith('A') ? payload.slice(0, -1) + 'B' : payload.slice(0, -1) + 'A')
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${alteredPayload}.${sig}` }),
      env5,
    )
    chk('generate: altered payload → 401', r.status === 401, `got ${r.status}`)
    chk('generate: altered payload never reaches DO', doCalls.length === 0, `doCalls=${doCalls.length}`)
  }

  // -------- tamper: extra segment fails closed --------
  {
    const [env6, doCalls] = makeEnv()
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${cookie}.extra` }),
      env6,
    )
    chk('generate: extra dot-segment → 401', r.status === 401, `got ${r.status}`)
    chk('generate: extra segment never reaches DO', doCalls.length === 0, `doCalls=${doCalls.length}`)
  }

  // -------- expiry: correctly-signed but expired cookie fails closed --------
  {
    const [env7, doCalls] = makeEnv()
    const expired = await forgeSessionCookie(SECRET, 'expired-sid', Date.now() - 1000)
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${expired}` }),
      env7,
    )
    chk('generate: expired (valid sig) → 401', r.status === 401, `got ${r.status}`)
    chk('generate: expired never reaches DO', doCalls.length === 0, `doCalls=${doCalls.length}`)
  }

  // -------- round-trip: independently-signed future cookie is accepted --------
  // This proves the worker's sign() and verify() agree with an independent HMAC
  // implementation (catches any drift in context string, base64url, or key import).
  {
    const [env8, doCalls] = makeEnv()
    const future = await forgeSessionCookie(SECRET, 'independent-sid', Date.now() + 60_000)
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${future}` }),
      env8,
    )
    chk('generate: independently-signed future cookie → 202', r.status === 202, `got ${r.status}`)
    chk('generate: independent cookie reaches DO', doCalls.length === 1, `doCalls=${doCalls.length}`)
  }

  // -------- bootstrap failures --------
  {
    const [envBad] = makeEnv()
    const r = await worker.default.fetch(
      jsonReq('/api/session', { turnstileToken: 'bad-token' }),
      envBad,
    )
    chk('bootstrap: bad turnstile token → 403', r.status === 403, `got ${r.status}`)
    const b = await r.json()
    chk('bootstrap: error is verification_failed', b.error === 'verification_failed', `${b.error}`)
  }
  {
    const [envNoSec] = makeEnv({ TURNSTILE_SECRET: undefined })
    const r = await worker.default.fetch(
      jsonReq('/api/session', { turnstileToken: 'good-token' }),
      envNoSec,
    )
    chk('bootstrap: no TURNSTILE_SECRET → fail closed (403)', r.status === 403, `got ${r.status}`)
  }
  {
    const [envBadBody] = makeEnv()
    const r = await worker.default.fetch(
      new Request('https://api-icon.openclawd.co/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://icon.openclawd.co' },
        body: 'not-json{{{',
      }),
      envBadBody,
    )
    chk('bootstrap: malformed body → 400 invalid_input', r.status === 400, `got ${r.status}`)
  }

  // -------- CORS: credentialed explicit origin, never * --------
  {
    const [envCors] = makeEnv()
    const r = await worker.default.fetch(
      jsonReq('/api/session', { turnstileToken: 'good-token' }),
      envCors,
    )
    const acao = r.headers.get('Access-Control-Allow-Origin') || ''
    chk('CORS: ACAO is explicit origin (never *)', acao === 'https://icon.openclawd.co' && acao !== '*', `acao=${acao}`)
    chk('CORS: Allow-Credentials true', (r.headers.get('Access-Control-Allow-Credentials') || '') === 'true')
  }
  {
    const [envForbid] = makeEnv()
    const r = await worker.default.fetch(
      new Request('https://api-icon.openclawd.co/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ turnstileToken: 'good-token' }),
      }),
      envForbid,
    )
    chk('CORS: disallowed origin → 403 forbidden', r.status === 403, `got ${r.status}`)
  }

  // -------- IP daily quota --------
  {
    const ip = '203.0.113.9'
    const [envQ] = makeEnv()
    const dayKey = `limit:${ip}:${new Date().toISOString().slice(0, 10)}`
    envQ.RATE_LIMIT._store.set(dayKey, '3')
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { 'CF-Connecting-IP': ip, Cookie: `${SESSION_COOKIE}=${cookie}` }),
      envQ,
    )
    chk('quota: exhausted IP → 429 rate_limited', r.status === 429, `got ${r.status}`)
    const b = await r.json()
    chk('quota: IP error is rate_limited', b.error === 'rate_limited', `${b.error}`)
  }

  // -------- session-scoped daily quota --------
  {
    const [envQ2] = makeEnv()
    const dayKey = `session-limit:${session.sid}:${new Date().toISOString().slice(0, 10)}`
    envQ2.RATE_LIMIT._store.set(dayKey, '3')
    const r = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'a weather app' }, { Cookie: `${SESSION_COOKIE}=${cookie}` }),
      envQ2,
    )
    chk('quota: exhausted session → 429 rate_limited', r.status === 429, `got ${r.status}`)
    const b = await r.json()
    chk('quota: session error is rate_limited', b.error === 'rate_limited', `${b.error}`)
  }

  // -------- burst limit (3/min) --------
  // Freeze Date.now so the 60s burst window can't flip mid-test (would be a
  // flaky boundary: 4 calls land in a fresh window and the 4th is wrongly 202).
  {
    const ip = '203.0.113.10'
    const [envB] = makeEnv()
    const hdr = { 'CF-Connecting-IP': ip, Cookie: `${SESSION_COOKIE}=${cookie}` }
    const realDateNow = Date.now
    const frozen = realDateNow()
    Date.now = () => frozen
    let statuses = []
    try {
      for (let i = 0; i < 4; i++) {
        const r = await worker.default.fetch(
          jsonReq('/api/generate', { description: 'burst' }, hdr),
          envB,
        )
        statuses.push(r.status)
      }
    } finally {
      Date.now = realDateNow
    }
    chk('burst: first three → 202', statuses.slice(0, 3).every((s) => s === 202), `[${statuses.slice(0, 3)}]`)
    chk('burst: fourth → 429 rate_limited_burst', statuses[3] === 429, `got ${statuses[3]}`)
    const r4 = await worker.default.fetch(
      jsonReq('/api/generate', { description: 'burst' }, hdr),
      envB,
    )
    const b = await r4.json()
    chk('burst: error is rate_limited_burst', b.error === 'rate_limited_burst', `${b.error}`)
  }

  // -------- PoW: challenge → solve → bootstrap success, replay denied --------
  {
    const ip = '203.0.113.11'
    const [envP] = makeEnv()
    const chRes = await worker.default.fetch(
      jsonReq('/api/pow-challenge', {}, { 'CF-Connecting-IP': ip }),
      envP,
    )
    chk('pow: challenge endpoint → 200', chRes.status === 200, `got ${chRes.status}`)
    const { challenge, difficulty } = await chRes.json()
    chk('pow: difficulty is 16', difficulty === 16, `difficulty=${difficulty}`)

    let counter = -1
    for (let base = 0; base <= 4_194_304 && counter < 0; base += 256) {
      const digests = await Promise.all(Array.from({ length: 256 }, (_, i) =>
        crypto.subtle.digest('SHA-256', te.encode(`${challenge}:${base + i}`)),
      ))
      const idx = digests.findIndex((d) => leadingZeroBits(new Uint8Array(d)) >= difficulty)
      if (idx >= 0) counter = base + idx
    }
    chk('pow: solvable within budget', counter >= 0, `counter=${counter}`)

    if (counter >= 0) {
      const boot = await worker.default.fetch(
        jsonReq('/api/session', { powChallenge: challenge, powCounter: counter }, { 'CF-Connecting-IP': ip }),
        envP,
      )
      chk('pow: bootstrap via solved proof → 200', boot.status === 200, `got ${boot.status}`)

      const replay = await worker.default.fetch(
        jsonReq('/api/session', { powChallenge: challenge, powCounter: counter }, { 'CF-Connecting-IP': ip }),
        envP,
      )
      chk('pow: replay of used nonce → fail closed (403)', replay.status === 403, `got ${replay.status}`)
    }
  }
}

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)