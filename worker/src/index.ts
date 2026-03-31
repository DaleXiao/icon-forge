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

interface PromptVariant {
  subject: string;
  visualDetails: string;
  contrastColors: string;
  moodWord: string;
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

const KIMI_SYSTEM_PROMPT = `You are an elite macOS app icon designer. Given a short app description (any language), you produce TWO distinct visual concepts — each a complete, highly specific icon prompt.

Critical design principles:
1. THE SQUIRCLE IS THE OBJECT — not "a squircle with X drawn on it", but "the squircle itself IS a vintage CRT monitor / a leather wallet / a terracotta pot". The entire icon shape becomes the physical object's front face.
2. REAL MATERIALS — specify exact textures: brushed metal grain, cork natural texture, warm terracotta, rich leather, light wood. Never generic "colored background".
3. SPECIFIC COLORS — use hex codes for key colors (e.g. deep charcoal #2D3436, vivid warm orange #FF7043, deep blue #1565C0). Every element needs a concrete color.
4. TINY DELIGHTFUL DETAILS — a chrome latch, a small LED dot, a water droplet catching light, a blinking cursor, a snap button. One or two small details that reward close inspection.
5. CLEAR VIEWPOINT — state exactly how we see the object: "viewed from above", "from the front", "viewed straight on".
6. WORKS AT SMALL SIZES — bold shapes, high contrast between 2-3 main color areas. No tiny text, no intricate patterns.
7. The two variants MUST use different visual metaphors / objects / color palettes. Not just minor tweaks — genuinely different creative directions.

Examples of great icon concepts:
- A CRT monitor with green glowing monospace text on dark screen, warm beige-grey plastic bezel
- A metal toolbox (charcoal #2D3436 brushed surface), lid cracked open showing colorful tool heads peeking out
- A cork bulletin board with a 4x4 grid of vivid push pins (some filled, some empty)
- A wooden painter's palette viewed from above with vivid paint blobs and a slim brush
- A terracotta flower pot from above, rich dark soil with bright green succulent
- A leather card wallet, dark charcoal surface, colorful subscription cards peeking from top
- An airplane window from inside — white plastic frame, oval opening, vivid blue sky with clouds, translucent shade pulled slightly down
- A camera lens viewed straight on — deep charcoal outer ring, vivid deep blue glass element with highlight streak, tiny red recording LED
- A desk microphone front grille — deep vivid blue with fine circular mesh, silver-white ring, warm gold center dot

Output ONLY valid JSON:
{
  "variant_a": {
    "subject": "what the squircle IS (the physical object/metaphor)",
    "visualDetails": "specific colors (with hex), materials, layout, tiny details, viewpoint",
    "contrastColors": "which colors pop against which",
    "moodWord": "single mood/style word"
  },
  "variant_b": {
    "subject": "a DIFFERENT physical object/metaphor",
    "visualDetails": "different colors, materials, layout, details",
    "contrastColors": "contrast description",
    "moodWord": "single word"
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
  return `A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS ${v.subject}. ${v.visualDetails}. Charming toylike quality, crisp clean edges. ${v.contrastColors}. Simplified and ${v.moodWord}. No text, no letters, no watermark.`;
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
  for (const key of ["variant_a", "variant_b"] as const) {
    const v = parsed[key];
    if (
      !v?.subject ||
      !v?.visualDetails ||
      !v?.contrastColors ||
      !v?.moodWord
    ) {
      throw new Error(
        `Kimi response missing required fields in ${key}: ${JSON.stringify(v)}`
      );
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

  throw new Error("Dashscope image generation failed after retries");
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

  // Step 0: Check rate limit (without incrementing)
  const ip = getClientIP(request);
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

    // Step 4: Only increment rate limit AFTER successful generation
    const remaining = await incrementRateLimit(env.RATE_LIMIT, ip);

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
