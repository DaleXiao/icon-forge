import { useState, useEffect, useCallback, useRef } from 'react'

// --- Types ---

interface IconResult {
  url: string
  index: number
}

interface QuotaResponse {
  remaining: number
  total: number
}

interface ErrorResponse {
  error: string
  message: string
}

interface EnqueueResponse {
  taskId: string
  position: number
}

type GenerationPhase = 'idle' | 'queued' | 'generating' | 'complete' | 'error'

// --- Constants ---

const EXAMPLE_PROMPTS = ['记事本', '语音输入法', '旅行地图', '播客电台']
const API_BASE = import.meta.env.PROD ? 'https://api-icon.weweekly.online/api' : '/api'
const _params = new URLSearchParams(window.location.search)
const TEST_PARAM = _params.has('test') ? '?test' : ''

// Cloudflare Turnstile site key (public, safe to ship in bundle).
const TURNSTILE_SITE_KEY = '0x4AAAAAADCaJjLh7I5xepTX'

function getTurnstileToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    // @ts-expect-error — turnstile is loaded via index.html <script>
    const ts = window.turnstile
    if (!ts) {
      reject(new Error('turnstile not loaded'))
      return
    }
    // Invisible widget needs a rendered (non-display:none) container.
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText =
      'position:fixed;bottom:0;right:0;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0;'
    document.body.appendChild(host)
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      try { document.body.removeChild(host) } catch {}
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('turnstile timeout (10s)'))), 10_000)
    try {
      ts.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'invisible',
        callback: (token: string) => { clearTimeout(timer); done(() => resolve(token)) },
        'error-callback': () => { clearTimeout(timer); done(() => reject(new Error('turnstile error'))) },
        'timeout-callback': () => { clearTimeout(timer); done(() => reject(new Error('turnstile timeout'))) },
      })
    } catch (e) {
      clearTimeout(timer)
      done(() => reject(e as Error))
    }
  })
}

// --- Theme helpers ---

type Theme = 'light' | 'dark'

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('icon-forge-theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // localStorage not available
  }
  return 'light'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  try {
    localStorage.setItem('icon-forge-theme', theme)
  } catch {
    // localStorage not available
  }
}

// Apply initial theme immediately to avoid flash
applyTheme(getStoredTheme())

// --- Theme Toggle Component ---

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="theme-toggle fixed top-5 right-5 z-50 w-10 h-10 rounded-full flex items-center justify-center bg-white/80 dark:bg-warm-850/80 border border-warm-200 dark:border-warm-700/40 shadow-warm-sm dark:shadow-warm-md backdrop-blur-sm focus-warm"
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {theme === 'dark' ? (
        // Sun icon — shown in dark mode, click to go light
        <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1.5M12 19.5V21M4.219 4.219l1.061 1.061M17.72 17.72l1.06 1.06M3 12h1.5M19.5 12H21M4.219 19.781l1.061-1.061M17.72 6.28l1.06-1.06" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        // Moon icon — shown in light mode, click to go dark
        <svg className="w-5 h-5 text-warm-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
    </button>
  )
}

// --- App Component ---

