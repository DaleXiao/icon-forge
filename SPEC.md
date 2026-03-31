# Icon Forge — Product & Technical Spec

> AI macOS/App Icon Generator. 验证 OAuth → 免费限额 → Stripe 支付 → Credits 消耗 商业化 pipeline。

## 1. 产品定义

### 1.1 一句话

输入自然语言描述，AI 生成专业 App Icon。

### 1.2 用户流程

```
访问首页 → Google 登录 → 输入 "一个打字机风格的图标" → 等待 ~15s → 展示结果 → 下载 PNG
```

### 1.3 MVP 范围（做的）

- 单页应用，一个输入框，一个生成按钮
- Google OAuth 登录（必须登录才能用）
- 免费 3 次/天
- Stripe Checkout 购买 credits（$1.99 / 20 次）
- 生成结果展示 + 一键下载 1024×1024 PNG
- 生成历史（最近 10 张，KV 存 metadata，R2 存图片）

### 1.4 MVP 范围（不做的）

- 多尺寸导出（512/256/128...）
- Prompt 编辑/微调/变体
- 用户 dashboard / 账单页
- 团队/协作
- 移动端适配（desktop-first）

---

## 2. 架构

### 2.1 技术栈

| 层 | 选择 | 理由 |
|----|------|------|
| 前端 | 静态 HTML + Tailwind + vanilla JS | 单页，不需要框架 |
| 后端 | Cloudflare Workers | 已有基础设施，零冷启动 |
| 存储 | Cloudflare KV | 用户数据、credits、session、限流 |
| 图片存储 | Cloudflare R2 | 生成的图片，公开读 |
| 认证 | Google OAuth 2.0 | 零密码，用户摩擦最低 |
| 支付 | Stripe Checkout (hosted) | 不碰卡信息，合规最简 |
| Prompt 改写 | Dashscope kimi-k2.5 | 成本低，中文理解好 |
| 图片生成 | Dashscope qwen-image-2.0-pro | 扁平 icon 表现好，成本 ~¥0.14/张 |

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────────┐
│                    Browser (SPA)                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Google   │  │ Generate │  │ Stripe Checkout   │  │
│  │ Sign In  │  │ Button   │  │ (hosted redirect) │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
└───────┼──────────────┼─────────────────┼─────────────┘
        │              │                 │
        ▼              ▼                 ▼
