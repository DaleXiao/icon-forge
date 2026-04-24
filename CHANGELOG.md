# Changelog

All notable changes to `icon-forge` are recorded here. Dates are GMT+8.

## 2026-04-24

- Open-source release: MIT license, README, CHANGELOG. Removed `skills/` symlinks and workspace-local `SPEC.md` / `PRD.md` / `TASK.md` / `ICON-FORGE-DESIGN.md` from git history.

## v2.x — 2026-04 (icon model + UX revamp)

- Switched image model to **qwen-image-2.0-pro** (async multimodal-generation API) for higher fidelity on macOS-icon idioms.
- Generate **2 icons concurrently** via `Promise.all` (was sequential).
- Optional **remove-background** pass, checkerboard preview UI.
- Updated example prompts.
- Reverted a short-lived 4-image experiment back to 2 after quality/latency trade-off.

## v1.x — 2026-03 through 2026-04

- **Durable Object queue + SSE streaming** progress pipeline.
- **Google OAuth** login gate + session cookie.
- **Stripe Checkout** credits top-up ($1.99 / 20 generations).
- Deferred billing (only charge on success), KV-based queue with stale-lock cleanup.
- **Rate limiting** + 429 retry with backoff; distinguishes throttle from real errors.
- Prompt synthesis via **Kimi (k2.5)** with code-fence cleanup + Qwen3.6-plus fallback.
- UI polish: textarea auto-resize, Enter-to-send, Shift+Enter newline; light/dark theme toggle; warm amber palette, Outfit font.
- `?test` mode to bypass rate limits during testing.
- Bind `api-icon.weweekly.online` for same-origin calls.

## v1.0 — 2026-03 (MVP)

- Initial build: React + Vite + Tailwind frontend, Cloudflare Worker backend, Dashscope image generation, Google OAuth, Stripe billing, KV rate limit, R2 history. Single 1024×1024 PNG output with one-click download.
