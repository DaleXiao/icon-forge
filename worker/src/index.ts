export interface Env {
  RATE_LIMIT: KVNamespace;
  DASHSCOPE_API_KEY: string;
  ENVIRONMENT: string;
  GENERATION_QUEUE: DurableObjectNamespace;
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
  temperature?: number;
  enable_thinking?: boolean;
  [key: string]: unknown;
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

const MAX_QUEUE_SIZE = 3;
const TASK_TIMEOUT_MS = 120_000;

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
Study the FORMAT and SPECIFICITY only. Do NOT copy these metaphors — invent your own.

【Example A — format reference】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS the front grille of a vintage desk microphone, viewed straight on. Deep vivid blue (#1565C0) metal body with fine circular mesh pattern. A polished silver-white (#ECEFF1) ring frames the grille. A warm gold (#FFB300) center dot glows subtly. Refined modern with clean 3D volumes and layered depth. Bold saturated colors. Smooth pristine surfaces. Deep blue mesh against silver ring and gold center dot. No text, no letters, no watermark.

【Example B — format reference】
A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The squircle itself IS the face of a young deer character, viewed straight on. Warm caramel (#D4A574) fur with soft velvety texture. Large friendly dark brown (#4E342E) eyes with tiny white (#FFFFFF) highlight dots. Two small budding antlers in warm tan (#BCAAA4) poking from the top. A cheerful blush of soft peach (#FFCCBC) on both cheeks. Charming toylike quality, crisp clean edges. Vivid saturated colors. Simplified and cheerful. Warm caramel face against soft peach blush. No text, no letters, no watermark.

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
  return `A macOS app icon shaped exactly like a macOS Sonoma app icon — a rounded square (squircle) with continuous curvature corners at approximately 22% of the icon width, no sharp edges, perfectly smooth transitions. Centered on a clean white canvas with padding, occupying about 80% of the canvas. Flat front face, slight edge thickness, soft drop shadow beneath. The icon itself IS ${v.subject}. ${v.visualDetails}. ${styleLine} ${v.contrastColors}. The shape must strictly follow macOS app icon conventions — a single unified rounded square, no floating objects, no circular frames, no irregular silhouettes. No text, no letters, no watermark.`;
}

async function synthesizePrompts(
  description: string,
  apiKey: string,
  model: string = KIMI_MODEL
): Promise<[string, string]> {
  const requestBody: KimiChatRequest = {
    model,
    temperature: 0.85,
    enable_thinking: true,
    messages: [
      { role: "system", content: KIMI_SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
  };

  // Retry loop for Kimi API (handles 429 rate limit)
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(KIMI_API_URL, {
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
    throw new Error(`Kimi API error (${response?.status}): ${errorText}`);
  }

  const data = (await response.json()) as KimiChatResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Kimi API returned empty content");
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
    throw new Error(`Failed to parse Kimi response as JSON: ${content}`);
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
        `Kimi response missing required fields in ${key}: ${JSON.stringify(v)}`
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
      promptModel: body.promptModel || KIMI_MODEL,
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

        // Step 1: Synthesize prompts via Kimi
        const [promptA, promptB] = await synthesizePrompts(
          task.description,
          this.env.DASHSCOPE_API_KEY,
          task.promptModel
        );

        // Step 2: Generate icon 1 (with cooldown)
        await this.waitForCooldown();
        const iconUrl1 = await generateIcon(promptA, this.env.DASHSCOPE_API_KEY);
        this.lastDashscopeFinishedAt = Date.now();
        task.icons.push({ url: iconUrl1, index: 0 });
        this.sendToTask(task.taskId, "icon_ready", { url: iconUrl1, index: 0 });

        // Notify generating icon 2
        task.currentIconIndex = 1;
        this.sendToTask(task.taskId, "generating", { index: 1, total: 2 });

        // Step 3: Generate icon 2 (with cooldown)
        await this.waitForCooldown();
        const iconUrl2 = await generateIcon(promptB, this.env.DASHSCOPE_API_KEY);
        this.lastDashscopeFinishedAt = Date.now();
        task.icons.push({ url: iconUrl2, index: 1 });
        this.sendToTask(task.taskId, "icon_ready", { url: iconUrl2, index: 1 });

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
      }, 30000);
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
  const promptModel = KIMI_MODEL;

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
