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
const API_BASE = '/api'

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

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-12 sm:py-20">
      {/* Header */}
      <header className="text-center mb-10 sm:mb-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
          Icon Forge{' '}
          <span className="inline-block" role="img" aria-label="hammer">
            🔨
          </span>
        </h1>
        <p className="mt-3 text-neutral-400 text-base sm:text-lg">
          macOS-style app icons, fast.
        </p>
      </header>

      {/* Input Section */}
      <div className="w-full max-w-xl">
        <div className="flex gap-3">
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
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || rateLimited || !description.trim()}
            className={`px-5 py-3 rounded-xl font-medium text-base transition-all whitespace-nowrap ${
              loading
                ? 'bg-indigo-600/50 text-indigo-200 cursor-wait pulse-glow'
                : rateLimited
                ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner />
                生成中
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span>⚡</span>
                <span>生成</span>
              </span>
            )}
          </button>
        </div>

        {/* Example prompts */}
        <div className="mt-4 flex flex-wrap gap-2 justify-center">
          <span className="text-neutral-500 text-sm">示例：</span>
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleExampleClick(prompt)}
              disabled={loading}
              className="text-sm text-neutral-400 hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Loading shimmer */}
      {loading && (
        <div className="mt-10 sm:mt-14 w-full max-w-xl">
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <ShimmerCard />
            <ShimmerCard />
          </div>
          <p className="text-center text-neutral-500 text-sm mt-4">
            正在生成中，预计 10-15 秒...
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && icons.length > 0 && (
        <div className="mt-10 sm:mt-14 w-full max-w-xl">
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
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
        <div className="mt-8 text-center">
          {rateLimited ? (
            <p className="text-neutral-500 text-sm">
              内测中，每日限额已用完，请明天再来 🙂
            </p>
          ) : (
            <p className="text-neutral-500 text-sm">
              今日剩余{' '}
              <span className="text-neutral-300 font-medium">
                {remaining}/{total}
              </span>{' '}
              次
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto pt-16 pb-6">
        <p className="text-neutral-600 text-xs">
          &copy; 2026 weweekly.online
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
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function ShimmerCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800">
      <div className="aspect-square shimmer" />
      <div className="p-3">
        <div className="h-9 rounded-lg shimmer" />
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
    <div className="rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 group transition-transform hover:scale-[1.02]">
      <div className="aspect-square bg-neutral-950 p-4">
        <img
          src={icon.url}
          alt={`Generated icon ${icon.index + 1}`}
          className="w-full h-full object-contain rounded-xl"
          loading="lazy"
        />
      </div>
      <div className="p-3">
        <button
          onClick={() => onDownload(icon.url, icon.index)}
          className="w-full py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          <DownloadIcon />
          下载 PNG
        </button>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg
      className="w-4 h-4"
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
