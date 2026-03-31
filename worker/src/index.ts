export interface Env {
  RATE_LIMIT: KVNamespace;
  DASHSCOPE_API_KEY: string;
  ENVIRONMENT: string;
}

// --- Kimi API types ---

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

interface PromptComponents {
  subject: string;
  visualDetails: string;
  contrastColors: string;
  moodWord: string;
}

// (Image generation uses the multimodal-generation sync API)

// --- API response types ---

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
const KIMI_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const KIMI_SYSTEM_PROMPT = `You are an expert app icon designer. Given a short app description (often Chinese), output ONLY valid JSON with exactly 4 fields:
- "subject": English, what the squircle icon IS (the main visual metaphor/object)
- "visualDetails": English, colors, layout, materials, element arrangement
- "contrastColors": English, contrasting accent colors description
- "moodWord": single English mood/style word

Be creative and specific. Prioritize clarity at small sizes. The icon should feel premium, toylike, and charming.`;

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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `limit:${ip}:${today}`;
}

// --- Rate limiting ---

async function checkAndIncrementRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const key = getTodayKey(ip);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  const newCount = count + 1;
  // TTL of 24 hours (86400 seconds)
  await kv.put(key, newCount.toString(), { expirationTtl: 86400 });

  return { allowed: true, remaining: DAILY_LIMIT - newCount };
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

// --- Kimi prompt synthesis ---

async function synthesizePrompt(
  description: string,
  apiKey: string
): Promise<string> {
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

  // Parse the JSON response — strip markdown code fences if present
  let components: PromptComponents;
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    components = JSON.parse(cleaned) as PromptComponents;
  } catch {
    throw new Error(`Failed to parse Kimi response as JSON: ${content}`);
  }

  // Validate required fields
  if (
    !components.subject ||
    !components.visualDetails ||
    !components.contrastColors ||
    !components.moodWord
  ) {
    throw new Error(
      `Kimi response missing required fields: ${JSON.stringify(components)}`
    );
  }

  // Assemble the final prompt using the template
  const finalPrompt = `A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS ${components.subject}. ${components.visualDetails}. Charming toylike quality, crisp clean edges. ${components.contrastColors}. Simplified and ${components.moodWord}.`;

  return finalPrompt;
}

// --- Image generation ---

async function generateIcon(
  prompt: string,
  apiKey: string
): Promise<string> {
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
    throw new Error(
      `Dashscope error (${response.status}): ${errorText}`
    );
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

// --- Request handlers ---

async function handleGenerate(
  request: Request,
  env: Env
): Promise<Response> {
  // Parse and validate input
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

  // Check rate limit
  const ip = getClientIP(request);
  const { allowed, remaining } = await checkAndIncrementRateLimit(
    env.RATE_LIMIT,
    ip
  );

  if (!allowed) {
    return jsonResponse(
      {
        error: "rate_limited",
        message: "内测中，每日限额已用完，请明天再来 🙂",
      },
      429
    );
  }

  try {
    // Step 1: Synthesize prompt via Kimi
    const finalPrompt = await synthesizePrompt(description, env.DASHSCOPE_API_KEY);

    // Step 2: Generate 2 icons in parallel
    const [iconUrl1, iconUrl2] = await Promise.all([
      generateIcon(finalPrompt, env.DASHSCOPE_API_KEY),
      generateIcon(finalPrompt, env.DASHSCOPE_API_KEY),
    ]);

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

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Route handling
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
