# Icon Forge — PRD (MVP)

## 一句话

输入一句描述，生成两张 macOS 风格轻拟物 App Icon。

## 目标用户

Vibe coders——有能力开发 app，但搞不定高质量 icon 设计的独立开发者。

## 核心价值

用户不需要懂设计、不需要写 prompt、不需要调参。输入"小鹿 学英语 app"，3 秒后拿到两张可直接用的轻拟物 icon。

**差异化：** 不是通用生图工具。是一个内置了专业 icon 设计审美的专用工具——prompt 模板是核心资产，用户感知到的是"出图质量比自己调 Midjourney 好"。

---

## 用户流程

```
1. 打开 icon.weweekly.online
2. 看到输入框 + 简短说明 + 几个示例
3. 输入描述（例："小鹿 学英语 app"）
4. 点击生成 → loading 状态（预计 10-15 秒）
5. 展示两张 icon 并排
6. 点击下载（单张 PNG，1024x1024）
7. 可以重新输入生成新的
```

**限制：**
- 每 IP 每天最多 3 次生成（6 张图）
- 超出后提示："内测中，每日限额已用完，请明天再来 🙂"
- 不需要登录/注册

---

## 功能范围

### MVP 包含

| 功能 | 说明 |
|------|------|
| 文本输入 | 单行输入框，支持中英文，最短 2 字最长 200 字 |
| Prompt 合成 | 后端将用户输入 + 预设模板合成完整 prompt |
| 图片生成 | 调用 Dashscope 图片生成 API，每次生成 2 张 |
| 结果展示 | 两张 icon 并排展示，带下载按钮 |
| IP 限流 | 每 IP 每天 3 次，基于 CF KV 存储计数 |
| 基础错误处理 | 网络错误、生成失败、输入为空等 |

### MVP 不包含

- 用户登录/注册
- 付费功能
- 图片编辑/变体/重新生成单张
- 历史记录
- 多风格选择
- SVG 输出
- SEO / 落地页

---

## 技术架构

```
┌─────────────────────────────┐
│  CF Pages (静态前端)         │
│  icon.weweekly.online        │
│  React / Vanilla + Tailwind  │
└──────────┬──────────────────┘
           │ POST /api/generate
           │ { description: "..." }
           ▼
┌─────────────────────────────┐
│  CF Worker (API 后端)        │
│  icon.weweekly.online/api/*  │
│                              │
│  1. 校验输入                 │
│  2. IP 限流检查 (CF KV)      │
│  3. 合成 prompt              │
│  4. 调 Dashscope API ×2      │
│  5. 返回图片 URL             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Dashscope Image Gen API     │
│  模型: qwen-image-2.0-pro   │
└─────────────────────────────┘
```

### 前端

- **框架：** 轻量 SPA（React 或纯 HTML + Tailwind，视开发效率定）
- **部署：** CF Pages，绑定 `icon.weweekly.online`
- **状态管理：** 无，单页面无路由

### 后端

- **运行时：** CF Worker
- **路由：** `POST /api/generate`
- **存储：** CF KV（IP 限流计数，key = `limit:{ip}:{date}`，TTL = 24h）
- **Secrets：** `DASHSCOPE_API_KEY`（CF Worker 环境变量）

### Prompt 合成逻辑

```
输入: 用户描述（如"小鹿 学英语 app"）

步骤:
1. 用 LLM（kimi-k2.5）将用户描述转化为：
   - 主体物描述（英文）
   - 主色调建议
   - 情绪词
2. 填入模板骨架:

A macOS app icon. A squircle shape with smooth continuous
rounded corners, centered on white canvas with padding —
occupying about 80% of the canvas. Flat front face, slight
edge thickness, soft drop shadow beneath.
The squircle itself IS {主体物详细描述}.
{视觉细节：颜色、布局、材质、元素}.
Charming toylike quality, crisp clean edges.
{对比色描述}. Simplified and {情绪词}.
```

**注意：** Prompt 模板是核心资产，仅存在于后端，不暴露给前端。

### 图片生成

- 每次请求生成 2 张（两次独立 API 调用，或利用 batch 参数）
- 输出：1024×1024 PNG
- 超时处理：单张 30 秒超时，失败则返回错误

---

## UI 设计

### 布局

```
┌──────────────────────────────────┐
│          Icon Forge 🔨           │
│   macOS-style app icons, fast.   │
│                                  │
│  ┌────────────────────────┐  ⚡  │
│  │ 描述你的 app...         │ 生成 │
│  └────────────────────────┘      │
│                                  │
│  示例：小鹿学英语 / 极简记账      │
│        旅行地图 / 播客电台        │
│                                  │
│  ┌───────────┐ ┌───────────┐    │
│  │           │ │           │    │
│  │  icon A   │ │  icon B   │    │
│  │           │ │           │    │
│  │  ⬇ 下载   │ │  ⬇ 下载   │    │
│  └───────────┘ └───────────┘    │
│                                  │
│  今日剩余 2/3 次                  │
│                                  │
│  © 2026 weweekly.online          │
└──────────────────────────────────┘
```

### 风格

- 深色主题（#0a0a0a 背景）
- 极简，无多余装饰
- 生成中：骨架屏或 shimmer 动画
- 移动端友好（响应式）

---

## API 接口

### POST /api/generate

**Request:**
```json
{
  "description": "小鹿 学英语 app"
}
```

**Response (200):**
```json
{
  "icons": [
    { "url": "https://...", "index": 0 },
    { "url": "https://...", "index": 1 }
  ],
  "remaining": 2
}
```

**Response (429):**
```json
{
  "error": "rate_limited",
  "message": "内测中，每日限额已用完，请明天再来 🙂"
}
```

**Response (400):**
```json
{
  "error": "invalid_input",
  "message": "请输入 app 描述（2-200 字）"
}
```

---

## 关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 生图质量不稳定 | 用户体验差 | 上线前用 20+ 案例验证 prompt 模板；预留调优空间 |
| Dashscope API 延迟/故障 | 用户等太久或失败 | 30s 超时 + 友好错误提示 + 重试 1 次 |
| IP 限流被绕过（VPN） | 成本失控 | MVP 阶段可接受；后续可加 fingerprint |
| Prompt 模板泄露 | 核心资产丢失 | 仅在 Worker 后端，不暴露到前端 |

---

## 里程碑

| 阶段 | 内容 | 预估 |
|------|------|------|
| M0 | Prompt 模板验证（手动跑 10+ 案例确认质量） | 1 小时 |
| M1 | 后端 Worker 开发（API + prompt 合成 + 限流） | 半天 |
| M2 | 前端开发（输入 + 展示 + 下载） | 半天 |
| M3 | 联调 + 部署到 CF + 域名绑定 | 2 小时 |
| M4 | 内测（自用 + 小范围分享收集反馈） | 持续 |

---

## 未来方向（不在 MVP 范围）

- 付费：10 次 / ¥1.99，免登录（IP 或设备指纹绑定）
- 多风格：线性、3D、像素风等
- SVG 输出（可能需要额外的矢量化步骤）
- 用户账号 + 历史记录
- API 开放给第三方
