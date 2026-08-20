/**
 * One source of truth for the key map, shown by the (i) in the status bar.
 * Grouped the way someone learns them: get to the thing, then change it.
 */
export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Select',
    items: [
      ['Click', 'Select an element'],
      ['Shift + click', 'Add to the selection'],
      ['Ctrl/Cmd + click', 'Drill one level deeper'],
      ['Alt + click', 'Step out to the parent'],
      ['Enter', 'Go into the first child'],
      ['Shift + Enter', 'Go out to the parent'],
      ['← → ↑ ↓', 'Jump to the previous / next sibling'],
    ],
  },
  {
    title: 'Move',
    items: [
      ['Shift + ← ↑', 'Move the block one place earlier'],
      ['Shift + → ↓', 'Move it one place later'],
      ['Shift + arrow at the end', 'Move it out of its container'],
    ],
  },
  {
    title: 'Group',
    items: [
      ['Shift + A', 'Wrap the selection in an auto-layout box'],
      ['Ctrl/Cmd + Shift + G', 'Ungroup'],
    ],
  },
  {
    title: 'Change',
    items: [
      ['Drag', 'Move the block into another container'],
      ['Drag handles', 'Resize · Shift locks the ratio'],
      ['Double-click', 'Edit text'],
      ['Ctrl/Cmd + C, V', 'Copy, then paste into the selection'],
      ['Ctrl/Cmd + D', 'Duplicate in place'],
      ['Delete', 'Hide the selection'],
      ['Ctrl/Cmd + Z', 'Undo'],
    ],
  },
  {
    title: 'Element bar',
    items: [
      ['Fill', 'Background colour — bucket icon'],
      ['Border', 'Show / hide, then colour and width'],
      ['Pad · mar', 'Padding and margin, all four sides'],
      ['Radius', 'Corner roundness'],
      ['Stack · align', 'Direction, wrap, alignment, spacing'],
      ['Pipette', 'Sample a colour from the page'],
      ['↺ in picker', 'Back to the original colour'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['S, S', 'Screenshot a region'],
      ['Accessibility pill', 'Contrast and tab-order checks'],
      ['Ctrl/Cmd + Shift + E', 'Toggle DOMinator'],
      ['Esc', 'Step back, then exit'],
    ],
  },
]
