export interface Env {
  RATE_LIMIT: KVNamespace;
  DASHSCOPE_API_KEY: string;
  ENVIRONMENT: string;
}

// --- Types ---

interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface KimiChatRequest {
  model: string;
  messages: KimiMessage[];
  response_format?: { type: string };
}

interface KimiChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

type StyleWord = 'toylike' | 'refined' | 'modern' | 'minimal' | 'playful';

interface PromptVariant {
  subject: string;
  visualDetails: string;
  contrastColors: string;
  moodWord: string;
  styleWord: StyleWord;
}

interface PromptResponse {
  variant_a: PromptVariant;
  variant_b: PromptVariant;
}

interface GenerateSuccessResponse {
  icons: Array<{ url: string; index: number }>;
  remaining: number;
}

interface ErrorResponse {
  error: string;
  message: string;
}

// --- Constants ---

const DAILY_LIMIT = 3;
const KIMI_MODEL = "kimi-k2.5";
const DASHSCOPE_MODEL = "qwen-image-2.0-pro";
const DASHSCOPE_SUBMIT_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const KIMI_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const STYLE_MAP: Record<StyleWord, string> = {
  toylike: 'Charming toylike quality, crisp clean edges. Vivid saturated colors. Simplified and cheerful.',
  refined: 'Clean refined quality, crisp precise edges. Warm muted tones. Simplified and professional.',
  modern: 'Refined modern with clean 3D volumes and layered depth. Bold saturated colors. Smooth pristine surfaces.',
  minimal: 'Clean and minimal. Subtle material hints. Warm muted cream tones. Simplified and professional.',
  playful: 'Charming toylike quality, crisp clean edges. Vivid saturated colors. Fun and delightful.',
};

