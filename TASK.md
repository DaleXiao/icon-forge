# TASK: 429 限流优化 — Durable Object 队列 + SSE 渐进式交付

## 背景

Icon Forge 使用 Dashscope qwen-image-2.0-pro 生图，该模型 **并发限制为 1**（同一 API Key 同时只能有一个请求）。当前用 KV 锁做互斥，但 KV get→put 非原子，有竞态。需要改为 Durable Object 队列 + SSE 推送，实现无感排队。

## 目标

1. 用户提交后立即返回 task_id，前端通过 SSE 接收进度
2. 两张图串行生成，生完一张立即推送一张（渐进式交付）
3. 队列上限 3 个任务，超过返回 503 + "请 30 秒后重试"
4. 前端展示排队位置 + 锻造动画 + 渐进式渲染

## 技术方案

### Worker (后端)

1. **新增 Durable Object `GenerationQueue`**
   - 单实例，管理所有生图任务的 FIFO 队列
   - 内部维护 `queue: Task[]`，按顺序串行调 Dashscope
   - 每张图生成完毕后通过 SSE 推送给对应的客户端

2. **API 变更**
   - `POST /api/generate` → 返回 `{ taskId: string, position: number }` (202)
   - `GET /api/generate/stream?taskId=xxx` → SSE 连接，推送事件：
     - `queued` — `{ position: number }`（排队位置更新）
     - `generating` — `{ index: 0|1, total: 2 }`（开始生成第 N 张）
     - `icon_ready` — `{ url: string, index: 0|1 }`（一张图完成）
     - `complete` — `{ icons: [...], remaining: number }`（全部完成）
     - `error` — `{ message: string }`

3. **队列策略**
   - 最大队列长度：3
   - 超过 3 个返回 `503 { error: "queue_full", message: "当前使用人数较多，请 30 秒后再试", retryAfter: 30 }`
   - 任务超时：单个任务最长 120 秒（含重试），超时自动移除

4. **保留**
   - IP 限流逻辑（DAILY_LIMIT = 3）保持不变，仍用 KV
   - Kimi prompt 合成逻辑不变
   - Dashscope 调用逻辑不变（含 retry）

5. **删除**
   - KV 锁相关代码（acquireGenerationLock / releaseGenerationLock）

### wrangler.toml 变更

```toml
# 新增 Durable Object 绑定
[durable_objects]
bindings = [
  { name = "GENERATION_QUEUE", class_name = "GenerationQueue" }
]

[[migrations]]
tag = "v1"
new_classes = ["GenerationQueue"]
```

### 前端 (App.tsx)

1. 提交后进入"锻造中"状态
2. 建立 SSE 连接监听进度
3. 显示排队位置（如果不是第一个）
4. 第一张图到达后立即渲染
5. 第二张图到达后并排展示
6. 503 时显示友好提示 + 30 秒倒计时

### 不改的东西

- `/api/quota` 接口不变
- CORS 处理不变
- test mode 逻辑保留
- 前端整体样式和布局不变（只改生成流程和等待状态）

## 约束

- Cloudflare Workers 免费版支持 DO
- 不能新增 API Key
- 不能提升 Dashscope 并发限额
- 保持向后兼容：如果 SSE 连接断开，前端应能用 taskId 重新连接

## 验证

- [ ] 单用户生成：两张图渐进式出现
- [ ] 并发 2 用户：第二个看到排队位置，正常等到结果
- [ ] 并发 4+ 用户：第四个收到 503 + 30 秒重试提示
- [ ] SSE 断线重连：能恢复到当前进度
- [ ] Rate limit 仍然生效（每 IP 每天 3 次）
