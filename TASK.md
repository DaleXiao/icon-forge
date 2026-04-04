# TASK: 切换生图模型到 wan2.7-image-pro

## 背景

Icon Forge 当前使用 qwen-image-2.0-pro（同步 API）生图。经过四个模型对比测试，wan2.7-image-pro 在 icon 形状准确性、质感细节、macOS icon 风格三个维度都最优。需要切换生图模型。

## 核心变更

wan2.7-image-pro 使用**异步 API**（提交任务 → 轮询结果），跟当前 qwen-image-2.0-pro 的同步 API 不同。

### API 差异

**当前（qwen-image-2.0-pro 同步）：**
```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
→ 直接返回图片 URL
```

**目标（wan2.7-image-pro 异步）：**
```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation
Header: X-DashScope-Async: enable
→ 返回 { output: { task_id: "xxx" } }

GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
→ 轮询直到 task_status = "SUCCEEDED"
→ 结果在 output.choices[0].message.content[0].image
```

### 需要改的文件

**worker/src/index.ts** — 只改 `generateIcon` 函数：

1. 改 API endpoint 为 `https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation`
2. 改 model 为 `wan2.7-image-pro`
3. 请求 header 加 `X-DashScope-Async: enable`
4. 请求 body 结构改为 wan2.7 格式：
   ```json
   {
     "model": "wan2.7-image-pro",
     "input": {
       "messages": [{ "role": "user", "content": [{ "text": "prompt" }] }]
     },
     "parameters": {
       "size": "1024*1024",
       "n": 1,
       "watermark": false
     }
   }
   ```
   注意：wan2.7 不支持 `seed` 和 `prompt_extend` 参数，移除它们。
5. 提交后拿到 task_id，轮询 `https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`
6. 轮询间隔 2 秒，最多 30 次（60 秒超时）
7. 成功后从 `output.choices[0].message.content[0].image` 取图片 URL
8. 保留现有的 retry 逻辑（429 时指数退避），包裹在外层

### 不改的东西

- Kimi prompt 合成逻辑 — 不动
- DO 队列逻辑 — 不动
- SSE 推送逻辑 — 不动
- 前端 — 不动
- wrangler.toml — 不动
- 冷却逻辑 — 保留 Dashscope 冷却（wan2.7 的并发限制待确认，先保守保留）

### 常量更新

```typescript
const DASHSCOPE_MODEL = "wan2.7-image-pro";
const DASHSCOPE_SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation";
const DASHSCOPE_TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks";
```

## 部署

改完后执行：
```bash
cd worker && npx wrangler deploy
```

## 验证

- [ ] 单次生成正常出图
- [ ] 两张图渐进式出现
- [ ] 图片质量与测试结果一致（macOS icon squircle 形状）
