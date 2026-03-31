import { useState, useEffect, useCallback } from 'react'

// --- Types ---

interface IconResult {
  url: string
  index: number
}

interface GenerateResponse {
  icons: IconResult[]
  remaining: number
}

interface QuotaResponse {
  remaining: number
  total: number
}

interface ErrorResponse {
  error: string
  message: string
}

// --- Constants ---

const EXAMPLE_PROMPTS = ['小鹿学英语', '极简记账', '旅行地图', '播客电台']
const API_BASE = import.meta.env.PROD ? 'https://api-icon.weweekly.online/api' : '/api'

// --- App Component ---

export default function App() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [icons, setIcons] = useState<IconResult[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [total] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState(false)

  // Fetch initial quota
  useEffect(() => {
    fetchQuota()
  }, [])

  async function fetchQuota() {
    try {
      const res = await fetch(`${API_BASE}/quota`)
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

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      })

      if (res.status === 429) {
        const data: ErrorResponse = await res.json()
        setRateLimited(true)
        setRemaining(0)
        setError(data.message)
        return
      }

      if (res.status === 400) {
        const data: ErrorResponse = await res.json()
        setError(data.message)
        return
      }

      if (!res.ok) {
        const data: ErrorResponse = await res.json()
        setError(data.message || '生成失败，请重试')
        return
      }

      const data: GenerateResponse = await res.json()
      setIcons(data.icons)
      setRemaining(data.remaining)

      if (data.remaining <= 0) {
        setRateLimited(true)
      }
    } catch {
      setError('网络错误，请检查连接后重试')
    } finally {
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !loading && !rateLimited) {
      handleGenerate()
    }
  }

  const canGenerate = description.trim().length >= 2 && !loading && !rateLimited

  return (
    <div className="min-h-screen flex flex-col items-center px-5 py-16 sm:py-24">
      {/* Header */}
      <header className="text-center mb-12 sm:mb-16 animate-fade-in">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="text-2xl" role="img" aria-label="forge">
            🔨
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-warm-100 tracking-tight leading-tight">
          Icon Forge
        </h1>
        <p className="mt-2.5 text-warm-400 text-base sm:text-lg font-light tracking-wide">
          描述你的 App，生成精美图标
        </p>
      </header>

      {/* Input Section */}
      <div className="w-full max-w-lg animate-slide-up">
        {/* Input row */}
        <div className="relative flex gap-2.5">
          <input
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setError(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder="描述你的 app..."
            maxLength={200}
            disabled={loading}
            className="flex-1 bg-warm-900/80 border border-warm-700/40 rounded-2xl px-5 py-3.5 text-warm-100 placeholder-warm-500 text-base font-light tracking-wide focus-warm focus:border-accent-500/30 transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`
              px-5 py-3.5 rounded-2xl font-medium text-base transition-all whitespace-nowrap
              ${loading
                ? 'bg-accent-600/40 text-accent-200 cursor-wait warm-pulse'
                : rateLimited
                  ? 'bg-warm-800/60 text-warm-600 cursor-not-allowed'
                  : canGenerate
                    ? 'bg-accent-600 text-white hover:bg-accent-500 active:scale-[0.97] shadow-warm-md hover:shadow-warm-glow'
                    : 'bg-warm-800/60 text-warm-600 cursor-not-allowed'
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
              className="example-pill text-sm text-warm-500 px-3 py-1.5 rounded-full border border-warm-800/50 disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* Loading shimmer */}
      {loading && (
        <div className="mt-12 sm:mt-16 w-full max-w-lg animate-fade-in">
          <div className="grid grid-cols-2 gap-5 sm:gap-6">
            <ShimmerCard />
            <ShimmerCard />
          </div>
          <p className="text-center text-warm-600 text-sm font-light mt-5 tracking-wide">
            正在生成中，预计 10-15 秒...
          </p>
        </div>
      )}

      {/* Results */}
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

      {/* Quota display */}
      {remaining !== null && (
        <div className="mt-10 text-center animate-fade-in">
          {rateLimited ? (
            <p className="text-warm-600 text-sm font-light">
              内测中，每日限额已用完，请明天再来
            </p>
          ) : (
            <p className="text-warm-600 text-sm font-light tracking-wide">
              今日剩余{' '}
              <span className="text-warm-400 font-medium tabular-nums">
                {remaining}/{total}
              </span>{' '}
              次
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto pt-20 pb-8">
        <p className="text-warm-700 text-xs font-light tracking-wider">
          weweekly.online
        </p>
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
    <div className="rounded-2.5xl overflow-hidden bg-warm-900/60 border border-warm-800/30 shadow-card">
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
    <div className="icon-card rounded-2.5xl overflow-hidden bg-warm-900/60 border border-warm-800/30 shadow-card animate-slide-up">
      {/* Icon display area — generous padding, warm dark bg */}
      <div className="aspect-square bg-warm-950 p-5">
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
          className="w-full py-2.5 rounded-xl bg-warm-850 hover:bg-warm-800 text-warm-400 hover:text-warm-300 text-sm font-medium transition-colors flex items-center justify-center gap-2 focus-warm"
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