const KIMI_SYSTEM_PROMPT = `You are an elite macOS/iOS app icon designer. Given a short app description (any language), you produce TWO genuinely different visual concepts as structured JSON.

━━━ CORE PRINCIPLE ━━━
"The squircle itself IS ___." — The entire icon shape BECOMES the physical object. NOT "a squircle with X drawn on it". The squircle IS a vintage radio, IS a leather journal, IS a terracotta pot.

━━━ DESIGN RULES ━━━
1. SQUIRCLE = OBJECT — The icon shape transforms into the front face of a real-world object or metaphorical container. Think "what physical thing could represent this app?"
2. MATERIALS ARE SPECIFIC — Never say "colored surface". Always: "vivid red (#E53935) smooth surface with subtle leather-grain hint" or "warm maple wood (#D4A574) with visible grain lines". Every surface = hex color + material texture.
3. ELEMENT COUNT: 2-3 MAX — One dominant subject + 1-2 small accent details. More than 3 elements = muddy at small sizes. The best icons are ruthlessly simple.
4. VIEWPOINT IS EXPLICIT — Always state: "viewed from the front", "viewed from above", "at a slight top-down angle", "viewed straight on".
5. COLOR CONTRAST IS KEY — Always describe which colors pop against which: "vivid orange coins (#FF9800) against deep navy (#1A237E) felt lining". 2-3 color areas max.
6. NEGATIVE CONSTRAINTS — Always end with "No text, no letters, no watermark" unless the concept requires a specific letter/symbol (then state it explicitly).
7. TWO VARIANTS = TWO DIFFERENT METAPHOR CATEGORIES — The variants must come from different conceptual families:
   • Object 物品类 (wallet, book, camera, radio, toolbox)
   • Character 角色类 (animal face, mascot, creature)
   • Tool 工具类 (lens, compass, gauge, dial, microscope)
   • Container 容器类 (pot, box, jar, basket, cup)
   • Scene 场景类 (window, portal, landscape-in-frame, stage)
   If variant_a is from "Object", variant_b MUST be from a different category.

━━━ STYLE SELECTION ━━━
Choose a styleWord for each variant based on the app's nature:
• "toylike" — cute, children's, lifestyle, casual (e.g. language learning, habit trackers)
• "refined" — professional, productivity, business tools (e.g. finance, notes, email)
• "modern" — high-end, creative, premium (e.g. photo editing, design tools, music)
• "minimal" — utility, developer tools, system apps (e.g. calculators, settings, converters)
• "playful" — games, social, entertainment (e.g. puzzle games, social apps, fun utilities)
The two variants MAY use different styleWords if appropriate.

━━━ FEW-SHOT EXAMPLES ━━━
Below are complete, high-quality prompt outputs (the final assembled text). Study their specificity, material descriptions, and structure:

【物品类 — 极简记账 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS a leather-bound pocket ledger, viewed from the front. Rich dark brown (#3E2723) leather surface with subtle cross-hatch stitching along the spine. A single vivid gold (#FFD600) coin peeks from between the pages at the top edge, catching light with a metallic sheen. A thin cream (#FFF8E1) page edge visible along the right side. Clean refined quality, crisp precise edges. Warm muted tones. Simplified and professional. Gold coin against dark leather creates strong focal contrast. No text, no letters, no watermark.

【角色类 — 小鹿学英语 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS the face of a young deer character, viewed straight on. Warm caramel (#D4A574) fur with soft velvety texture. Large friendly dark brown (#4E342E) eyes with tiny white (#FFFFFF) highlight dots. Two small budding antlers in warm tan (#BCAAA4) poking from the top. A cheerful blush of soft peach (#FFCCBC) on both cheeks. Charming toylike quality, crisp clean edges. Vivid saturated colors. Simplified and cheerful. Warm caramel face against soft peach blush. No text, no letters, no watermark.

【工具类 — 播客电台 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS the front grille of a vintage desk microphone, viewed straight on. Deep vivid blue (#1565C0) metal body with fine circular mesh pattern. A polished silver-white (#ECEFF1) ring frames the grille. A warm gold (#FFB300) center dot glows subtly. Refined modern with clean 3D volumes and layered depth. Bold saturated colors. Smooth pristine surfaces. Deep blue mesh against silver ring and gold center dot. No text, no letters, no watermark.

【容器类 — 旅行地图 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS a weathered leather suitcase, viewed from the front at a slight top-down angle. Rich cognac (#8D6E63) leather with visible travel-worn texture. Two brass (#C8A951) clasps near the top catching warm light. A single vivid teal (#00897B) luggage tag hangs from the handle. Clean refined quality, crisp precise edges. Warm muted tones. Simplified and professional. Teal tag and brass clasps pop against cognac leather. No text, no letters, no watermark.

【场景类 — 冥想呼吸 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS a circular zen window (moon gate) opening onto a serene scene, viewed straight on. Smooth warm stone (#D7CCC8) frame with fine sand texture. Through the opening: a soft gradient sky from pale lavender (#E1BEE7) at top to warm peach (#FFCCBC) at horizon. A single dark ink (#37474F) bamboo silhouette on the right. Clean and minimal. Subtle material hints. Warm muted cream tones. Simplified and professional. Dark bamboo silhouette against pastel gradient creates depth. No text, no letters, no watermark.

【工具类 — 密码管理器 app】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS a heavy steel vault door, viewed from the front. Brushed gunmetal (#455A64) surface with fine radial machining lines. A prominent polished chrome (#CFD8DC) combination dial in the center with subtle tick marks. A tiny green (#66BB6A) LED dot glows in the upper right corner indicating "locked". Refined modern with clean 3D volumes and layered depth. Bold saturated colors. Smooth pristine surfaces. Chrome dial and green LED against dark gunmetal. No text, no letters, no watermark.

━━━ OUTPUT FORMAT ━━━
Output ONLY valid JSON (no markdown fences, no commentary):
{
  "variant_a": {
    "subject": "what the squircle IS — a complete physical metaphor (e.g. 'the face of a young deer character')",
    "visualDetails": "viewpoint + every surface with hex color + material + tiny details (e.g. 'viewed straight on. Warm caramel (#D4A574) fur with soft velvety texture. Large friendly dark brown (#4E342E) eyes...')",
    "contrastColors": "which colors pop against which (e.g. 'Warm caramel face against soft peach blush')",
    "moodWord": "single mood word (e.g. 'cheerful', 'professional', 'serene')",
    "styleWord": "one of: toylike | refined | modern | minimal | playful"
  },
  "variant_b": {
    "subject": "a DIFFERENT metaphor from a DIFFERENT category than variant_a",
    "visualDetails": "...",
    "contrastColors": "...",
    "moodWord": "...",
    "styleWord": "..."
  }
}`;

