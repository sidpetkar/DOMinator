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
      ['Ctrl/Cmd + V with an image', 'Drop a picture into the selection'],
      ['Ctrl/Cmd + D', 'Duplicate in place'],
      ['Delete', 'Hide the selection'],
      ['Ctrl/Cmd + Z', 'Undo'],
      ['Ctrl/Cmd + Shift + Z', 'Redo'],
    ],
  },
  {
    title: 'Element bar',
    items: [
      ['Fill', 'Background colour — bucket icon'],
      ['Border', 'Show / hide, then colour and width'],
      ['Pad · mar', 'Green is padding, orange is margin'],
      ['⛶ on any group', 'Fold it out into its four sides'],
      ['Drag a value', 'Scrub it · Shift goes ten at a time'],
      ['Double-click a value', 'Type it exactly'],
      ['Radius', 'All corners, or each on its own'],
      ['Shadow', 'Offset, blur, spread, colour, opacity'],
      ['Rotate · flip', 'Turn a quarter, or mirror either way'],
      ['Stack · align', 'Direction, wrap, alignment, spacing'],
      ['Picture', 'Put an image file into the selected box'],
      ['Pipette', 'Sample a colour from the page'],
      ['Checkered slider', 'Transparency, in every picker'],
      ['Hex / HSL', 'Switch how the value is written'],
      ['↺ in picker', 'Back to the original colour'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['Panels switch', 'The page on a canvas, panels either side'],
      ['Pinch · Ctrl + wheel', 'Zoom the canvas about the cursor'],
      ['Two fingers · Shift + drag', 'Pan the canvas'],
      ['Space + drag', 'Pan, from anywhere on the page'],
      ['Click the surface', 'Deselect'],
      ['Alt + drag', 'Lift a copy onto the canvas'],
      ['Copy, then paste on the surface', 'The same, from the clipboard'],
      ['Ctrl/Cmd + D on a variation', 'Another copy of it'],
      ['Drag a variation', 'Move it around the canvas'],
      ['Drag a tree row', 'Move the element into another container'],
      ['S, S', 'Screenshot a region'],
      ['Camera', 'A region, or the whole page in one click'],
      ['Accessibility pill', 'Contrast and tab-order checks'],
      ['Ctrl/Cmd + Shift + E', 'Toggle DOMinator'],
      ['Esc', 'Clear everything · again to exit'],
    ],
  },
]
