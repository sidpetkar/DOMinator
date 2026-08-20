import { useState } from 'react'
import { download, mediaOf } from '../core/media'
import type { Node } from '../core/store'
import { DotsIcon, DownloadIcon, TickIcon } from './icons'

type State = 'idle' | 'busy' | 'done' | 'failed'

/**
 * A single round button over any image, video, audio, canvas, inline SVG or
 * CSS background: save that file. Appears on hover as well as on selection,
 * because wanting the asset is usually a different errand from wanting to edit
 * it — having to select first would be a step for nothing.
 *
 * Pinned inside the top-right corner, and nudged inward on small media so it
 * never covers more of the picture than it has to.
 */
export function MediaDownload({ node }: { node: Node }) {
  const [state, setState] = useState<State>('idle')
  const media = mediaOf(node.el)
  if (!media) return null

  const { rect } = node.metrics
  const inset = Math.min(8, rect.width / 6, rect.height / 6)
  const size = rect.width < 56 || rect.height < 56 ? 22 : 28

  const save = async () => {
    setState('busy')
    const ok = await download(media)
    setState(ok ? 'done' : 'failed')
    window.setTimeout(() => setState('idle'), 1600)
  }

  return (
    <button
      type="button"
      title={`Download ${media.filename}`}
      aria-label={`Download ${media.filename}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => void save()}
      className="dm-interactive grid place-items-center rounded-full border-0 text-paper"
      style={{
        position: 'fixed',
        top: rect.top + inset,
        left: rect.left + rect.width - size - inset,
        width: size,
        height: size,
        background:
          state === 'failed'
            ? '#e5484d'
            : state === 'done'
              ? '#2fbf5f'
              : 'color-mix(in srgb, var(--color-ink) 82%, transparent)',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 1px 4px rgba(11,11,12,0.45)',
        cursor: 'pointer',
      }}
    >
      {state === 'done' ? <TickIcon /> : state === 'busy' ? <DotsIcon /> : <DownloadIcon />}
    </button>
  )
}



