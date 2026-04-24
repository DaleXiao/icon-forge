# icon-forge

AI macOS / iOS App Icon generator. Natural-language prompt → polished 1024×1024 PNG icon, ready for Xcode / Asset Catalog. OAuth-gated, daily free quota + Stripe credits.

**Live**: [icon.weweekly.online](https://icon.weweekly.online)

## Architecture

```
Frontend (React + Vite + Tailwind)        → Cloudflare Pages
          │
          ▼
Worker (Cloudflare Workers + Durable Object)
          │   ├─ Google OAuth (id_token → session cookie)
          │   ├─ queue + rate limit (KV)
          │   ├─ Stripe Checkout (credits top-up)
          │   ├─ prompt synthesis  → Qwen3.6-max-preview (Dashscope)
          │   └─ image generation  → Dashscope qwen-image-2.0-pro
          ▼
     Dashscope OSS → signed PNG URL → stream back via SSE
                                    → R2 (user history)
```

## Local Development

```bash
npm install
npm run dev                # vite on http://localhost:5173

cd worker
npm install
npx wrangler dev           # http://localhost:8787
```

## Deploy

### Prerequisites
- Cloudflare account with Workers + Pages + one zone (edit `wrangler.toml` routes)
- Dashscope API key with `qwen-image-2.0-pro` access
- Google OAuth client (web) — client ID + secret
- Stripe account (secret key + webhook secret) if you want payments; skip for demo

### Configure secrets
```bash
cd worker
npx wrangler secret put DASHSCOPE_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET         # random 32+ bytes
npx wrangler secret put STRIPE_SECRET_KEY       # optional
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # optional
```

### Create bindings
```bash
npx wrangler kv:namespace create RATE_LIMIT
# paste id into wrangler.toml
npx wrangler r2 bucket create icon-forge-history
# add [[r2_buckets]] binding in wrangler.toml if history persistence is wanted
```

### Deploy
```bash
cd worker && npx wrangler deploy
cd .. && npm run build && npx wrangler pages deploy dist --project-name icon-forge
```

## License

MIT — see [LICENSE](LICENSE).