// --- Helper functions ---

function jsonResponse(
  data: GenerateSuccessResponse | ErrorResponse,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function getClientIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function getTodayKey(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `limit:${ip}:${today}`;
}

// --- Rate limiting (check only, no increment) ---

async function checkRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const key = getTodayKey(ip);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: DAILY_LIMIT - count };
}

async function incrementRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<number> {
  const key = getTodayKey(ip);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;
  const newCount = count + 1;
  await kv.put(key, newCount.toString(), { expirationTtl: 86400 });
  return DAILY_LIMIT - newCount;
}

// --- Global generation queue (KV-based lock) ---

async function acquireGenerationLock(
  kv: KVNamespace,
  maxWaitMs: number = 30000
): Promise<boolean> {
  const lockKey = "generation:lock";
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const existing = await kv.get(lockKey);
    if (!existing) {
      // Try to acquire lock (TTL 120s as safety net)
      await kv.put(lockKey, Date.now().toString(), { expirationTtl: 120 });
      return true;
    }

    // Check if lock is stale (> 90s old)
    const lockTime = parseInt(existing, 10);
    if (Date.now() - lockTime > 90000) {
      await kv.put(lockKey, Date.now().toString(), { expirationTtl: 120 });
      return true;
    }

    // Wait and retry
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return false;
}

async function releaseGenerationLock(kv: KVNamespace): Promise<void> {
  await kv.delete("generation:lock");
}

async function getRemainingQuota(
  kv: KVNamespace,
  ip: string
): Promise<number> {
  const key = getTodayKey(ip);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;
  return Math.max(0, DAILY_LIMIT - count);
}

// --- Prompt synthesis (two variants) ---

function assemblePrompt(v: PromptVariant): string {
  const styleLine = STYLE_MAP[v.styleWord] || STYLE_MAP.toylike;
  return `A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS ${v.subject}. ${v.visualDetails}. ${styleLine} ${v.contrastColors}. No text, no letters, no watermark.`;
}

async function synthesizePrompts(
  description: string,
  apiKey: string
): Promise<[string, string]> {
  const requestBody: KimiChatRequest = {
    model: KIMI_MODEL,
    messages: [
      { role: "system", content: KIMI_SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
  };

  const response = await fetch(KIMI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kimi API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as KimiChatResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Kimi API returned empty content");
  }

  // Parse JSON — strip markdown code fences if present
  let parsed: PromptResponse;
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }
    parsed = JSON.parse(cleaned) as PromptResponse;
  } catch {
    throw new Error(`Failed to parse Kimi response as JSON: ${content}`);
  }

  // Validate both variants
  const validStyleWords: StyleWord[] = ['toylike', 'refined', 'modern', 'minimal', 'playful'];
  for (const key of ["variant_a", "variant_b"] as const) {
    const v = parsed[key];
    if (
      !v?.subject ||
      !v?.visualDetails ||
      !v?.contrastColors ||
      !v?.moodWord ||
      !v?.styleWord
    ) {
      throw new Error(
        `Kimi response missing required fields in ${key}: ${JSON.stringify(v)}`
      );
    }
    // Fallback: if styleWord is invalid, default to 'toylike'
    if (!validStyleWords.includes(v.styleWord)) {
      v.styleWord = 'toylike';
    }
  }

  return [assemblePrompt(parsed.variant_a), assemblePrompt(parsed.variant_b)];
}

// --- Image generation ---

