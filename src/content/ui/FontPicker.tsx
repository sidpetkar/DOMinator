import { useEffect, useMemo, useRef, useState } from 'react'
import type { FontMeta } from '@/shared/messages'
import { loadCatalogue, loadPreview, previewFamily } from '../core/fonts'
import { cx } from './util'
import { SearchIcon } from './icons'

/** Survives close/reopen — and remount — so a search isn't retyped. */
let lastQuery = ''

const RESULT_CAP = 300

/**
 * The whole Google Fonts directory, each row set in its own face.
 *
 * Two things make that affordable: a row's font is a name-only subset (a few
 * KB), and it is only requested once the row scrolls into view. Nothing is
 * pre-loaded and nothing is fetched for families the user never looks at.
 */
export function FontPicker({
  value,
  onPick,
  /** Open upward — set when the toolbar sits above the text being edited. */
  dropUp,
  maxHeight = 280,
}: {
  value: string
  onPick: (meta: FontMeta) => void
  dropUp: boolean
  maxHeight?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(lastQuery)
  const [fonts, setFonts] = useState<FontMeta[]>([])
  const [loaded, setLoaded] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    lastQuery = query
  }, [query])

  useEffect(() => {
    if (open && !fonts.length) void loadCatalogue().then(setFonts)
  }, [open, fonts.length])

  const applied = useMemo(
    () => fonts.find((font) => font.family === value) ?? null,
    [fonts, value],
  )

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? fonts.filter((font) => font.family.toLowerCase().includes(needle))
      : fonts
    const capped = matched.slice(0, RESULT_CAP)
    // The family in force is pinned to the top, so "what am I using?" never
    // costs a scroll to wherever it happens to fall alphabetically.
    if (applied && !capped.some((font) => font.family === applied.family)) {
      return [applied, ...capped.slice(0, RESULT_CAP - 1)]
    }
    return capped
  }, [fonts, query, applied])

  const total = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? fonts.filter((f) => f.family.toLowerCase().includes(needle)).length : fonts.length
  }, [fonts, query])

  // Load a row's preview face the first time it is actually on screen.
  useEffect(() => {
    const root = listRef.current
    if (!root || !results.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const family = (entry.target as HTMLElement).dataset.family
          const meta = family && results.find((font) => font.family === family)
          if (!meta) continue
          observer.unobserve(entry.target)
          void loadPreview(meta).then((ok) => {
            if (ok) setLoaded((prev) => new Set(prev).add(meta.family))
          })
        }
      },
      { root, rootMargin: '120px' },
    )
    for (const row of root.querySelectorAll('[data-family]')) observer.observe(row)
    return () => observer.disconnect()
  }, [results])

  // Reopening lands on the applied family rather than at the top of the list.
  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    activeRef.current?.scrollIntoView({ block: 'center' })
  }, [open, results.length])

  // Scrollbar fades back out once scrolling stops (see .dm-scroll in overlay.css).
  const idleTimer = useRef(0)
  const onScroll = () => {
    const list = listRef.current
    if (!list) return
    list.classList.add('is-scrolling')
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => list.classList.remove('is-scrolling'), 700)
  }
  useEffect(() => () => window.clearTimeout(idleTimer.current), [])

  return (
    <div className="relative">
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-[26px] w-[136px] items-center justify-between rounded-[6px] border border-line bg-paper px-1.5 text-[11px] text-ink"
        style={
          value && loaded.has(value) ? { fontFamily: `"${value}", ui-sans-serif` } : undefined
        }
        title={value || 'Font family'}
      >
        <span className="truncate">{value || 'Font'}</span>
        <span className="text-ink-soft">▾</span>
      </button>

      {open && (
        <div
          className="dm-panel absolute left-0 flex w-[248px] flex-col overflow-hidden"
          style={dropUp ? { bottom: 30 } : { top: 30 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-1 border-b border-line px-2">
            <SearchIcon />
            <input
              ref={searchRef}
              aria-label="Search fonts"
              value={query}
              placeholder={fonts.length ? `Search ${fonts.length} fonts` : 'Loading library…'}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setOpen(false)
                }
              }}
              className="dm-field min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-1 py-1.5 text-[11px] text-ink"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="grid h-[16px] w-[16px] place-items-center rounded-full border-0 bg-ink/8 text-[9px] leading-none text-ink-soft"
              >
                ✕
              </button>
            )}
          </div>

          <div
            ref={listRef}
            onScroll={onScroll}
            className="dm-scroll overflow-y-auto overscroll-contain"
            style={{ maxHeight }}
          >
            {results.map((font) => {
              const active = font.family === value
              return (
                <button
                  key={font.family}
                  ref={active ? activeRef : undefined}
                  type="button"
                  data-family={font.family}
                  onClick={() => {
                    onPick(font)
                    setOpen(false)
                  }}
                  className={cx(
                    'flex w-full items-baseline justify-between gap-2 border-0 px-2.5 py-1.5 text-left',
                    active ? 'bg-[color:var(--color-select)]/10' : 'bg-transparent hover:bg-ink/5',
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {active && (
                      <span className="text-[9px] text-[color:var(--color-select)]">●</span>
                    )}
                    <span
                      className="truncate text-[14px] text-ink"
                      style={
                        loaded.has(font.family)
                          ? { fontFamily: `"${previewFamily(font.family)}", ui-sans-serif` }
                          : undefined
                      }
                    >
                      {font.family}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9px] text-ink-soft">{font.weights.length}w</span>
                </button>
              )
            })}
            {!results.length && (
              <p className="m-0 px-2.5 py-3 text-[11px] text-ink-soft">
                {fonts.length ? 'No family matches.' : 'Fetching the Google Fonts directory…'}
              </p>
            )}
          </div>

          {total > results.length && (
            <p className="m-0 border-t border-line px-2.5 py-1 text-[9px] text-ink-soft">
              showing {results.length} of {total} — keep typing to narrow
            </p>
          )}
        </div>
      )}
    </div>
  )
}

