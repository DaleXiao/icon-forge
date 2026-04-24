export interface Env {
  RATE_LIMIT: KVNamespace;
  DASHSCOPE_API_KEY: string;
  ENVIRONMENT: string;
  GENERATION_QUEUE: DurableObjectNamespace;
}

// --- Types ---

interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PromptChatRequest {
  model: string;
  messages: PromptMessage[];
  response_format?: { type: string };
  temperature?: number;
  enable_thinking?: boolean;
  [key: string]: unknown;
}

interface PromptChatResponse {
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

interface QueueTask {
  taskId: string;
  description: string;
  ip: string;
  isTestMode: boolean;
  promptModel: string;
  status: "queued" | "generating" | "complete" | "error";
  icons: Array<{ url: string; index: number }>;
  remaining?: number;
  errorMessage?: string;
  createdAt: number;
  currentIconIndex?: number;
}

interface SSEWriter {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  taskId: string;
}

// --- Constants ---

const DAILY_LIMIT = 3;
const PROMPT_MODEL = "qwen3.6-plus";
const DASHSCOPE_MODEL = "wan2.7-image-pro";
const DASHSCOPE_SUBMIT_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const PROMPT_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const COMPAT_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_QUEUE_SIZE = 10;
const TASK_TIMEOUT_MS = 120_000;

// Origin allowlist — only these front-ends may call the mutating endpoints.
const ALLOWED_ORIGINS = new Set<string>([
  "https://icon.weweekly.online",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
]);

// Short-burst rate limit (IP-scoped, in addition to the daily quota).
const BURST_WINDOW_SECONDS = 60;
const BURST_LIMIT = 3;

const STYLE_MAP: Record<StyleWord, string> = {
  toylike: 'Charming toylike quality, crisp clean edges. Vivid saturated colors. Simplified and cheerful.',
  refined: 'Clean refined quality, crisp precise edges. Warm muted tones. Simplified and professional.',
  modern: 'Refined modern with clean 3D volumes and layered depth. Bold saturated colors. Smooth pristine surfaces.',
  minimal: 'Clean and minimal. Subtle material hints. Warm muted cream tones. Simplified and professional.',
  playful: 'Charming toylike quality, crisp clean edges. Vivid saturated colors. Fun and delightful.',
};

const SYSTEM_PROMPT = `You are an elite macOS/iOS app icon designer. Given a short app description (any language), you produce TWO genuinely different visual concepts as structured JSON.

━━━ CORE PRINCIPLE ━━━
"The squircle itself IS ___." — The entire icon shape BECOMES the physical object. NOT "a squircle with X drawn on it". The squircle IS a vintage radio, IS a leather journal, IS a terracotta pot.

━━━ DESIGN RULES ━━━
1. SQUIRCLE = OBJECT — The icon shape transforms into the front face of a real-world object or metaphorical container. Think "what physical thing could represent this app?"
2. MATERIALS ARE SPECIFIC — Never say "colored surface". Always: "vivid red (#E53935) smooth surface with subtle leather-grain hint" or "warm maple wood (#D4A574) with visible grain lines". Every surface = hex color + material texture.
3. ELEMENT COUNT: 2-3 MAX — One dominant subject + 1-2 small accent details. More than 3 elements = muddy at small sizes. The best icons are ruthlessly simple.
4. VIEWPOINT IS EXPLICIT — Always state: "viewed from the front", "viewed from above", "at a slight top-down angle", "viewed straight on".
5. COLOR CONTRAST IS KEY — Always describe which colors pop against which: "vivid orange coins (#FF9800) against deep navy (#1A237E) felt lining". 2-3 color areas max.
6. NEGATIVE CONSTRAINTS — Always end with "No text, no letters, no watermark" unless the concept requires a specific letter/symbol (then state it explicitly).

━━━ RELEVANCE & DIVERSITY ━━━
7. BOTH VARIANTS MUST BE STRONGLY RELEVANT to the app description. A user should immediately understand "this icon is for THAT app". Never sacrifice relevance for novelty. If one variant is weak, make it stronger — not more random.
8. TWO DIFFERENT VISUAL INTERPRETATIONS — Both variants explore the SAME theme from different angles. Think: two designers given the same brief, each with their own creative take. They may use similar object categories if that produces the best result.
9. NEVER REUSE metaphors from the examples below. Choose unexpected, surprising objects from everyday life. Avoid clichés: no compass for travel, no suitcase for travel, no coins for finance, no lock for security — unless you truly cannot find a better metaphor.
10. MATERIAL DIVERSITY — Vary your material palette. Don't default to leather/brass/copper. Consider: glass, ceramic, fabric, paper, stone, candy, ice, wood grain, enamel, felt, concrete, porcelain, resin, wax, frosted glass.

━━━ STYLE SELECTION ━━━
Choose a styleWord for each variant based on the app's nature:
• "toylike" — cute, children's, lifestyle, casual (e.g. language learning, habit trackers)
• "refined" — professional, productivity, business tools (e.g. finance, notes, email)
• "modern" — high-end, creative, premium (e.g. photo editing, design tools, music)
• "minimal" — utility, developer tools, system apps (e.g. calculators, settings, converters)
• "playful" — games, social, entertainment (e.g. puzzle games, social apps, fun utilities)
The two variants MAY use different styleWords if appropriate.

━━━ FEW-SHOT EXAMPLES ━━━
Study the REASONING and FORMAT. Do NOT copy these metaphors — invent your own.

【Example 1: "Weather forecast app"】
→ Reasoning: Weather = looking out a window at the sky. An airplane window is unexpected yet instantly evokes sky/weather.
→ Output subject: "an airplane window viewed from inside"
→ Output visualDetails: "viewed straight on. A soft warm white plastic window frame fills the squircle, with a rounded oval opening in the center. Through the window, a vivid blue sky with fluffy white clouds below. The window frame has a precise inner bezel ring with subtle thickness. The upper-right edge of a translucent window shade is slightly pulled down, curling with a realistic fold."
→ Output contrastColors: "Vivid blue sky against warm white frame and translucent shade"

【Example 2: "Writing tool / text editor"】
→ Reasoning: Writing = typewriter. Top-down view of a typewriter naturally fills the squircle.
→ Output subject: "a typewriter viewed from above"
→ Output visualDetails: "viewed from above. A rich dark charcoal (#2D3436) body fills the squircle. Rows of small round keys with vivid green letter caps are neatly arranged across the lower two-thirds. A white sheet of paper peeks from the top edge with a few lines of tiny dark text. A slim warm gold carriage return lever extends to the right. The round keys catch soft highlights."
→ Output contrastColors: "Green key caps and white paper pop against the dark body"

【Example 3: "Markdown note-taking app"】
→ Reasoning: Notes = an open notebook page. A coral # symbol anchors the Markdown identity.
→ Output subject: "an open notebook page viewed from the front"
→ Output visualDetails: "viewed from the front. A warm cream (#FFF8E7) paper surface fills the squircle with faint horizontal ruled lines. On the page, several lines of text in different sizes — a bold large dark brown line at the top for a heading, two thinner light brown lines below, and a vivid coral red (#FF5722) hashtag symbol at the start of the heading. A slim warm wood pen rests diagonally across the lower-right corner. A thin warm gold spine line runs along the left edge."
→ Output contrastColors: "Coral markdown symbol and dark heading pop against the warm cream page"

【Example 4: "Video recording / camera app"】
→ Reasoning: Video = camera lens. A lens viewed straight on is a circle inside a square — perfect squircle fit.
→ Output subject: "the front face of a camera lens viewed straight on"
→ Output visualDetails: "viewed straight on. A deep charcoal (#2D3436) outer ring fills the squircle. Inside, a vivid deep blue (#1565C0) glass lens element reflects a soft highlight streak diagonally across its surface. At the center, a smaller dark iris ring. A tiny vivid red recording indicator light sits at the top-right edge of the outer ring."
→ Output contrastColors: "The blue lens glow and red light pop against deep charcoal"

【Example 5: "Travel map / navigation app"】
→ Reasoning: Travel = a folded paper map. Fold creases + route line = instant recognition.
→ Output subject: "a folded paper map viewed from above"
→ Output visualDetails: "viewed from above. The warm cream-white paper surface fills the squircle with subtle fold creases forming a grid. A vivid red dotted route line winds across the surface from lower-left to upper-right, ending at a bright red location pin marker. A small warm gold compass rose sits in one corner."
→ Output contrastColors: "Vivid red route and pin pop against the cream map"

【Example 6: "Subscription management / wallet app"】
→ Reasoning: Subscriptions = cards in a wallet. Colorful card edges peeking out = visual shorthand for multiple subscriptions.
→ Output subject: "the front of a leather card wallet"
→ Output visualDetails: "viewed from the front. A rich dark charcoal (#2D3436) leather surface fills the entire squircle with subtle material warmth. From the top edge, five colorful subscription cards peek out in a neat fan arrangement — each showing just a thin strip of vivid color: bright blue, coral red, sunny yellow, fresh green, and warm purple. A small warm gold snap button sits centered in the lower third."
→ Output contrastColors: "The vivid card colors pop cheerfully against the dark wallet"

━━━ SELF-CHECK (perform in your reasoning before outputting JSON) ━━━
Before writing the final JSON, mentally verify EACH point. If any fails, revise before output:
☑ RELEVANCE: Would a user immediately say "yes, this icon is for THAT app"? Both variants must pass this test.
☑ SHAPE: Is the subject something that can naturally fill a rounded square (macOS icon shape)? Avoid tall/narrow objects that fight the square format.
☑ AESTHETICS: Would this icon look beautiful at 1024x1024 AND recognizable at 64x64? Is the color palette harmonious? Are accent colors intentional, not random?
☑ SIMPLICITY: 2-3 elements max. Could you describe the icon in one sentence? If not, simplify.
☑ DIFFERENTIATION: Are the two variants genuinely different visual concepts, not just color swaps?
☑ MATERIAL FRESHNESS: Are you defaulting to leather/brass/copper? Force yourself to consider at least one unusual material.

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
  data: Record<string, unknown>,
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

async function checkBurst(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = `burst:${ip}:${Math.floor(Date.now() / (BURST_WINDOW_SECONDS * 1000))}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= BURST_LIMIT) {
    return { allowed: false, retryAfter: BURST_WINDOW_SECONDS };
  }
  await kv.put(key, String(count + 1), { expirationTtl: BURST_WINDOW_SECONDS * 2 });
  return { allowed: true };
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

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

