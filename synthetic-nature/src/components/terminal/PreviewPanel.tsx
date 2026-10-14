/**
 * PreviewPanel.tsx — the live code-preview side panel.
 *
 * Quiet developer-tool chrome around the generated app (2026-10 redesign per
 * the security/UX audit): a flat panel surface, a thin border, a browser-style
 * URL field and icon actions. The old paper-texture treatment — wrinkle +
 * grain filters, drifting smears, vignette, sheen sweep — competed with the
 * very application the user is trying to inspect, so the preview body now gets
 * the space and contrast while ENZO's texture work stays in the surrounding
 * workspace. Portaled to <body> so it escapes ancestor transforms/overflow and
 * always renders ABOVE the app header + terminal chrome. The dock/reflow math
 * lives in TerminalSection (it owns the grid this panel docks beside).
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import { Monitor, Download, ExternalLink, Copy, Check, RefreshCw, X } from 'lucide-react'

export interface PreviewData {
  id: string
  url: string
  title: string
  isProject?: boolean
  files?: { path: string; size: number }[]
}

interface PreviewPanelProps {
  preview: PreviewData | null
  open: boolean
  sideDrawerOpen: boolean
  maximized: boolean
  lowPower: boolean
  copied: boolean
  frameKey: number
  storedTask: { id: string } | null
  storedFileCount: number
  absoluteUrl: string
  onZip: () => void
  onCopyUrl: () => void
  onReload: () => void
  onClose: () => void
  onReopen: () => void
}

const actionButton =
  'flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/55 transition-colors hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/55'

export default function PreviewPanel({
  preview,
  open,
  sideDrawerOpen,
  maximized,
  copied,
  frameKey,
  storedTask,
  storedFileCount,
  absoluteUrl,
  onZip,
  onCopyUrl,
  onReload,
  onClose,
  onReopen,
}: PreviewPanelProps) {
  const prefersReducedMotion = useReducedMotion()
  // Clicking a file in the strip loads that path inside the frame (inspection
  // without leaving the panel); reload clears it back to the entry page.
  const [srcOverride, setSrcOverride] = useState<string | null>(null)

  useEffect(() => {
    setSrcOverride(null)
  }, [preview?.id])

  if (!preview) return null

  const panelVariants: Variants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.15 } },
        dimmed: { opacity: 0, transition: { duration: 0.1 } },
        exit: { opacity: 0, transition: { duration: 0.15 } },
      }
    : {
        hidden: { opacity: 0, x: 40 },
        show: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } },
        dimmed: { opacity: 0, x: 24, transition: { duration: 0.15, ease: 'easeIn' } },
        exit: { opacity: 0, x: 28, transition: { duration: 0.2, ease: 'easeIn' } },
      }

  return createPortal(
    <>
      {/* Floating reopen tab — shown when a preview exists but the panel is
          closed so the user can summon it back without re-asking the model.
          The vertical centering lives inside framer's transform (y: '-50%')
          because framer's inline transform would defeat the old class. */}
      <AnimatePresence>
        {!open && preview && (
          <motion.button
            type="button"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 44, y: '-50%' }}
            animate={
              prefersReducedMotion
                ? { opacity: sideDrawerOpen ? 0 : 1 }
                : { opacity: sideDrawerOpen ? 0 : 1, x: 0, y: '-50%' }
            }
            exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
            transition={{ duration: prefersReducedMotion ? 0.15 : 0.3, ease: 'easeOut' }}
            onClick={onReopen}
            className={`fixed top-1/2 right-0 z-[9997] flex items-center gap-2 rounded-l-xl border border-r-0 border-white/10 bg-[#0c0c0e]/95 px-3 py-2 text-white/70 hover:text-white hover:border-white/25 shadow-lg cursor-pointer ${sideDrawerOpen ? 'pointer-events-none' : ''}`}
          >
            <Monitor size={14} className="text-white/70" />
            <span className="text-xs font-medium">Preview</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* The `dimmed` variant replaces a Tailwind opacity-0 toggle — an inline
          framer opacity always beat that class, so the panel never actually
          faded when a drawer opened. On narrow screens the panel becomes a
          full-width sheet instead of forcing the 46vw dock to overflow. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial="hidden"
            animate={sideDrawerOpen ? 'dimmed' : 'show'}
            exit="exit"
            variants={panelVariants}
            style={{ pointerEvents: sideDrawerOpen ? 'none' : 'auto' }}
            className={`fixed ${maximized ? 'top-2' : 'top-20'} bottom-2 right-2 z-[9998] w-[min(46vw,640px)] max-[720px]:w-[calc(100vw-1rem)] max-[720px]:min-w-0 min-w-[360px] flex flex-col overflow-hidden rounded-xl bg-[#0c0c0e] ring-1 ring-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.55)] transition-[top] duration-300 will-change-transform`}
          >
            {/* Panel header — browser-style toolbar: URL field + icon actions */}
            <div className="relative z-10 flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-2">
              <Monitor size={14} className="ml-1 shrink-0 text-white/45" aria-hidden />
              <input
                type="text"
                readOnly
                value={preview.url}
                title={preview.title || 'Live Preview'}
                aria-label="Preview URL"
                className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 font-mono text-xs text-white/60 selection:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              />
              {preview.isProject && (
                <span className="shrink-0 text-[11px] text-white/45" title={`${preview.files?.length ?? 0} files in this project`}>
                  {preview.files?.length ?? 0} files
                </span>
              )}
              {storedFileCount > 0 && (
                <span className="shrink-0 text-[11px] text-white/45" title="Files stored locally in this browser">
                  saved {storedFileCount}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onCopyUrl}
                  title="Copy preview URL"
                  aria-label="Copy preview URL"
                  className={actionButton}
                >
                  {copied ? <Check size={13} className="text-white/85" /> : <Copy size={13} />}
                </button>
                <button
                  type="button"
                  onClick={onZip}
                  disabled={!storedTask}
                  title={storedTask ? 'Download these files as a .zip' : 'No stored snapshot to zip yet'}
                  aria-label="Download as zip"
                  className={actionButton}
                >
                  <Download size={13} />
                </button>
                <a
                  href={absoluteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in a new tab"
                  aria-label="Open in a new tab"
                  className={actionButton}
                >
                  <ExternalLink size={13} />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setSrcOverride(null)
                    onReload()
                  }}
                  title="Reload preview"
                  aria-label="Reload preview"
                  className={actionButton}
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="Close preview"
                  aria-label="Close preview"
                  className={actionButton}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* File strip (multi-file projects) — plain clickable paths; a
                click loads that file inside the frame, reload returns to the
                entry page. No decorative pills. */}
            {preview.isProject && preview.files && preview.files.length > 0 && (
              <div className="relative z-10 flex items-center gap-0.5 overflow-x-auto scrollbar-none border-b border-white/[0.06] px-2.5 py-1">
                {preview.files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSrcOverride(`/api/project/${preview.id}/${f.path}`)}
                    title={`Open ${f.path} in the preview frame`}
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer ${
                      srcOverride === `/api/project/${preview.id}/${f.path}`
                        ? 'bg-white/[0.08] text-white/85'
                        : 'text-white/45 hover:text-white/85 hover:bg-white/[0.05]'
                    }`}
                  >
                    {f.path}
                  </button>
                ))}
              </div>
            )}

            {/* Preview body — the generated app IS the panel content */}
            <div className="relative z-10 flex-1 min-h-0 p-1.5">
              {/* NOTE: do not add allow-same-origin here. The code in this
                  frame is written by an LLM and served from our own origin,
                  so allow-scripts + allow-same-origin together let it reach
                  window.parent.localStorage — every provider key and the
                  auth token — and the two tokens combined are documented as
                  removing protections "in the same way" as no sandbox at all.
                  Without it the frame gets an opaque origin: parent access
                  throws SecurityError, while relative fetch, forms, popups
                  and pointer lock all still work. The backend mirrors this
                  via a `Content-Security-Policy: sandbox` header on
                  /api/preview, so the open-in-new-tab path is isolated too. */}
              <div className="h-full w-full overflow-hidden rounded-lg bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                <iframe
                  key={frameKey}
                  title="ENZO live preview"
                  src={srcOverride ?? preview.url}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                  className="h-full w-full border-0"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}
