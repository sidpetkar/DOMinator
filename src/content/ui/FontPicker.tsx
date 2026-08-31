import { useEffect, useMemo, useRef, useState } from 'react'
import type { FontMeta } from '@/shared/messages'
import { loadCatalogue, loadPreview, previewFamily } from '../core/fonts'
import { cx, useFadingScroll } from './util'
import { CaretIcon, SearchIcon } from './icons'

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

  const applied = useMemo(() => fonts.find((font) => font.family === value) ?? null, [fonts, value])

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
    return needle
      ? fonts.filter((f) => f.family.toLowerCase().includes(needle)).length
      : fonts.length
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
  useFadingScroll(listRef, open)

  return (
    <div className="relative flex min-w-0">
      {/* As wide as the room it is given. A family name is the longest string in
          this panel and the fixed 136px it used to have meant most of them
          arrived as an ellipsis before the second word. */}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className={cx(
          'dm-select flex h-[24px] min-w-0 flex-1 items-center gap-1 rounded-[6px] border-0 px-1.5 text-[11px] text-ink',
          open ? 'bg-ink/[0.10]' : 'bg-ink/[0.06] hover:bg-ink/[0.09]',
        )}
        style={value && loaded.has(value) ? { fontFamily: `"${value}", ui-sans-serif` } : undefined}
        title={value || 'Font family'}
      >
        <span className="min-w-0 flex-1 truncate text-left">{value || 'Font'}</span>
        <span className="shrink-0 text-ink-soft">
          <CaretIcon />
        </span>
      </button>

      {open && (
        <div
          className="dm-panel absolute left-0 flex w-[248px] flex-col overflow-hidden"
          style={dropUp ? { bottom: 28 } : { top: 28 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/**
           * The search field *is* the row, rather than an input sitting inside
           * one with its own border.
           *
           * It had both: a bordered panel header and a field that drew a second
           * box inside it, which on focus grew a third — a blue ring around a
           * rounded rectangle inside a rounded rectangle. Making the whole row
           * the control leaves one shape.
           */}
          <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
            <span className="flex shrink-0 items-center text-ink-soft">
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              aria-label="Search fonts"
              value={query}
              placeholder={fonts.length ? `Search ${fonts.length} fonts` : 'Loading library…'}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') setOpen(false)
              }}
              className="dm-field dm-bare min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] text-ink outline-none placeholder:text-ink-soft"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="shrink-0 rounded-[4px] border-0 bg-transparent px-1 text-[11px] leading-none text-ink-soft hover:bg-ink/5"
              >
                ×
              </button>
            )}
          </div>

          <div
            ref={listRef}
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
