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

// --- Dashscope API types ---

interface DashscopeSubmitResponse {
  output: {
    task_status: string;
    task_id: string;
  };
  request_id: string;
}

interface DashscopeTaskResponse {
  output: {
    task_status: string;
    task_id: string;
    results?: Array<{ url?: string; code?: string; message?: string }>;
    task_metrics?: {
      TOTAL: number;
      SUCCEEDED: number;
      FAILED: number;
    };
  };
  request_id: string;
  usage?: {
    image_count: number;
  };
}

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
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
const KIMI_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const KIMI_SYSTEM_PROMPT = `You are an expert app icon designer. The user will give you a short description of an app (in any language, often Chinese). Your job is to analyze it and output a JSON object that describes the visual design of a macOS-style app icon.

Rules:
1. Output ONLY valid JSON, no other text, no markdown code fences.
2. The JSON must have exactly these 4 fields:
   - "subject": A concise English description of what the squircle icon IS (the main visual metaphor/object). Example: "a cute cartoon deer wearing headphones, reading a book"
   - "visualDetails": English description of colors, layout, materials, element arrangement. Example: "gradient from warm orange to golden yellow, the deer is centered, soft fabric texture, a small English alphabet 'A' floats nearby"
   - "contrastColors": English description of contrasting accent colors. Example: "Deep teal accents against the warm orange background, white highlights on the book pages"
   - "moodWord": A single English mood/style word. Example: "playful"
3. Be creative and specific. Think about what visual metaphor best represents the app concept.
4. Prioritize clarity at small sizes — avoid tiny intricate details.
5. The icon should feel premium, toylike, and charming.`;

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
    response_format: { type: "json_object" },
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

  // Parse the JSON response
  let components: PromptComponents;
  try {
    components = JSON.parse(content) as PromptComponents;
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

// --- Dashscope image generation ---

async function submitImageTask(
  prompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(DASHSCOPE_SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: DASHSCOPE_MODEL,
      input: {
        prompt,
      },
      parameters: {
        size: "1024*1024",
        n: 1,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Dashscope submit error (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as DashscopeSubmitResponse;
  const taskId = data.output?.task_id;

  if (!taskId) {
    throw new Error(
      `Dashscope did not return task_id: ${JSON.stringify(data)}`
    );
  }

  return taskId;
}

async function pollTaskResult(
  taskId: string,
  apiKey: string
): Promise<string> {
  const pollUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    const response = await fetch(pollUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Dashscope poll error (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as DashscopeTaskResponse;
    const status = data.output?.task_status;

    if (status === "SUCCEEDED") {
      const results = data.output?.results;
      if (!results || results.length === 0) {
        throw new Error("Dashscope task succeeded but no results returned");
      }
      const url = results[0]?.url;
      if (!url) {
        throw new Error(
          `Dashscope result has no URL: ${JSON.stringify(results[0])}`
        );
      }
      return url;
    }

    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(
        `Dashscope task ${status}: ${JSON.stringify(data.output)}`
      );
    }

    // Still PENDING or RUNNING, wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Dashscope task timed out after ${POLL_TIMEOUT_MS}ms`);
}

async function generateIcon(
  prompt: string,
  apiKey: string
): Promise<string> {
  const taskId = await submitImageTask(prompt, apiKey);
  const imageUrl = await pollTaskResult(taskId, apiKey);
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
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return jsonResponse(
      { error: "generation_failed", message: `生成失败，请重试：${message}` },
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