async function getRemainingQuota(
  kv: KVNamespace,
  ip: string
): Promise<number> {
  const key = getTodayKey(ip);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;
  return Math.max(0, DAILY_LIMIT - count);
}

// --- Prompt synthesis ---

function assemblePrompt(v: PromptVariant): string {
  const styleLine = STYLE_MAP[v.styleWord] || STYLE_MAP.toylike;
  return `A macOS Sonoma app icon shaped exactly as a rounded square (squircle) with continuous curvature corners at approximately 22% of the icon width, no sharp edges, perfectly smooth transitions — a single unified shape, no floating objects, no circular frames, no irregular silhouettes. Centered on white canvas with padding, occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS ${v.subject}. ${v.visualDetails}. ${v.contrastColors}. ${styleLine} The shape must strictly follow macOS app icon conventions — one solid rounded square. No text, no letters, no watermark.`;
}

async function synthesizePrompts(
  description: string,
  apiKey: string,
  model: string = PROMPT_MODEL
): Promise<[string, string]> {
  const requestBody: PromptChatRequest = {
    model,
    temperature: 0.8,
    enable_thinking: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
  };

  // Retry loop for prompt API (handles 429 rate limit)
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(PROMPT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429 && attempt < 2) {
      const delay = Math.min(5000 * Math.pow(2, attempt), 20000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    const errorText = response ? await response.text() : "No response";
    throw new Error(`Prompt API error (${response?.status}): ${errorText}`);
  }

  const data = (await response.json()) as PromptChatResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Prompt API returned empty content");
  }

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
    throw new Error(`Failed to parse prompt response as JSON: ${content}`);
  }

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
        `Prompt response missing required fields in ${key}: ${JSON.stringify(v)}`
      );
    }
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
  maxRetries: number = 5
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
          seed: Math.floor(Math.random() * 2147483647),
          prompt_extend: false,
          watermark: false,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.min(5000 * Math.pow(2, attempt), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
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
      if (data.code === "Throttling.RateQuota" && attempt < maxRetries - 1) {
        const delay = Math.min(5000 * Math.pow(2, attempt), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`Dashscope API error: ${data.code} - ${data.message}`);
    }

    const image = data.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!image) {
      throw new Error(`Dashscope returned no image: ${JSON.stringify(data)}`);
    }

    return image;
  }

  throw new Error("[throttled] Dashscope image generation failed after retries");
}