export default function App() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [icons, setIcons] = useState<IconResult[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [total] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState(false)
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const [phase, setPhase] = useState<GenerationPhase>('idle')
  const [queuePosition, setQueuePosition] = useState(0)
  const [retryCountdown, setRetryCountdown] = useState(0)
  const [progress, setProgress] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef(0)
  const sseRetriesRef = useRef(0)
  const currentTaskIdRef = useRef<string | null>(null)

  // Fetch initial quota
  useEffect(() => {
    fetchQuota()
  }, [])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  async function fetchQuota() {
    try {
      const res = await fetch(`${API_BASE}/quota${TEST_PARAM}`)
      if (res.ok) {
        const data: QuotaResponse = await res.json()
        setRemaining(data.remaining)
        if (data.remaining <= 0) {
          setRateLimited(true)
        }
      }
    } catch {
      // silently fail on quota check
    }
  }

  // Cleanup SSE and timers
  function cleanup() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }

  function startProgressAnimation(fromPct: number, toPct: number) {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressRef.current = fromPct
    setProgress(Math.round(fromPct))
    // Asymptotic curve: fast at start, slows down but never stops
    progressTimerRef.current = setInterval(() => {
      const remaining = toPct - progressRef.current
      // Move 3% of remaining distance each tick, minimum 0.1
      const step = Math.max(remaining * 0.03, 0.1)
      progressRef.current = Math.min(progressRef.current + step, toPct - 0.5)
      setProgress(Math.round(progressRef.current))
    }, 250)
  }

  // Cleanup on unmount
  useEffect(() => cleanup, [])

  // Reconnect SSE when page becomes visible again (mobile Safari lock/unlock)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && currentTaskIdRef.current) {
        // Close stale connection if any, then reconnect
        if (eventSourceRef.current) {
          eventSourceRef.current.onerror = null
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
        sseRetriesRef.current = 0
        startSSE(currentTaskIdRef.current)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  function startSSE(taskId: string) {
    cleanup()
    currentTaskIdRef.current = taskId
    const url = `${API_BASE}/generate/stream?taskId=${encodeURIComponent(taskId)}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.addEventListener('queued', (e) => {
      const data = JSON.parse(e.data)
      setPhase('queued')
      setQueuePosition(data.position)
    })

    es.addEventListener('generating', () => {
      setPhase('generating')
      // On reconnect, resume from current progress instead of resetting to 0
      const resumeFrom = Math.max(progressRef.current, 0)
      startProgressAnimation(resumeFrom, 95)
    })

    es.addEventListener('icon_ready', (e) => {
      const data = JSON.parse(e.data)
      setIcons((prev) => {
        if (prev.some((i) => i.index === data.index)) return prev
        const updated = [...prev, { url: data.url, index: data.index }].sort((a, b) => a.index - b.index)
        if (updated.length === 1 && progressRef.current < 50) {
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          progressRef.current = 50
          setProgress(50)
          startProgressAnimation(50, 95)
        }
        // When all 2 icons arrive, snap to 100%
        if (updated.length >= 2) {
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          progressRef.current = 100
          setProgress(100)
        }
        return updated
      })
    })

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      // Snap to 100% first, then fade out
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      progressRef.current = 100
      setProgress(100)
      setRemaining(data.remaining)
      if (data.remaining <= 0) setRateLimited(true)
      // Close SSE before onerror can fire
      es.onerror = null
      es.close()
      eventSourceRef.current = null
      currentTaskIdRef.current = null
      // Delay phase transition so user sees 100%
      setTimeout(() => {
        setPhase('complete')
        setLoading(false)
      }, 800)
    })

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setError(data.message || '生成失败，请重试')
      } catch {
        setError('连接中断，请重试')
      }
      setPhase('error')
      setLoading(false)
      es.onerror = null
      es.close()
      eventSourceRef.current = null
      currentTaskIdRef.current = null
    })

    es.onerror = () => {
      // Only fire if EventSource is still our active one
      if (eventSourceRef.current !== es) return
      es.close()
      eventSourceRef.current = null
      // Auto-reconnect up to 3 times (handles mobile Safari background disconnect)
      if (sseRetriesRef.current < 3 && currentTaskIdRef.current) {
        sseRetriesRef.current++
        setTimeout(() => {
          if (currentTaskIdRef.current) {
            startSSE(currentTaskIdRef.current)
          }
        }, 1000)
      } else {
        setPhase((prev) => {
          if (prev === 'complete' || prev === 'error') return prev
          setError('连接中断，请重试')
          setLoading(false)
          return 'error'
        })
      }
    }
  }

  function startRetryCountdown(seconds: number) {
    setRetryCountdown(seconds)
    if (retryTimerRef.current) clearInterval(retryTimerRef.current)
    retryTimerRef.current = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          if (retryTimerRef.current) clearInterval(retryTimerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleGenerate = useCallback(async () => {
    const trimmed = description.trim()
    if (!trimmed || trimmed.length < 2) {
      setError('请输入至少 2 个字的描述')
      return
    }
    if (trimmed.length > 200) {
      setError('描述不能超过 200 字')
      return
    }

    setLoading(true)
    setError(null)
    setIcons([])
    setRateLimited(false)
    setPhase('queued')
    setQueuePosition(0)
    setRetryCountdown(0)
    setProgress(0)
    progressRef.current = 0
    sseRetriesRef.current = 0
    currentTaskIdRef.current = null
    cleanup()

    try {
      let turnstileToken = ''
      try {
        turnstileToken = await getTurnstileToken()
      } catch (e) {
        console.warn('turnstile unavailable, calling without token:', e)
      }

      const res = await fetch(`${API_BASE}/generate${TEST_PARAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed, turnstileToken }),
      })

      if (res.status === 429) {
        const data: ErrorResponse = await res.json()
        setRateLimited(true)
        setRemaining(0)
        setError(data.message)
        setPhase('error')
        setLoading(false)
        return
      }

      if (res.status === 503) {
        const data = await res.json()
        setError(data.message || '当前使用人数较多，请 30 秒后再试')
        setPhase('error')
        setLoading(false)
        startRetryCountdown(data.retryAfter || 30)
        return
      }

      if (res.status === 400) {
        const data: ErrorResponse = await res.json()
        setError(data.message)
        setPhase('error')
        setLoading(false)
        return
      }

      if (!res.ok) {
        const data: ErrorResponse = await res.json()
        setError(data.message || '生成失败，请重试')
        setPhase('error')
        setLoading(false)
        return
      }

      // 202 — task enqueued, start SSE
      const data: EnqueueResponse = await res.json()
      setQueuePosition(data.position)
      startSSE(data.taskId)
    } catch {
      setError('网络错误，请检查连接后重试')
      setPhase('error')
      setLoading(false)
    }
  }, [description])

  function handleExampleClick(prompt: string) {
    setDescription(prompt)
    setError(null)
  }

  async function handleDownload(url: string, index: number) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `icon-forge-${index + 1}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      // Fallback: open in new tab
      window.open(url, '_blank')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !loading && !rateLimited) {
      e.preventDefault()
      handleGenerate()
    }
  }

  const canGenerate = description.trim().length >= 2 && !loading && !rateLimited

  return (
    <div className="min-h-screen flex flex-col items-center px-5 py-16 sm:py-24 bg-[#FAFAF7] dark:bg-warm-950">
      {/* Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      {/* Header */}
      <header className="text-center mb-12 sm:mb-16 animate-fade-in">
        <div className="inline-flex items-center gap-3 mb-4">
          <img src="/favicon.png" alt="Icon Forge" className="w-10 h-10 rounded-lg" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-warm-800 dark:text-warm-100 tracking-tight leading-tight">
          Icon Forge
        </h1>
        <p className="mt-2.5 text-warm-500 dark:text-warm-400 text-base sm:text-lg font-light tracking-wide">
          描述你的 App，生成精美图标
        </p>
      </header>

      {/* Input Section */}
      <div className="w-full max-w-lg animate-slide-up">
        {/* Input row */}
        <div className="relative flex gap-2.5">
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setError(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder="描述你的 app..."
            maxLength={200}
            disabled={loading}
            rows={1}
            className="flex-1 bg-white dark:bg-warm-900/80 border border-warm-200 dark:border-warm-700/40 rounded-2xl px-5 py-3.5 text-warm-800 dark:text-warm-100 placeholder-warm-400 dark:placeholder-warm-500 text-base font-light tracking-wide focus-warm focus:border-accent-500/30 transition-colors disabled:opacity-50 resize-none overflow-hidden shadow-warm-sm dark:shadow-none"
            style={{ minHeight: '52px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = '52px'
              target.style.height = target.scrollHeight + 'px'
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`
              px-5 py-3.5 rounded-2xl font-medium text-base transition-all whitespace-nowrap
              ${loading
                ? 'bg-accent-600/40 text-accent-200 cursor-wait warm-pulse'
                : rateLimited
                  ? 'bg-warm-100 dark:bg-warm-800/60 text-warm-400 dark:text-warm-600 cursor-not-allowed'
                  : canGenerate
                    ? 'bg-accent-600 text-white hover:bg-accent-500 active:scale-[0.97] shadow-warm-md hover:shadow-warm-glow'
                    : 'bg-warm-100 dark:bg-warm-800/60 text-warm-400 dark:text-warm-600 cursor-not-allowed'
              }
            `}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner />
                <span>生成中</span>
              </span>
            ) : (
              <span>生成</span>
            )}
          </button>
        </div>

        {/* Example prompts */}
        <div className="mt-5 flex flex-wrap gap-2 justify-center stagger">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleExampleClick(prompt)}
              disabled={loading}
              className="example-pill text-sm text-warm-500 px-3 py-1.5 rounded-full border border-warm-200 dark:border-warm-800/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-5 text-center animate-fade-in">
            <p className="text-coral-400 text-sm font-light">{error}</p>
          </div>
        )}
      </div>

      {/* Generation progress + progressive results */}
      {loading && (
        <div className="mt-12 sm:mt-16 w-full max-w-lg animate-fade-in">
          {/* Status text */}
          <p className="text-center text-warm-500 dark:text-warm-600 text-sm font-light mb-5 tracking-wide">
            {phase === 'queued' && queuePosition > 1
              ? `排队中，前面 ${queuePosition - 1} 人...`
              : phase === 'queued'
                ? '准备中...'
                : phase === 'generating'
                  ? <><svg className="inline-block w-3.5 h-3.5 mr-1.5 -mt-px animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>正在锻造 <span className="text-warm-700 dark:text-warm-400 font-medium tabular-nums">{progress}%</span></>
                  : '生成中...'}
          </p>
          {/* Grid: show arrived icons + shimmer for pending */}
          <div className="grid grid-cols-2 gap-5 sm:gap-6">
            {icons.length > 0 ? (
              <IconCard icon={icons[0]} onDownload={handleDownload} />
            ) : (
              <ShimmerCard />
            )}
            {icons.length > 1 ? (
              <IconCard icon={icons[1]} onDownload={handleDownload} />
            ) : (
              <ShimmerCard />
            )}
          </div>
          {/* Don't refresh hint */}
          <p className="text-center text-warm-400 dark:text-warm-700 text-xs font-light mt-4 tracking-wide">
            请不要关闭或刷新页面
          </p>
        </div>
      )}

      {/* Completed results */}
      {!loading && icons.length > 0 && (
        <div className="mt-12 sm:mt-16 w-full max-w-lg animate-slide-up">
          <div className="grid grid-cols-2 gap-5 sm:gap-6 stagger">
            {icons.map((icon) => (
              <IconCard
                key={icon.index}
                icon={icon}
                onDownload={handleDownload}
              />
            ))}
          </div>
        </div>
      )}

      {/* Retry countdown */}
      {retryCountdown > 0 && !loading && (
        <div className="mt-5 text-center animate-fade-in">
          <p className="text-warm-500 dark:text-warm-600 text-sm font-light">
            <span className="text-warm-700 dark:text-warm-400 font-medium tabular-nums">{retryCountdown}</span> 秒后可重试
          </p>
        </div>
      )}

      {/* Quota display */}
      {remaining !== null && (
        <div className="mt-10 text-center animate-fade-in">
          {rateLimited ? (
            <p className="text-warm-500 dark:text-warm-600 text-sm font-light">
              内测中，每日限额已用完，请明天再来
            </p>
          ) : (
            <p className="text-warm-500 dark:text-warm-600 text-sm font-light tracking-wide">
              今日剩余{' '}
              <span className="text-warm-700 dark:text-warm-400 font-medium tabular-nums">
                {remaining}/{total}
              </span>{' '}
              次
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto pt-20 pb-8">
        <a href="https://weweekly.online" target="_blank" rel="noopener" className="text-warm-400 dark:text-warm-700 text-xs font-light tracking-wider hover:text-warm-500 dark:hover:text-warm-500 transition-colors" style={{textDecoration:'none'}}>
          Tinker Lab / 折腾实验室
        </a>
      </footer>
    </div>
  )
}

// --- Sub-components ---

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function ShimmerCard() {
  return (
    <div className="rounded-2.5xl overflow-hidden bg-white dark:bg-warm-900/60 border border-warm-200 dark:border-warm-800/30 shadow-warm-sm dark:shadow-card">
      <div className="aspect-square shimmer" />
      <div className="p-4">
        <div className="h-9 rounded-xl shimmer" />
      </div>
    </div>
  )
}

function IconCard({
  icon,
  onDownload,
}: {
  icon: IconResult
  onDownload: (url: string, index: number) => void
}) {
  return (
    <div className="icon-card rounded-2.5xl overflow-hidden bg-white dark:bg-warm-900/60 border border-warm-200 dark:border-warm-800/30 shadow-warm-sm dark:shadow-card animate-slide-up">
      {/* Icon display area — matches page bg in light, dark in dark mode */}
      <div className="aspect-square checkerboard p-5">
        <img
          src={icon.url}
          alt={`Generated icon ${icon.index + 1}`}
          className="w-full h-full object-contain rounded-2xl"
          loading="lazy"
        />
      </div>
      {/* Download — subtle, discoverable */}
      <div className="px-4 py-3">
        <button
          onClick={() => onDownload(icon.url, icon.index)}
          className="w-full py-2.5 rounded-xl bg-warm-50 dark:bg-warm-850 hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-600 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300 text-sm font-medium transition-colors flex items-center justify-center gap-2 focus-warm"
        >
          <DownloadIcon />
          <span>下载 PNG</span>
        </button>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}
