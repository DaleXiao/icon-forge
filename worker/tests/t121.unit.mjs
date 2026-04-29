#!/usr/bin/env node
// t121.unit.mjs — T-121 / icon-forge issue #10.
//
// Three changes verified statically:
//   (A) removeBackground uses native multimodal-generation endpoint
//       with Dashscope native body schema (input.messages[].content
//       items as {image} / {text}, NOT {type:"image_url",...}).
//   (B) PROMPT_MODEL = qwen3.6-max-preview (was qwen3.6-plus).
//       Critique reuses the same model.
//   (C) critiqueAndFix function exists, is wired into synthesizePrompts
//       with .catch(() => parsed) silent fallback, takes (description,
//       parsed, apiKey), returns PromptResponse, and parses verdict
//       JSON tolerantly.
//
// Plus behavioural simulation of the verdict-parsing fallback paths
// since those are the riskiest piece of new logic.
//
// Run: node tests/t121.unit.mjs

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

console.log('# t121.unit.mjs (icon-forge T-121 / issue #10)');

// ---------- (A) removeBackground native endpoint ----------
chk('removeBackground POSTs to DASHSCOPE_SUBMIT_URL (native)',
  /async function removeBackground[\s\S]*?fetch\(DASHSCOPE_SUBMIT_URL/.test(src));
chk('removeBackground does NOT POST to COMPAT_API_URL',
  !/async function removeBackground[\s\S]*?fetch\(COMPAT_API_URL/.test(src));
chk('removeBackground body uses input.messages (native schema)',
  /async function removeBackground[\s\S]*?input:\s*\{\s*messages:\s*\[/.test(src));
chk('removeBackground body items use {image: imageUrl} (native, not image_url)',
  /async function removeBackground[\s\S]*?\{\s*image:\s*imageUrl\s*\}/.test(src));
chk('removeBackground body items use {text: ...} (native, not type:"text")',
  /async function removeBackground[\s\S]*?\{\s*text:\s*"Cut out the rounded square icon/.test(src));
chk('removeBackground does NOT use type:"image_url" (compat schema)',
  !/async function removeBackground[\s\S]*?type:\s*"image_url"/.test(src));
chk('removeBackground reads data.output.choices[0].message.content (native)',
  /async function removeBackground[\s\S]*?data\.output\?\.choices\?\.\[0\]\?\.message\?\.content/.test(src));
chk('removeBackground does NOT read data.choices[0] (compat path gone)',
  !/async function removeBackground[\s\S]*?data\.choices\?\.\[0\]\?\.message/.test(src));
chk('removeBackground keeps 3-attempt retry loop (silent fallback to original)',
  /async function removeBackground[\s\S]*?attempt\s*<\s*3/.test(src));
chk('COMPAT_API_URL constant is removed',
  !/^const COMPAT_API_URL\s*=/m.test(src));

// ---------- (B) PROMPT_MODEL upgraded ----------
chk('PROMPT_MODEL = qwen3.6-max-preview',
  /const PROMPT_MODEL\s*=\s*"qwen3\.6-max-preview"/.test(src));
chk('PROMPT_MODEL is no longer qwen3.6-plus',
  !/const PROMPT_MODEL\s*=\s*"qwen3\.6-plus"/.test(src));
chk('CRITIQUE_MODEL exported (max-preview, reuses same model)',
  /const CRITIQUE_MODEL\s*=\s*"qwen3\.6-max-preview"/.test(src));
chk('synthesizePrompts request body still passes enable_thinking: true',
  /async function synthesizePrompts[\s\S]*?enable_thinking:\s*true/.test(src));
chk('critiqueAndFix request body passes enable_thinking: true',
  /async function critiqueAndFix[\s\S]*?enable_thinking:\s*true/.test(src));

// ---------- (C) critique reflection wired ----------
chk('SYSTEM_PROMPT_CRITIQUE constant defined',
  /const SYSTEM_PROMPT_CRITIQUE\s*=\s*`/.test(src));
chk('SYSTEM_PROMPT_CRITIQUE lists drift types D1/D2/D3/D4',
  /D1 SUBJECT_REPLACEMENT/.test(src)
    && /D2 KEYWORD_OMISSION/.test(src)
    && /D3 STYLE_OPPOSITE/.test(src)
    && /D4 OFF_TOPIC/.test(src));
chk('SYSTEM_PROMPT_CRITIQUE prefers verdict:"ok" when unsure (conservative)',
  /Be conservative\.\s*If you are unsure, prefer \{"verdict":"ok"\}/.test(src));
chk('critiqueAndFix function defined',
  /async function critiqueAndFix\s*\(\s*description:\s*string,\s*parsed:\s*PromptResponse,\s*apiKey:\s*string,?\s*\)\s*:\s*Promise<PromptResponse>/.test(src));
chk('critique called from synthesizePrompts with silent .catch(() => parsed) fallback',
  /critiqueAndFix\(description,\s*parsed,\s*apiKey\)[\s\S]{0,80}\.catch\(\s*\n?\s*\(\)\s*=>\s*parsed/.test(src));
chk('critique runs BEFORE assemblePrompt (so fixed structured fields propagate)',
  /const reviewed = await critiqueAndFix\([^)]*\)[\s\S]{0,100}return \[assemblePrompt\(reviewed\.variant_a\),\s*assemblePrompt\(reviewed\.variant_b\)\]/.test(src));
chk('critique tolerates extra prose (regex-extracts first {...} block)',
  /cleaned\.match\(\/\\\{\[\\s\\S\]\*\\\}\//.test(src));
chk('critique returns parsed unchanged when verdict !== "fix"',
  /verdict\.verdict\s*!==\s*"fix"[\s\S]{0,50}return parsed/.test(src));
chk('critique validates fixed.variant_a/b shape; falls back to parsed on missing fields',
  /async function critiqueAndFix[\s\S]*?for \(const key of \["variant_a", "variant_b"\] as const\)[\s\S]*?return parsed/.test(src));

// ---------- (D) main SYSTEM_PROMPT (positives) NOT touched ----------
chk('main SYSTEM_PROMPT still defines CORE PRINCIPLE',
  /const SYSTEM_PROMPT\s*=[\s\S]*?CORE PRINCIPLE[\s\S]*?The squircle itself IS/.test(src));
chk('STYLE_MAP keys all present',
  /STYLE_MAP[\s\S]*?toylike[\s\S]*?refined[\s\S]*?modern[\s\S]*?minimal[\s\S]*?playful/.test(src));

// ---------- (E) behavioural simulation: critique verdict parser ----------
// Re-implement the verdict parser tightly so any drift in intent shows
// up here as a different output. The real one is async; we extract just
// the pure parsing+fallback logic.

const validStyleWords = ['toylike', 'refined', 'modern', 'minimal', 'playful'];
const sampleParsed = {
  variant_a: { subject: 'A', visualDetails: 'a', contrastColors: 'a', moodWord: 'm', styleWord: 'toylike' },
  variant_b: { subject: 'B', visualDetails: 'b', contrastColors: 'b', moodWord: 'm', styleWord: 'refined' },
};

function parseVerdict(content, parsed) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON');
  const verdict = JSON.parse(m[0]);
  if (verdict.verdict !== 'fix' || !verdict.fixed) return parsed;
  for (const key of ['variant_a', 'variant_b']) {
    const v = verdict.fixed[key];
    if (!v?.subject || !v?.visualDetails || !v?.contrastColors || !v?.moodWord || !v?.styleWord) {
      return parsed;
    }
    if (!validStyleWords.includes(v.styleWord)) v.styleWord = 'toylike';
  }
  return verdict.fixed;
}

// ok verdict → unchanged
let r = parseVerdict('{"verdict":"ok"}', sampleParsed);
chk('sim: verdict=ok returns parsed unchanged',
  r === sampleParsed);

// fix verdict with valid fixed → fixed used
const fixed = {
  variant_a: { subject: 'A2', visualDetails: 'a2', contrastColors: 'a2', moodWord: 'm', styleWord: 'modern' },
  variant_b: { subject: 'B2', visualDetails: 'b2', contrastColors: 'b2', moodWord: 'm', styleWord: 'minimal' },
};
r = parseVerdict(JSON.stringify({ verdict: 'fix', fixed }), sampleParsed);
chk('sim: verdict=fix with valid fixed returns fixed.variant_a/b',
  r.variant_a.subject === 'A2' && r.variant_b.subject === 'B2');

// fix verdict with invalid styleWord → coerced to toylike
const fixedBadStyle = {
  variant_a: { subject: 'A3', visualDetails: 'a', contrastColors: 'a', moodWord: 'm', styleWord: 'BOGUS' },
  variant_b: { subject: 'B3', visualDetails: 'b', contrastColors: 'b', moodWord: 'm', styleWord: 'refined' },
};
r = parseVerdict(JSON.stringify({ verdict: 'fix', fixed: fixedBadStyle }), sampleParsed);
chk('sim: fix with invalid styleWord coerces to toylike (still uses fixed)',
  r.variant_a.subject === 'A3' && r.variant_a.styleWord === 'toylike');

// fix verdict missing field in variant_a → fallback to parsed
const fixedMissing = {
  variant_a: { subject: 'A4', visualDetails: 'a' /* missing contrastColors */, moodWord: 'm', styleWord: 'modern' },
  variant_b: fixed.variant_b,
};
r = parseVerdict(JSON.stringify({ verdict: 'fix', fixed: fixedMissing }), sampleParsed);
chk('sim: fix with missing variant_a field falls back to parsed',
  r === sampleParsed);

// markdown-fenced JSON
r = parseVerdict('```json\n{"verdict":"ok"}\n```', sampleParsed);
chk('sim: ```json fence stripped',
  r === sampleParsed);

// prose around JSON (model misbehaving)
r = parseVerdict('After thinking carefully, my answer is:\n{"verdict":"ok"}\nThanks!', sampleParsed);
chk('sim: prose-wrapped JSON: extracts the {...} block',
  r === sampleParsed);

// no JSON at all → throws (caller .catch falls back to parsed)
let threw = false;
try { parseVerdict('Sorry I cannot help.', sampleParsed); } catch { threw = true; }
chk('sim: no JSON throws (so caller .catch() falls back to parsed)', threw);

// missing fixed when verdict=fix → return parsed
r = parseVerdict('{"verdict":"fix"}', sampleParsed);
chk('sim: verdict=fix without fixed returns parsed unchanged',
  r === sampleParsed);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