// --- Background removal ---

async function removeBackground(imageUrl: string, apiKey: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(COMPAT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "wan2.7-image-pro",
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                {
                  type: "text",
                  text: "Cut out the rounded square icon from the white background. The area outside the icon should be completely transparent (alpha=0). Do not replace the background with any pattern.",
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`removeBackground HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: Array<{ type?: string; image?: string }>;
          };
        }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in removeBackground response");
      const imageItem = content.find((item) => item.type === "image");
      if (!imageItem?.image) throw new Error("No image in removeBackground response");
      return imageItem.image;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("removeBackground failed after retries");
}

// --- Durable Object: GenerationQueue ---

export class GenerationQueue {
  private state: DurableObjectState;
  private queue: QueueTask[] = [];
  private sseClients: Map<string, SSEWriter[]> = new Map();
  private completedTasks: Map<string, QueueTask> = new Map();
  private processing = false;
  private env: Env;
  private lastDashscopeFinishedAt = 0;
  private static readonly DASHSCOPE_COOLDOWN_MS = 3000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/enqueue" && request.method === "POST") {
      return this.handleEnqueue(request);
    }

    if (path === "/stream" && request.method === "GET") {
      return this.handleStream(request);
    }

    if (path === "/status" && request.method === "GET") {
      return this.handleStatus(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleEnqueue(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      taskId: string;
      description: string;
      ip: string;
      isTestMode: boolean;
      promptModel: string;
    };

    // Clean up timed-out tasks
    this.cleanupTimedOut();

    // Check queue capacity
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return jsonResponse(
        {
          error: "queue_full",
          message: "当前使用人数较多，请 30 秒后再试",
          retryAfter: 30,
        },
        503
      );
    }

    const task: QueueTask = {
      taskId: body.taskId,
      description: body.description,
      ip: body.ip,
      isTestMode: body.isTestMode,
      promptModel: body.promptModel || PROMPT_MODEL,
      status: "queued",
      icons: [],
      createdAt: Date.now(),
    };

    this.queue.push(task);
    const position = this.queue.length;

    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }

    return jsonResponse({ taskId: task.taskId, position }, 202);
  }

  private handleStream(request: Request): Response {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");

    if (!taskId) {
      return jsonResponse({ error: "missing_taskId", message: "缺少 taskId 参数" }, 400);
    }

    // Check if task exists in queue or completed holding area
    const task = this.queue.find((t) => t.taskId === taskId) || this.completedTasks.get(taskId) || null;

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sseWriter: SSEWriter = { writer, taskId };

    // Register the SSE client
    if (!this.sseClients.has(taskId)) {
      this.sseClients.set(taskId, []);
    }
    this.sseClients.get(taskId)!.push(sseWriter);

    // Send current state immediately if task exists
    if (task) {
      const sendCurrentState = async () => {
        try {
          if (task.status === "queued") {
            const position = this.queue.findIndex((t) => t.taskId === taskId) + 1;
            await writer.write(
              encoder.encode(`event: queued\ndata: ${JSON.stringify({ position })}\n\n`)
            );
          } else if (task.status === "generating") {
            await writer.write(
              encoder.encode(
                `event: generating\ndata: ${JSON.stringify({ index: task.currentIconIndex ?? 0, total: 2 })}\n\n`
              )
            );
            // Send any already-completed icons
            for (const icon of task.icons) {
              await writer.write(
                encoder.encode(
                  `event: icon_ready\ndata: ${JSON.stringify({ url: icon.url, index: icon.index })}\n\n`
                )
              );
            }
          } else if (task.status === "complete") {
            // Send all icons and complete
            for (const icon of task.icons) {
              await writer.write(
                encoder.encode(
                  `event: icon_ready\ndata: ${JSON.stringify({ url: icon.url, index: icon.index })}\n\n`
                )
              );
            }
            await writer.write(
              encoder.encode(
                `event: complete\ndata: ${JSON.stringify({ icons: task.icons, remaining: task.remaining })}\n\n`
              )
            );
            await writer.close();
            this.removeSseClient(taskId, sseWriter);
          } else if (task.status === "error") {
            await writer.write(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ message: task.errorMessage })}\n\n`
              )
            );
            await writer.close();
            this.removeSseClient(taskId, sseWriter);
          }
        } catch {
          // Client disconnected
          this.removeSseClient(taskId, sseWriter);
        }
      };
      sendCurrentState();
    } else {
      // Task not found — might have already been cleaned up
      const sendNotFound = async () => {
        try {
          await writer.write(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: "任务不存在或已过期" })}\n\n`
            )
          );
          await writer.close();
        } catch {
          // ignore
        }
      };
      sendNotFound();
      this.removeSseClient(taskId, sseWriter);
    }

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS_HEADERS,
      },
    });
  }

  private handleStatus(request: Request): Response {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");

    if (!taskId) {
      return jsonResponse({ error: "missing_taskId", message: "缺少 taskId 参数" }, 400);
    }

    const task = this.queue.find((t) => t.taskId === taskId) || this.completedTasks.get(taskId) || null;
    if (!task) {
      return jsonResponse({ error: "not_found", message: "任务不存在或已过期" }, 404);
    }

    const position = this.queue.findIndex((t) => t.taskId === taskId) + 1;
    return jsonResponse({
      taskId: task.taskId,
      status: task.status,
      position,
      icons: task.icons,
      remaining: task.remaining,
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];

      // Skip if already completed/errored (shouldn't happen, but safety)
      if (task.status === "complete" || task.status === "error") {
        this.queue.shift();
        continue;
      }

      // Notify all queued tasks of their position
      this.broadcastQueuePositions();

      try {
        // Mark as generating
        task.status = "generating";
        task.currentIconIndex = 0;
        this.sendToTask(task.taskId, "generating", { index: 0, total: 2 });

        // Step 1: Synthesize prompts
        const [promptA, promptB] = await synthesizePrompts(
          task.description,
          this.env.DASHSCOPE_API_KEY,
          task.promptModel
        );

        // Step 2: Generate icons (1 per prompt, 2 total)
        await this.waitForCooldown();

        const urlA = await generateIcon(promptA, this.env.DASHSCOPE_API_KEY);
        let finalA = urlA;
        try {
          finalA = await removeBackground(urlA, this.env.DASHSCOPE_API_KEY);
        } catch (e) {
          console.warn(`removeBackground failed for index 0, using original:`, e);
        }
        task.icons.push({ url: finalA, index: 0 });
        this.sendToTask(task.taskId, "icon_ready", { url: finalA, index: 0 });

        // cooldown
        this.lastDashscopeFinishedAt = Date.now();
        await this.waitForCooldown();

        const urlB = await generateIcon(promptB, this.env.DASHSCOPE_API_KEY);
        let finalB = urlB;
        try {
          finalB = await removeBackground(urlB, this.env.DASHSCOPE_API_KEY);
        } catch (e) {
          console.warn(`removeBackground failed for index 1, using original:`, e);
        }
        task.icons.push({ url: finalB, index: 1 });
        this.sendToTask(task.taskId, "icon_ready", { url: finalB, index: 1 });

        // Step 4: Increment rate limit (deferred billing)
        const remaining = task.isTestMode
          ? 99
          : await incrementRateLimit(this.env.RATE_LIMIT, task.ip);
        task.remaining = remaining;

        // Complete
        task.status = "complete";
        this.sendToTask(task.taskId, "complete", {
          icons: task.icons,
          remaining,
        });
      } catch (error) {
        console.error("Generation failed:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        const isThrottled =
          errMsg.includes("Throttling") ||
          errMsg.includes("429") ||
          errMsg.includes("[throttled]");

        task.status = "error";
        task.errorMessage = isThrottled
          ? "服务器繁忙，请等待 30 秒后重试"
          : "生成失败，请稍后重试";
        this.sendToTask(task.taskId, "error", { message: task.errorMessage });
      }

      // Keep completed/errored task in queue briefly for SSE reconnection
      // Move to a "done" holding area, clean up after 30s
      this.queue.shift();
      this.completedTasks.set(task.taskId, task);
      setTimeout(() => {
        this.completedTasks.delete(task.taskId);
        this.closeSseClients(task.taskId);
      }, 300000); // 5 minutes — allows mobile Safari to reconnect after lock screen
    }

    this.processing = false;
  }

  private async waitForCooldown(): Promise<void> {
    if (this.lastDashscopeFinishedAt === 0) return;
    const elapsed = Date.now() - this.lastDashscopeFinishedAt;
    const remaining = GenerationQueue.DASHSCOPE_COOLDOWN_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  private broadcastQueuePositions(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      if (task.status === "queued") {
        this.sendToTask(task.taskId, "queued", { position: i + 1 });
      }
    }
  }

  private sendToTask(taskId: string, event: string, data: Record<string, unknown>): void {
    const clients = this.sseClients.get(taskId);
    if (!clients || clients.length === 0) return;

    const encoder = new TextEncoder();
    const message = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const toRemove: SSEWriter[] = [];
    for (const client of clients) {
      try {
        client.writer.write(message);
      } catch {
        toRemove.push(client);
      }
    }

    // Clean up disconnected clients
    for (const client of toRemove) {
      this.removeSseClient(taskId, client);
    }
  }

  private closeSseClients(taskId: string): void {
    const clients = this.sseClients.get(taskId);
    if (!clients) return;

    for (const client of clients) {
      try {
        client.writer.close();
      } catch {
        // already closed
      }
    }
    this.sseClients.delete(taskId);
  }

  private removeSseClient(taskId: string, client: SSEWriter): void {
    const clients = this.sseClients.get(taskId);
    if (!clients) return;

    const idx = clients.indexOf(client);
    if (idx !== -1) {
      clients.splice(idx, 1);
    }
    if (clients.length === 0) {
      this.sseClients.delete(taskId);
    }
  }

  private cleanupTimedOut(): void {
    const now = Date.now();
    this.queue = this.queue.filter((task) => {
      if (now - task.createdAt > TASK_TIMEOUT_MS) {
        this.sendToTask(task.taskId, "error", {
          message: "任务超时，请重新提交",
        });
        this.closeSseClients(task.taskId);
        return false;
      }
      return true;
    });
  }
}

// --- Request handlers ---

function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

  const ip = getClientIP(request);
  const url = new URL(request.url);
  const isTestMode = url.searchParams.has("test");
  const promptModel = PROMPT_MODEL;

  // Burst limit (short window) before daily quota.
  if (!isTestMode) {
    const burst = await checkBurst(env.RATE_LIMIT, ip);
    if (!burst.allowed) {
      return jsonResponse(
        {
          error: "rate_limited_burst",
          message: `请求太快，请 ${burst.retryAfter}s 后再试`,
        },
        429
      );
    }
  }

  // Check rate limit before queuing
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

  // Forward to Durable Object
  const taskId = generateTaskId();
  const doId = env.GENERATION_QUEUE.idFromName("singleton");
  const doStub = env.GENERATION_QUEUE.get(doId);

  const doResponse = await doStub.fetch(
    new Request("https://do/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, description, ip, isTestMode, promptModel }),
    })
  );

  // Forward the DO response (either 202 with taskId/position, or 503 queue_full)
  const responseBody = await doResponse.text();
  return new Response(responseBody, {
    status: doResponse.status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

async function handleStream(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    return jsonResponse(
      { error: "missing_taskId", message: "缺少 taskId 参数" },
      400
    );
  }

  const doId = env.GENERATION_QUEUE.idFromName("singleton");
  const doStub = env.GENERATION_QUEUE.get(doId);

  const doResponse = await doStub.fetch(
    new Request(`https://do/stream?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
    })
  );

  // Return SSE response with CORS headers
  return new Response(doResponse.body, {
    status: doResponse.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
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
      if (!isAllowedOrigin(request)) {
        return new Response(
          JSON.stringify({ error: "forbidden", message: "origin not allowed" }),
          { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }
      return handleGenerate(request, env);
    }

    if (path === "/api/generate/stream" && request.method === "GET") {
      return handleStream(request, env);
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
