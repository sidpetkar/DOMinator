import { rectStyle } from './util'

/**
 * The rest of the row, dotted.
 *
 * A hover that outlines one box says what you would get. It does not say what
 * else is *there*, so finding the structure of a page means sweeping the cursor
 * across it and watching the outline jump — which is the hunting this whole
 * hit-testing model exists to end. Drawing the hovered element's siblings at the
 * same moment turns a hover into a map: this is the one under the pointer, and
 * these are the others at its level.
 *
 * Dotted and pale against the hovered element's solid line, because the
 * difference between them has to be readable at a glance and at 30% zoom, where
 * a difference of colour alone would not be.
 */
export function PeerOutlines({ peers }: { peers: HTMLElement[] }) {
  return (
    <>
      {peers.map((el, index) => {
        // Measured at paint time, not when the hover landed: the overlay redraws
        // every frame, so a page that is still settling stays outlined correctly.
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return null
        return (
          <div
            key={index}
            aria-hidden
            className="pointer-events-none"
            style={{
              ...rectStyle(rect),
              border: '1px dotted color-mix(in srgb, var(--color-select) 55%, transparent)',
            }}
          />
        )
      })}
    </>
  )
}