async function generateIcon(
  prompt: string,
  apiKey: string,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(DASHSCOPE_SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DASHSCOPE_MODEL,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: prompt }],
            },
          ],
        },
        parameters: {
          size: "1024*1024",
          n: 1,
          prompt_extend: false,
          watermark: false,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Retry on rate limit
      if (response.status === 429 && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
        continue;
      }
      throw new Error(`Dashscope error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      output?: {
        choices?: Array<{
          message?: {
            content?: Array<{ image?: string }>;
          };
        }>;
      };
      code?: string;
      message?: string;
    };

    if (data.code) {
      // Retry on throttling
      if (data.code === "Throttling.RateQuota" && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
        continue;
      }
      throw new Error(`Dashscope API error: ${data.code} - ${data.message}`);
    }

    const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imageUrl) {
      throw new Error(
        `Dashscope returned no image: ${JSON.stringify(data)}`
      );
    }

    return imageUrl;
  }

  throw new Error("[throttled] Dashscope image generation failed after retries");
}

// --- Request handlers ---

async function handleGenerate(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { description?: string };
  try {
    body = (await request.json()) as { description?: string };
  } catch {
    return jsonResponse(
      { error: "invalid_input", message: "请提供有效的 JSON 请求体" },
      400
    );
  }

  const description = body.description?.trim();
  if (!description || description.length < 2 || description.length > 200) {
    return jsonResponse(
      { error: "invalid_input", message: "请输入 app 描述（2-200 字）" },
      400
    );
  }

  // Step 0: Check rate limit (without incrementing) — skip for test mode
  const ip = getClientIP(request);
  const url = new URL(request.url);
  const isTestMode = url.searchParams.has("test");

  if (!isTestMode) {
    const { allowed } = await checkRateLimit(env.RATE_LIMIT, ip);

    if (!allowed) {
      return jsonResponse(
        {
          error: "rate_limited",
          message: "内测中，每日限额已用完，请明天再来 🙂",
        },
        429
      );
    }
  }

  // Step 1: Acquire generation lock (queue behind other requests)
  const lockAcquired = await acquireGenerationLock(env.RATE_LIMIT);
  if (!lockAcquired) {
    return jsonResponse(
      { error: "queue_full", message: "当前使用人数较多，请稍后再试" },
      503
    );
  }

  try {
    // Step 2: Kimi generates two distinct prompt variants
    const [promptA, promptB] = await synthesizePrompts(
      description,
      env.DASHSCOPE_API_KEY
    );

    // Step 3: Generate icons sequentially to avoid rate limiting
    const iconUrl1 = await generateIcon(promptA, env.DASHSCOPE_API_KEY);
    const iconUrl2 = await generateIcon(promptB, env.DASHSCOPE_API_KEY);

    // Step 4: Only increment rate limit AFTER successful generation (skip in test mode)
    const remaining = isTestMode ? 99 : await incrementRateLimit(env.RATE_LIMIT, ip);

    const response: GenerateSuccessResponse = {
      icons: [
        { url: iconUrl1, index: 0 },
        { url: iconUrl2, index: 1 },
      ],
      remaining,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("Generation failed:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const isThrottled = errMsg.includes("Throttling") || errMsg.includes("429") || errMsg.includes("[throttled]");
    if (isThrottled) {
      return jsonResponse(
        { error: "throttled", message: "服务器繁忙，请等待 30 秒后重试" },
        503
      );
    }
    return jsonResponse(
      { error: "generation_failed", message: "生成失败，请稍后重试" },
      500
    );
  } finally {
    // Always release lock
    await releaseGenerationLock(env.RATE_LIMIT);
  }
}

async function handleQuota(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const isTestMode = url.searchParams.has("test");

  if (isTestMode) {
    return new Response(JSON.stringify({ remaining: 99, total: 99 }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const ip = getClientIP(request);
  const remaining = await getRemainingQuota(env.RATE_LIMIT, ip);
  return new Response(JSON.stringify({ remaining, total: DAILY_LIMIT }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// --- Main Worker ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === "/api/generate" && request.method === "POST") {
      return handleGenerate(request, env);
    }

    if (path === "/api/quota" && request.method === "GET") {
      return handleQuota(request, env);
    }

    return new Response("Not Found", {
      status: 404,
      headers: CORS_HEADERS,
    });
  },
};