┌─────────────────────────────────────────────────────┐
│              Cloudflare Worker (API)                  │
│                                                       │
│  /api/auth/google     → Google OAuth callback         │
│  /api/auth/me         → 返回当前用户 + credits        │
│  /api/auth/logout     → 清除 session                  │
│  /api/generate        → prompt 改写 + 图片生成        │
│  /api/checkout        → 创建 Stripe Checkout Session  │
│  /api/webhook/stripe  → Stripe 支付回调               │
│  /api/history         → 最近生成记录                   │
│  /*                   → 静态前端文件                   │
│                                                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │   KV    │  │   R2    │  │ Secrets │              │
│  │ users   │  │ images  │  │ API keys│              │
│  │ sessions│  │         │  │         │              │
│  │ credits │  │         │  │         │              │
│  └─────────┘  └─────────┘  └─────────┘              │
└─────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│  Dashscope    │           │    Stripe     │
│  - kimi-k2.5  │           │  - Checkout   │
│  - qwen-image │           │  - Webhooks   │
└───────────────┘           └───────────────┘
```

---

## 3. API 设计

### 3.1 认证

#### `GET /api/auth/google`
跳转 Google OAuth 授权页。

#### `GET /api/auth/google/callback`
Google 回调。验证 code → 换 token → 解析 id_token → 创建/查找用户 → 设置 session cookie → 重定向首页。

**Session 机制**：
- 生成随机 session_id，存入 KV `session:{id}` → `{ userId, email, expiresAt }`
- 设置 HttpOnly Secure SameSite=Lax cookie：`session={id}`
- TTL: 7 天

#### `GET /api/auth/me`
返回当前用户信息。

```json
{
  "user": {
    "id": "google:1234567890",
    "email": "user@gmail.com",
    "name": "User Name",
    "avatar": "https://..."
  },
  "credits": {
    "free_remaining": 2,
    "paid_remaining": 15
  }
}
```

#### `POST /api/auth/logout`
删除 session KV，清除 cookie。

### 3.2 生成

#### `POST /api/generate`

**Request:**
```json
{
  "prompt": "一个打字机风格的深色图标"
}
```

**流程：**
1. 验证 session → 获取 userId
2. 检查 credits：先扣免费额度，免费用完扣付费额度
3. 额度不足 → 返回 402
4. 调用 kimi-k2.5 改写 prompt → 专业 icon prompt
5. 调用 qwen-image-2.0-pro 生成 1024×1024
6. 上传图片到 R2 `images/{userId}/{timestamp}.png`
7. 写入生成记录到 KV
8. 返回结果

**Response (200):**
```json
{
  "id": "gen_abc123",
  "image_url": "https://r2.icon-forge.com/images/google:123/1711512345.png",
  "prompt_original": "一个打字机风格的深色图标",
  "prompt_rewritten": "A macOS app icon. A squircle shape...",
  "credits_remaining": {
    "free": 1,
    "paid": 15
  }
}
```

**Error (402):**
```json
{
  "error": "no_credits",
  "message": "Daily free limit reached. Purchase credits to continue.",
  "checkout_url": "/api/checkout"
}
```

### 3.3 支付

#### `POST /api/checkout`
创建 Stripe Checkout Session，返回跳转 URL。

```json
{
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

**Stripe Checkout Session 参数：**
- `mode`: "payment"（一次性）
- `line_items`: 1x "20 Icon Credits" $1.99
- `metadata`: `{ userId }`
- `success_url`: `https://icon-forge.com/?payment=success`
- `cancel_url`: `https://icon-forge.com/?payment=cancel`

#### `POST /api/webhook/stripe`
Stripe webhook，验证签名。

事件 `checkout.session.completed` → 读取 metadata.userId → KV 增加 20 paid credits。

### 3.4 历史

#### `GET /api/history`
返回当前用户最近 10 条生成记录。

```json
{
  "items": [
    {
      "id": "gen_abc123",
      "image_url": "https://...",
      "prompt": "一个打字机风格的深色图标",
      "created_at": "2026-03-27T08:00:00Z"
    }
  ]
}
```

---

## 4. 数据模型（KV）

### 4.1 Key 设计

| Key Pattern | Value | TTL |
|-------------|-------|-----|
| `user:{userId}` | `{ email, name, avatar, paidCredits, createdAt }` | 永久 |
| `session:{sessionId}` | `{ userId, email, expiresAt }` | 7 天 |
| `daily:{userId}:{YYYY-MM-DD}` | `{ count: N }` | 48 小时 |
| `history:{userId}` | `[{ id, imageKey, prompt, createdAt }, ...]`（最多 10 条） | 永久 |
| `gen:{genId}` | `{ userId, imageKey, promptOriginal, promptRewritten, createdAt }` | 30 天 |

### 4.2 Credits 逻辑

```
免费额度: 3/天（UTC 日期）
  → 检查 daily:{userId}:{today} 的 count
  → count < 3 → 可用，count++
  → count >= 3 → 检查 paidCredits

付费额度: user:{userId}.paidCredits
  → paidCredits > 0 → 可用，paidCredits--
  → paidCredits == 0 → 402
```

**原子性**：KV 没有原子 increment，但单用户并发极低（人工点击），race condition 风险可忽略。如果后续量大，迁移到 D1（SQLite）。

---

## 5. Prompt 改写

### 5.1 System Prompt（kimi-k2.5）

```
You are an expert app icon designer. The user will describe an icon idea in natural language (any language). Your job is to rewrite it into a detailed, high-quality image generation prompt optimized for creating a macOS/iOS app icon.

Rules:
1. Output ONLY the rewritten English prompt, nothing else
2. Always include: "A macOS app icon. A squircle shape with smooth continuous rounded corners, centered on white canvas with padding — occupying about 80% of the canvas."
3. Specify: flat/3D style, color palette, key visual elements, lighting, mood
4. Keep it under 200 words
5. Emphasize: crisp clean edges, toylike quality, simplified shapes
6. The icon should work at small sizes — avoid tiny details
```

### 5.2 图片生成参数

```json
{
  "model": "qwen-image-2.0-pro",
  "prompt": "<rewritten prompt>",
  "size": "1024*1024",
  "n": 1
}
```

---

## 6. 安全

| 威胁 | 防护 |
|------|------|
| CSRF | SameSite=Lax cookie + Origin 检查 |
| Session 劫持 | HttpOnly + Secure + 随机 256-bit session ID |
| Stripe webhook 伪造 | 验证 Stripe-Signature header（HMAC） |
| API 滥用 | 必须登录 + credits 限制 + CF WAF rate limiting |
| Prompt 注入 | kimi-k2.5 system prompt 约束输出格式，不执行指令 |
| R2 访问控制 | 图片 URL 含 userId + timestamp，不可枚举 |

---

## 7. 成本估算

### 7.1 单次生成成本

| 项 | 单价 | 估算 |
|----|------|------|
| kimi-k2.5 prompt 改写 | ~¥0.01 | ~$0.001 |
| qwen-image-2.0-pro 生成 | ~¥0.14 | ~$0.019 |
| R2 存储（1MB/张）| $0.015/GB/月 | ~$0.000015 |
| **合计** | | **~$0.02/次** |

### 7.2 单位经济

| 场景 | 收入 | 成本 | 毛利 |
|------|------|------|------|
| 免费用户（3次/天）| $0 | $0.06 | -$0.06 |
| 付费用户（$1.99/20次）| $1.99 | $0.40 | $1.59 (80%) |

Stripe 手续费 2.9% + $0.30 → $1.99 实收 ~$1.63 → 净利 ~$1.23/单。

---

## 8. 域名 & 部署

| 项 | 值 |
|----|-----|
| 域名 | 待定（建议：iconforge.app / icon-forge.com / forgeicon.com） |
| CF Worker 名 | `icon-forge` |
| KV Namespace | `icon-forge-kv` |
| R2 Bucket | `icon-forge-images` |
| Google OAuth | 需新建 OAuth Client（redirect URI 指向 worker） |
| Stripe | 使用现有账号，创建新 Product + Price |

---

## 9. 文件结构

```
icon-forge/
├── wrangler.toml              # CF Worker 配置
├── package.json
├── src/
│   ├── index.ts               # Worker 入口，路由分发
│   ├── auth/
│   │   ├── google.ts          # Google OAuth 流程
│   │   ├── session.ts         # Session 管理
│   │   └── middleware.ts      # 认证中间件
│   ├── api/
│   │   ├── generate.ts        # 生成逻辑（改写 + 生图 + 存储）
│   │   ├── checkout.ts        # Stripe Checkout 创建
│   │   ├── webhook.ts         # Stripe Webhook 处理
│   │   └── history.ts         # 历史记录
│   ├── lib/
│   │   ├── dashscope.ts       # Dashscope API 封装（LLM + ImageGen）
│   │   ├── stripe.ts          # Stripe API 封装
│   │   ├── credits.ts         # Credits 检查/扣减逻辑
│   │   └── kv-schema.ts       # KV key 生成 + 类型定义
│   └── types.ts               # 全局类型
├── public/
│   ├── index.html             # 单页前端
│   ├── style.css              # Tailwind 产物
│   └── app.js                 # 前端逻辑
└── SPEC.md                    # 本文件
```

---

## 10. 待确认项

- [ ] 域名选择
- [ ] Google Cloud OAuth Client ID / Secret
- [ ] Stripe Product & Price ID
- [ ] R2 自定义域名（用于图片公开访问）
- [ ] 是否需要 Cloudflare Turnstile（额外防刷层）
