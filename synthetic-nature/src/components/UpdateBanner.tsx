/**
 * UpdateBanner.tsx — the self-hoster's "new release" notice.
 *
 * Every docker pull runs a build that never auto-updates, so the people
 * running ENZO would otherwise only hear about a release by re-checking the
 * repo. This banner closes that gap honestly: on workspace load it reads the
 * latest release tag from GitHub's public API (24h sessionStorage cache, one
 * unauthenticated request a day at most), compares it against the running
 * __ENZO_VERSION__, and shows a small dismissible card linking to the release
 * notes. Per-version dismissal, silent on any failure — a rate-limited or
 * offline instance never sees a broken UI.
 */

import { useEffect, useState } from 'react'
import { Rocket, X } from 'lucide-react'

const REPO = 'theguysudo/ENZO'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** True when `latest` (e.g. "v1.7.0") is a higher semver than the running build. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number)
  const b = current.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return false
}

export default function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null)
  const [dismissedTag, setDismissedTag] = useState<string | null>(() => {
    try {
      return localStorage.getItem('enzo.update.dismissed')
    } catch {
      return null
    }
  })

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const cached = sessionStorage.getItem('enzo.update.latest')
        if (cached) {
          const { tag, at } = JSON.parse(cached)
          if (typeof tag === 'string' && Date.now() - Number(at) < CACHE_TTL_MS) {
            if (!cancelled) setLatest(tag)
            return
          }
        }
      } catch {
        /* storage unavailable — fall through to the fetch */
      }
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!res.ok) return
        const data = await res.json()
        if (typeof data?.tag_name !== 'string') return
        try {
          sessionStorage.setItem('enzo.update.latest', JSON.stringify({ tag: data.tag_name, at: Date.now() }))
        } catch {
          /* cache is best-effort */
        }
        if (!cancelled) setLatest(data.tag_name)
      } catch {
        /* offline or rate-limited — never surface a broken banner */
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (!latest || !isNewer(latest, __ENZO_VERSION__) || dismissedTag === latest) return null

  const dismiss = () => {
    setDismissedTag(latest)
    try {
      localStorage.setItem('enzo.update.dismissed', latest)
    } catch {
      /* session-only dismissal is fine */
    }
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-[9990] max-w-[300px] rounded-xl border border-white/10 bg-[#0c0c0e]/95 backdrop-blur-md p-3 shadow-[0_12px_36px_rgba(0,0,0,0.5)]"
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <Rocket size={14} className="mt-0.5 shrink-0 text-white/60" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white/90">ENZO {latest} is out</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/55">
            You're running v{__ENZO_VERSION__}. Pull the new image or see what changed.
          </p>
          <a
            href={`https://github.com/${REPO}/releases/tag/${latest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[11px] text-white/80 underline decoration-white/30 underline-offset-2 hover:text-white"
          >
            Release notes
          </a>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update notice"
          className="shrink-0 rounded-full p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
