<img src="public/icons/logo.png" width="72" alt="DOMinator" />

# DOMinator

Figma-style direct manipulation of the live browser DOM, as a Chrome extension.
Hover to reveal structure, click to select, then drag handles and spacing bands
to change CSS — no DevTools panel, no typing values.

## The mark

`public/icons/logo.png` is the source. `icon16/32/48/128.png` beside it are
generated from it and committed, since the build has no image toolchain; the
browser-tab and toolbar icons come from those. The in-page UI can't load an
extension URL — it renders inside a Shadow DOM on arbitrary sites, where that
would need `web_accessible_resources` and would still break under a strict
`img-src` CSP — so `src/shared/logo.ts` carries a 40px copy as a data URL, which
the status bar uses.

## Getting started

```bash
npm install
```

```bash
npm run build
```

Then load it: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `dist/`.

Open `test/fixture.html` (or any site) and hit **Ctrl/Cmd + Shift + E**, or click
the toolbar icon — there is no popup, the icon toggles the editor directly. Every
shortcut lives behind the (i) in the status bar.

`npm run dev` rebuilds on change; press the reload icon on the extension card, then reload the page.

For faster iteration on the interactions themselves, skip the extension entirely:

```bash
npm run serve
```

`http://localhost:5177/test/fixture.html` loads the built `dist/content.js`
straight into the page and arms it, so a rebuild plus a refresh is the whole
loop. The fixture ships deliberately high-specificity CSS (and an `!important`
rule) to prove our writes win.

`test/donor.html` is the other half of the harness. Open it in a second tab to
exercise the cross-tab clipboard: everything on it is styled by class and
deliberately clashes with what the fixture does to the same class names — `.card`
is a dark gradient tile there and a pale bordered box here — so a copy that
arrives looking like the donor proves the cascade travelled with it. Both pages
stand `chrome.storage.session` in on `localStorage`, which is shared between
same-origin tabs and fires a change event, so the real handoff path is exercised
rather than mocked.

To produce a loadable archive:

```bash
npm run pack
```

That runs a clean build and writes `dominator.zip` — the *contents* of `dist/`,
with `manifest.json` at the root, which is the layout Chrome wants and the single
most common reason a packed extension is rejected. It refuses to pack a half-built
`dist/`, since a missing `content.js` produces an extension that loads and quietly
does nothing.

## Interactions

| Gesture | Result |
| --- | --- |
| Move the mouse | Dashed skeleton outline of the element under the cursor |
| Click | Select — dotted frame, light wash, 8 handles, spacing bands with live values |
| Ctrl/Cmd + click | Drill one level deeper into the selection |
| Alt + click | Step out to the parent |
| Shift + click | Add to (or remove from) the selection |
| Shift + A | Wrap the selection in a new auto-layout container |
| Ctrl/Cmd + Shift + G | Ungroup |
| Enter / Shift + Enter | Go into the first child / back out to the parent |
| ← → ↑ ↓ | Jump to the previous / next sibling |
| Shift + ← → ↑ ↓ | Move the block itself — and out of its container at the ends |
| Drag the selection (or its 6-dot grip) | Pick the block up and drop it into any container |
| Drag a corner / edge handle | Resize (Shift on a corner locks the aspect ratio) |
| Drag a green band | `padding-*` follows the pixel delta |
| Drag an orange band | `margin-*` follows the pixel delta |
| Drag a pink band | `column-gap` / `row-gap` between the children |
| Element bar | Stack, alignment, gap · fill, border, corner radius |
| Double-click text | `contenteditable` + floating type toolbar |
| Hover any media | Round download button, top-right of the asset |
| Ctrl/Cmd + C, then V | Copy the selection, paste it into another block — or into another tab |
| Ctrl/Cmd + D | Duplicate in place |
| Ctrl/Cmd + X | Copy, then hide the original |
| Delete / Backspace | Hides the selection (undoable) |
| Ctrl/Cmd + Z | Undo the last change |
| `s` then `s` (or the camera pill) | Capture a region to the clipboard |
| X-ray pill | Outline every box on the page |
| Accessibility pill | Slides out the four a11y checks — contrast, tab order, names, alt text |
| Esc | Leave text → clear selection → exit editor |

### Moving blocks

Dragging the selection lifts it: the node dims, and the container under the
cursor is outlined with its children dashed, so the stack you are joining is
legible before you commit. A bar shows the exact seam the block will land in,
oriented along that container's axis — vertical for a row, horizontal for a
column — and wrapped rows resolve against the line the cursor is actually on.

Hovering the *middle* of a box drops **inside** it; hovering within ~10px of its
edge targets the **parent**, which is how you place a block between two cards
without having to thread the gap between them.

### Moving blocks without the mouse

**Shift + arrow** moves the selected block one place earlier or later among its
siblings — the keyboard counterpart to dragging the grip. Bare arrows move the
*selection* over the stack; holding Shift moves the *block* through it, which is
the same distinction Figma draws.

At either end of the run it **leaves the container** and lands immediately before
or after it. That is what makes this a move rather than a sort: without it a block
could never get out of the box it was in without reaching for the mouse, which is
the whole point of the gesture. The direction stays unambiguous — out past the
first sibling puts you directly in front of the container you left, out past the
last one directly behind it — and a toast names the container you landed in, since
changing parent is the one part of this you can't infer from the block simply
sliding. It stops at `<body>`; an element parented to the root document element
isn't something a page ever means.

Deliberately **not axis-aware**, matching arrow-key selection: all four arrows mean
earlier or later. A row and a column would otherwise need different keys for the
same idea, and pressing ↑ in a horizontal row has to do *something* or the gesture
feels broken. Non-selectable siblings — comments, scripts — are stepped over
rather than counted, so a press never appears to do nothing.

Each press is its own undo step, and a press with nowhere to go leaves **no** step
behind: the move is planned before anything is recorded, so holding the key at the
end of a list can't quietly fill the stack with moves that never happened. The
block is scrolled back into view if the move took it off screen, and the selection
follows it, so you can keep pressing.

Like the grip, this acts on the **primary selection alone**. Every structural edit
in the tool takes one unambiguous target; moving three elements at once has no
single answer for where they land. Arbitrary reparenting — into a sibling
container, or somewhere across the page — is still the drag's job: the keyboard
reorders and ejects, which covers the cases worth doing one keystroke at a time.

While text is being edited, Shift+arrow belongs to the caret and extends the
selection, as it should.

### The element bar

Direction, wrap, alignment and gap, for the selected container. On a container
that never used flex, the first change promotes it to `display: flex` — that
conversion is what makes vertical → horizontal, or "centre these", work on an
arbitrary page.

Alignment is Figma-shaped: six buttons named for what you see — left, centre,
right, top, middle, bottom. Each maps to `justify-content` or `align-items`
depending on which way the container stacks, so "centre horizontally" does the
same visible thing on a row as on a column. Making the user translate to flex
axes wouldn't be alignment, it would be homework. The button in force is lit.

**Space between / space evenly** sit alongside them, because pushing two items to
opposite ends — a button on the left, a message on the right — is something
alignment cannot express: both ends are involved at once, so it's a property of
the *distribution*, not of an edge. These always write `justify-content` (only
the main axis can be distributed), and their icons follow the stack direction,
since "spread out" means horizontally in a row and vertically in a column.

That half appears for any container with at least one child, since a single child
that needs centring is as common as a stack that needs distributing.

**The box half applies to everything**, because everything has a box:

- **Fill** — background colour, through the same picker the type toolbar uses.
  Shown as a bucket icon over a bar of the current colour, the way an office
  suite marks "this tool, in this colour". The plain swatch this replaced failed
  twice over: a 13px square of `#c7c7c7` on a white button is indistinguishable
  from an empty one, and a square alone never said *what* it would paint. A hatch
  means "nothing of its own" rather than a misleading black.
- **Border** — one button shows or hides it. On an element with no border it
  reads as a dashed outline; pressing it adds a light grey `#c7c7c7` one, and
  colour and width controls appear beside it. Switching a border on writes style,
  width *and* colour together: a page that never styled a border sits at
  `border-style: none`, where setting only a colour paints nothing and the button
  looks broken. Reading the colour back needs the same care — with no border set,
  `border-color` computes to `currentColor`, so trusting it would make "add a
  border" paint a near-black one in the page's text colour.
- **Padding and margin** — one field each, and they are careful about sides.
  A box can have four different values, so the field shows a number only when all
  four agree and `–` when they don't, with every side listed in its tooltip.
  Showing one side's value as though it were "the" padding is how a field ends up
  looking stuck: drag the bottom margin band and a top-reading field never moves.
  Nudging with ± **adds to every side**, keeping the shape — pressing `+` once on
  a `12px 24px` box must not silently flatten it to `16px` all round — while
  typing a number is unambiguous and sets all four. The bands remain the per-edge
  tool.
- **Radius** — a stepper for corner roundness.

Every number in the product is the same control: **− value +**, where
double-clicking the value turns it into a text box. Steppers alone make you click
twenty times to get from 4 to 44; an always-open input in a dense bar swallows
keystrokes meant for the page. Typing applies on each valid keystroke, so the
page follows the number as it is typed, and Escape restores the value the field
was opened with — a live-applied edit has no other way back.

Every picker carries a **pipette** to sample a colour from the page and a round
**reset** beside the hex field that drops our override so the page's own colour
returns — leaving no inline style behind at all, so the element stops counting as
edited.

**Nothing tinted may stand between you and the colour.** While a swatch is being
dragged, or the pipette is open, the selection wash and the green/orange/pink
spacing bands are hidden: you cannot judge a colour through them, and the
eyedropper would otherwise sample *them* rather than the page. The bar and the
picker stay put so the gesture can continue.

The colour picker is reused as-is but **without the contrast readout**: WCAG and
APCA describe text against its background, and a card's fill or a border colour
has no foreground to be legible against, so the panel drops from 283px to 176px
rather than showing numbers about an arbitrary pairing.

Both halves live in one bar rather than two floating panels, which would fight
for the same space above the selection. On a narrow window it wraps to a second
row instead of running its right-hand controls off screen. Its `left` is placed
from an *estimate* of its natural width, never its measured one — measuring
creates a feedback loop where a wrapped bar measures narrow, which pushes it
right, which leaves less room, which wraps it further, ending in a tall thin
column.

### Spacing numbers

The selected element gets a dotted blue frame, filled blue handles ringed in
white (a hollow white square vanishes against light page chrome) and a 5% blue
wash so its extent reads as a shape rather than being inferred from four corners.
The wash is painted below everything else, so the spacing bands are still judged
on their own colour.

Three colours, three different quantities — conflating them is the usual reason
a spacing change lands on the wrong box:

- **green** — the element's own `padding`
- **orange** — the element's own `margin`
- **pink** — the space *between its children*, shown as soon as the parent is
  selected

Every band carries its value the whole time the element is selected, not only
mid-drag, and the numbers track live as you pull because the overlay re-measures
each frame. Zero-width bands are omitted rather than drawn as `0` chips.

**Two controls for one property must not disagree.** A pink band and the bar's
`gap` stepper edit the same thing, so where a CSS gap is in force the band shows
*that* number rather than the raw measurement — the space you can see is often
larger, because the children's own margins add to it (a 12px gap between children
that carry an 8px margin measures 20px apart). The tooltip spells the difference
out rather than hiding it. On containers with no CSS gap there is nothing to
disagree with, so the band shows the measured distance as before.

Child gaps are measured from geometry, so they show up whether the spacing comes
from `gap`, from the children's margins, or from plain flow. On flex and grid
containers — where `gap` is what's actually in force — each band carries a
6-dot grip and writes `column-gap` / `row-gap` as you pull it. Elsewhere there is
no single property to write, so the bands are read-only measurements and show no
grip.

### Selecting more than one

Shift+click adds to the selection and shift-clicking a member removes it, the way
Figma behaves.

With more than one element picked the tool **stops being an editor and becomes a
comparison view**: every member shows the same measurements — padding, margin,
child gaps, size — and none of the controls. The handles, move grip and layout
pill all act on exactly one target, so leaving them on the first-picked element
would make one member of the set quietly editable and the rest not. The
first-picked one keeps a solid badge with a `+2` count so you can still see which
is the anchor; the others get a lighter one.

What *is* meaningful on a set still works on the whole set: delete, copy, paste,
duplicate. Hiding three elements is a single undo step, and copying them keeps
document order so they paste back in the sequence they were taken. The set also
gets one control of its own — **Group** — for the reason below.

Keyboard navigation follows the same tree the selection lives in: **Enter** goes
into the first child, **Shift+Enter** back out to the parent, and the **arrow
keys** step to the previous or next sibling. All four arrows walk siblings rather
than being axis-aware — a column and a row would otherwise need different keys
for the same idea, and Enter already owns the up-and-down-the-tree axis. Arrows
swallow the keystroke so the page doesn't scroll underneath.

### Group — Shift+A, and auto-layout

Alignment is a property of a **parent**. Two sibling cards cannot be centred
relative to each other, because `justify-content` lives on the box that holds
them — so until now, reaching the stack and align controls meant hoping the page
already had a container at exactly the level you wanted. Shift+A manufactures
one: pick two elements, press it, and they land inside a new flex container that
is selected immediately, with the whole element bar pointed at it. Group, then
align — two keystrokes.

This is the only place DOMinator adds structure to a page rather than restyling
it. Ctrl/Cmd+Shift+G, or the ungroup button that appears at the left of the
element bar, dissolves the container and leaves its children where they sat.

**Nothing moves when you group.** A wrapper that changed the layout would have to
be fixed before it could be used, which defeats the point, so the new container
reads its layout off what the elements were already doing:

| Read from the selection | Becomes |
| --- | --- |
| Spread of the members' centres | `flex-direction` — side by side is a row, however that was achieved |
| The seam between adjacent members | `gap` |
| Which cross-axis edge they share | `align-items` — shared centres were centred, shared tops were top-aligned, both means `stretch` |
| Their summed `flex-grow` | The wrapper's own, so a flex parent keeps its ratios |

Two of those need more than a measurement, and they are where the work is.

**Taking over a share of a flex parent.** Three cards at `flex: 1` split a row in
thirds; wrap two of them and the parent has two items, which it splits in
*halves* — the group swells the instant it is made. Summing the members'
`flex-grow` fixes the ratio, and the wrapper's `flex-basis` is set to everything
inside it that never flexed: its own gaps, plus each member's padding and border.
Those pixels used to be charged to the parent item by item and are now hidden
inside the wrapper, so charging them back as fixed basis leaves the free space —
and every sibling's size — untouched. It also needs `min-width: 0`, without which
`min-width: auto` freezes a flex item at its min-content size instead of growing
it, and the wrapper hands every spare pixel to its siblings.

That models the common cases exactly and the exotic ones — a percentage
`flex-basis`, an intrinsically sized item — only approximately. So the result is
**checked**: if the wrapper isn't occupying the span its members did, it is pinned
to that span outright. Fixed pixels are a worse starting point than a share of the
row, which is why it's the fallback and not the rule; a group that visibly jumped
is worse than either.

**Absorbing margins.** Margins don't collapse inside a flex container, so a column
of blocks with `margin: 24px 0` would suddenly space itself at 48px. The stack-axis
margins therefore move off the members and onto the container as `gap`, and the
group's *outer* margins fold onto the wrapper, which sits in the parent's flow
exactly where the run did. This is also what makes the gap control honest — a
member keeping its own margins would mean the pink band edits only part of the
space you can see. It is a no-op when there are no margins to move, which is the
usual case for flex and grid children, so the edit count stays at zero for those.

**Elements in different containers can't be grouped.** The group can only exist in
one place, so one of them has to leave the layout it belongs to — and which one is
a question only you can answer. Rather than guess, the prompt says so and points at
the gesture that expresses it precisely: cut one (Ctrl/Cmd+X), paste it beside the
other, then group. Siblings need not be *adjacent*, though: grouping the 1st and
4th card pulls the 4th up next to the 1st, and the gap comes from the container's
own rhythm rather than from the two-cards-wide hole between them.

Undo is one step for the whole thing — structure and absorbed margins together.
Note that Reset is not: it drops inline styles, and a group is structure, so
Ctrl+Z is the way back out. The wrapper's own styles are written outside the
style-tracking system for the same reason — Reset stripping them would leave a
bare `div` and collapse the group into a block stack.

### Copy and paste

Copy a card or a button, select somewhere else, paste. The paste is **selected
immediately**, so the layout pill's align controls act on it without a further
click — copy, paste, centre, done.

What gets stored is a detached deep clone, not a reference, so the original can
be edited, moved or hidden afterwards and the clipboard still holds what was
copied; each paste clones *that* clone, so one copy pastes repeatedly.

Where it lands is judged from the target: **into** it when it is a container,
**beside** it when it is a heading, button, link or other text element. The DOM
will happily nest a card inside an `<h3>` — it just never looks like what anyone
meant. Ids on the clone are suffixed rather than dropped, since duplicate ids
break `getElementById`, `label`/`for` pairs and anchor links, while dropping them
would lose any `#id` styling that makes the copy look right.

The status bar grows a Copy button whenever something is selected and a Paste
button once the clipboard holds something, so none of this is keyboard-only.

### Copy from one tab, paste into another

Turn DOMinator on in the page you're building, open a second tab, turn it on
there, copy something, come back, paste. The Paste button lights up the moment
you copy in the other tab, and it says which host the copy came from.

**The clipboard is shared; the fidelity trick is not.** Within one tab a copy is a
detached clone and needs nothing more — the page's own stylesheets are still there
when it lands. Across tabs that assumption collapses: `<div class="card">` pasted
into a page that has never heard of `.card` is an unstyled rectangle. So every
copy is *also* serialised to markup with the cascade resolved into it, and both
forms are kept because they're good at different things. Whichever was copied more
recently is the one that pastes, so the rule is just "the last thing you copied,
wherever you copied it" — and a same-tab copy/paste never pays the serialisation's
cost or its slight loss of fidelity.

The shelf lives in `chrome.storage.session`, not in the service worker's memory:
an MV3 worker is evicted after about thirty seconds idle, and a clipboard that
evaporates while you're switching tabs is worse than no clipboard. Session storage
is held for the browser session and never touches disk, which is the right
lifetime for something copied — and the right one for page content, which has no
business being persisted. It's closed to content scripts by default, so the worker
opens it to them on startup; "untrusted" there means our own isolated world, not
the page, and a site's own scripts have no `chrome.storage` to reach for.

**Resolving the cascade.** Two things keep this from producing megabytes of
unreadable markup:

- Only a curated ~100 properties are considered. Copying all 340 computed values
  would bloat the payload, and freezing `width` in pixels would make the paste
  rigid and clip it in a narrower container.
- Every value is **diffed** before it is written. Non-inherited properties go
  against the browser's own default for that tag — read from a throwaway iframe,
  the only place a true UA default can be observed, since probing in the live page
  would read the page's own rules and make `p { margin: 0 }` look like a default.
  Inherited ones go against the parent *inside the copied subtree*, so a colour
  set once on a card isn't restated on all forty of its descendants.

A card from the test donor page comes to 2.8KB and 28 declarations on its root, 7
on a heading, 4 on an icon. Inline declarations beat any ordinary author rule in
the destination, so what gets written wins; what gets *omitted* — properties that
matched the UA default — can still be tinted by a destination page that styles
that tag directly. That's the accepted edge of the approach, and it fails in the
recoverable direction: the paste is a normal selectable element, so anything that
lands wrong is fixable with the tool it just came out of.

Three details earn their place:

- **Gates.** `border-color` resolves to `currentColor`, so on any page that sets a
  text colour it differs from the UA default on *every* node — four declarations
  each, describing a border of zero width. `transform-origin` is worse than noise:
  it computes from the box's own size, so carrying it to a container of a
  different width is actively wrong. Gating a handful of these on the property
  they depend on took a copied card from 5.2KB to 2.8KB.
- **Sizes travel only when they must.** A card's width is left to flow, but an
  element with *no content* has nothing else to go on — the three 22px swatch
  squares in the donor page arrived as three invisible 0×0 boxes until this
  existed — and a replaced element's size is intrinsic. Width is still skipped
  when the box exactly fills its container, since that's a stretch, and carrying
  it is how a copied divider ends up 602px wide in a 300px column. Height is
  never skipped that way: the same test is circular there, because a flex row
  hugs its tallest child, so a 22px square in a 22px row looks stretched by the
  very height it gave the row. When the two rules disagree, the failure that
  matters is the invisible one, not the one that overflows in plain sight.
- **URLs are resolved at the source.** Relative `src`, `srcset`, `href` and
  friends are made absolute before they travel, or every image 404s on arrival.
  `url()` inside the styles needs no help — `getComputedStyle` already returns
  absolute URLs, which is a quieter benefit of resolving the cascade rather than
  copying declarations. It's also what carries a masked icon: those are built by
  putting the file in `mask-image`, usually reached through a custom property, and
  the computed value hands back an absolute URL for free.

**What doesn't cross, and why.** `<script>`, `<style>` and `<link>` are dropped —
their effect is global, so a stylesheet scoped to the source page would repaint
the destination, and running one origin's scripts inside another is not something
a paste should do quietly. `on*` handlers go with them. `<iframe>`, `<object>` and
`<embed>` are dropped too: a frame silently loading a third-party URL into someone
else's page is exactly the thing to be deliberate about, and it would arrive blank
anyway. Deserialisation goes through `DOMParser`, which builds nodes in an inert
document — nothing runs, nothing loads — which is the right posture for markup
that arrived from another origin.

A `<canvas>` is pixels rather than markup, so its current contents ride along as a
background image: a snapshot rather than a live canvas, which is the honest most
that can cross a tab boundary and much better than an empty rectangle. Copies
above 1,500 nodes or 3MB stay local to their tab and say so, rather than being
discovered missing in the other one.

Everything else about editing is unchanged. A cross-tab paste is a normal element:
selectable, resizable, groupable, text-editable, undoable. Its inlined style
becomes its pristine state, so **Reset returns it to how it arrived** rather than
stripping it to a bare `div` — which is the behaviour you want, since the paste is
the baseline you started from.

Two known gaps: a webfont named in the copy won't be loaded in the destination, so
it falls back down its own stack; and a shadow root inside the copied element
can't be serialised at all.

### Moving the bar

The status bar parks bottom-centre, which is exactly where a page's own footer,
cookie banner or chat bubble tends to live. The grip at its left picks it up and
puts it anywhere; it clamps so it can never be dropped off-screen, and
double-clicking the grip returns it to centre.

### Undo, delete, and why a refresh always saves you

Every change is a discrete step on a 60-deep stack, undone with Ctrl/Cmd+Z or the
status-bar button (which shows the depth). A *drag* is one step, not one per
frame: `history.begin()` captures the subtree when the gesture starts and
`commit()` turns it into a single entry when it ends — the same trick collapses a
colour-picker drag from ~60 writes into one.

A step is a captured **style attribute** per element rather than a list of
properties, so undo and Reset are the same operation: put a string back. Once an
element is back to how the page shipped it, it stops counting as edited, so the
Reset badge can't keep counting elements that no longer carry a change.

**Delete hides rather than removes.** The node stays in the DOM, so undo can put
it back exactly where it was — and a hidden node is still selectable in the DOM
tree, which a removed one is not. Structural moves record their inverse (old
parent + old next sibling) *before* relocating, since afterwards the old home is
gone.

Nothing is persisted anywhere: no storage, no injected stylesheet that outlives
the session, no service worker state. Every change is an inline style or an
in-memory DOM move, so **a refresh restores the page exactly**. That is the safety
net — the tool cannot damage anything permanently.

### Screenshot — including taller than the viewport

Tap `s` twice (or hit the camera pill): the page dims, the cursor becomes a
crosshair, and dragging clears the region you're capturing. Release and the PNG
lands on your clipboard, ready to paste anywhere.

**Dragging past the top or bottom edge scrolls the page and keeps extending the
region**, and what you get back is one tall image of the whole thing — not a crop
of the last visible screen. That failure mode is so common because of a hard
platform limit: a content script cannot read the page's pixels at all, and the
one API that can, `chrome.tabs.captureVisibleTab`, only ever returns *the visible
viewport*. There is no "capture the whole page" call to reach for.

So a long shot is assembled:

1. The marquee's anchor is held in the **scroll container's content**
   coordinates, not viewport ones. That single choice is what makes auto-scroll
   work — the content moves underneath while the anchor stays pinned to what it
   was placed on. A viewport-relative anchor slides with the scroll, which is
   exactly why some tools scroll but still capture one screen.
2. Our own overlay is hidden and `fixed`/`sticky` furniture is unpinned, so
   headers don't reappear in every tile down the image.
3. The region is walked one viewport at a time, capturing a tile at each stop,
   each drawn into a canvas at its offset within the region. Near the page end
   the browser clamps the scroll, so the slice is taken from further down that
   tile rather than assuming the scroll went where it was asked.
4. Scale comes from the first tile (`tile.width / innerWidth`) rather than being
   assumed, since a capture returns the display's real pixels — 2× on a retina
   screen. Regions long enough to exceed Chrome's canvas ceiling are scaled down
   instead of failing.
5. Scroll position, pinning and the overlay are all restored.

**Which element scrolls matters.** On a plain document it's the window, but
application shells — fixed header, sidebar, a content pane with `overflow: auto`
— keep `<body>` at a fixed height and scroll an inner div. There
`window.scrollBy` is a silent no-op and `window.scrollY` never leaves 0, which is
why drag-to-edge appears dead on exactly those sites. `scroller.ts` resolves the
nearest scrollable ancestor under the cursor and everything — the auto-scroll,
the coordinate maths, the tile walk — goes through that one abstraction, so both
cases share a code path. The edge zone is measured against the *scroller's* box
too, so the trigger sits at the bottom of the scrolling pane rather than the
bottom of the window.

Chrome rate-limits `captureVisibleTab` to about two calls a second, so the worker
spaces them out and retries once on a quota error; a very long capture takes a
few seconds, and the region shows `capturing…` while it works.

The clipboard write can legitimately fail — an image write needs the document
focused, and on a long capture the user activation may have expired while we were
scrolling — so a PNG download is the fallback rather than losing the shot. The
toast tells you which one happened.

Verified against a synthetic capture source that colours every content row by its
Y, so a stitched image can be checked pixel-by-pixel — in both layouts:

- **window-scrolled page** — 580×2444 across four tiles, exact at the first,
  hundredth, middle and final rows, the last inside the clamped end-of-page tile
- **app shell** (`body { overflow: hidden }`, inner pane scrolls) — the pane
  auto-scrolled 0 → 1904 and produced 580×2490, four times its 638px height,
  exact at every sampled row

### Browser zoom

Zooming out shrinks a CSS pixel, and every panel we draw is specified in CSS
pixels — so the toolbars used to come out tiny at 50% or 25%, precisely when the
user zoomed out to see more of the page. The worker reads the tab's real zoom via
`chrome.tabs.getZoom` (`devicePixelRatio` alone can't separate zoom from display
density), and the floating panels counter-scale by `1/zoom` about a sensible
origin, so they hold a constant physical size. Measured: at a simulated 50% zoom
the status bar renders 959×60 CSS px against 480×30 at 100% — the same size on
glass — and returns exactly on the way back.

Overlays that trace page elements deliberately do *not* compensate: they must
keep matching the geometry they describe, and CSS-pixel coordinates already do
that at any zoom.

### X-ray

The status-bar pill outlines every box on the page at once, dims media so
structure is the subject, and stipples empty containers. It is one injected
stylesheet, not thousands of overlay divs — a real page has far too many boxes to
outline individually at 60fps. Because it is a stylesheet and not an edit, it
never touches inline styles, never enters the undo stack, and vanishes completely
when switched off. Selecting, dragging and editing all keep working while it is
on: it's a lens, not a mode.

### Accessibility

The accessibility pill in the status bar slides three more buttons out beside it.
They're folded away by default because none of this is part of laying a page out:
it's a second pass you make deliberately, and four permanent buttons would widen
the bar for everyone who never opens it. The reveal animates
`grid-template-columns` from `0fr` to `1fr`, which lands on the group's *natural*
width without anyone measuring it — a `max-width` transition needs a hardcoded
guess that goes stale the moment a fifth tool is added.

Both checks below **dim the page and punch their findings out of the dim**, the way
screenshot mode does with a capture region. That is done with one SVG mask rather
than the giant `box-shadow` the marquee uses: that trick punches exactly one hole,
and several overlapping spreads would darken their overlaps twice over. A mask
takes any number of holes in a single composited layer, and they may overlap
freely. The findings' own boxes and labels paint *over* the dim, and so does the
rest of the chrome — the scrim is the backdrop, never something that covers the
handles. It steps aside entirely while a colour is being chosen, since a scrim is
the one thing you cannot judge a colour through.

Only one check runs at a time, and asking for another swaps them. They each dim
the page and box their own findings, so two at once is two scrims fighting over the
same pixels — the store holds a single `lens` slot, which makes that impossible by
construction rather than by discipline.

#### Contrast

**Contrast** checks every piece of text and every icon on the page against what is
actually behind it, and boxes the failures in red with their name and real ratio
in the top right. The threshold is WCAG 2.1 AA: 4.5:1 for body copy, 3:1 for large
text — 18.66px bold or 24px plain, read off the element that holds the text so a
heading isn't held to the body-copy rule — and 3:1 for icons, per 1.4.11.

**Finding the background is the whole problem.** Text almost never sits on the box
that carries the colour; it sits several levels below it, on elements that paint
nothing at all. So the check walks up the ancestors until it finds real paint,
passing straight through transparent elements and *blending* translucent ones as
it goes — a white caption on a `rgba(0,0,0,.5)` scrim over a white page is judged
against the #808080 that actually results, not against either layer. It falls back
to white the way a browser does for an unstyled page.

Where it can't be sure, it says so rather than guessing: an element sitting over a
gradient or a photograph has no single colour behind it, so those are counted and
reported as skipped instead of being given a confident number nobody can act on.
`color: transparent` is left alone too — that's image replacement, not a bug.

Two things it gets right that a naive version doesn't:

- **Only elements that hold text themselves are checked.** A `<div>` wrapping a
  `<p>` isn't the thing with the contrast problem, and flagging both would double
  every box on the page.
- **An icon's verdict comes from its best-contrast part, not its root.** Paint
  lives on an SVG's leaves, and the `<svg>` element's own `fill` computes to black
  whether or not anything uses it — counting the root scored every icon on a light
  page at 21:1 and passed the lot. *Best* rather than worst because a two-tone icon
  with one pale accent is still perfectly discernible; judging it by its faintest
  stroke would flag most icon sets ever drawn.

Unlike x-ray this can't be a stylesheet — a verdict is per element and can't be
written as a selector, and each box carries a number. So it's overlay divs, which
is why the count is capped at 200 and why it follows scroll on a rAF-throttled
listener of its own rather than joining the main tracker.

**The label is a button, and that's the point.** Click it and the element becomes
the selection, so the colour picker already in the element bar is pointed at the
thing to fix. Change the colour and the box disappears on its own: a
`MutationObserver` re-scans 300ms after the page settles, so dragging a colour
through fifty shades costs exactly one re-scan.

#### Tab order

**Tab order** numbers every keyboard stop on the page in the order Tab actually
visits them, so you can read the whole sequence at a glance instead of pressing Tab
forty times and trying to remember where focus went. Same boxes as contrast, in
blue, with the position where the ratio would be.

The order is the part worth getting right, because the rule is the one almost
nobody remembers: **positive `tabindex` values come first**, lowest to highest, and
only then does everything else follow in document order. A single `tabindex="1"`
anywhere on a page silently becomes stop 1, ahead of the header, the nav and
everything above it. Those stops are drawn in **amber** rather than blue — not
broken, but the thing that breaks tab order — with their tabindex in the tooltip.

What's excluded is as important as what's numbered. `tabindex="-1"` is reachable by
script but never by Tab; `disabled`, `display: none`, `visibility: hidden` and
anything inside `[inert]` are out; a radio group is **one** stop, at the checked
radio or the first if none is checked — getting that wrong shifts every number
after it, which is exactly what you're trying to trust. `opacity: 0` is
deliberately *not* an exclusion: it hides an element without removing it from the
sequence, so those stops are real, and a numbered box over apparently empty space
is the tool doing its job.

The names read as a keyboard user meets them — `button · Reconnect`, `a · natural
link` — rather than as CSS selectors, because that's the thing you're checking the
order of. Labels are clickable here too, so a stop in the wrong place is one click
from being selected and moved.

#### Names

**Names** finds controls a screen reader cannot announce. The headline case is the
icon-only button: perfectly usable with a mouse, completely anonymous without one,
and invisible to every check that only looks at how a page appears. The rest are
the ones that *look* handled and so never get noticed by hand:

| Reason | What it means |
| --- | --- |
| `no name` | No text, no `aria-label`, no `<label>`. A screen reader announces the role and nothing else. |
| `broken ref` | `aria-labelledby` points at an id that doesn't exist, so the name it promises never arrives. |
| `hidden + focusable` | `aria-hidden` on something still reachable by Tab — focus lands on a control that announces nothing. |
| `placeholder only` | Named solely by its placeholder, which vanishes the moment anyone types. |
| `title only` | Named solely by `title` — it works, but is never shown on touch and inconsistently announced. |

The name itself is resolved in the order that decides real outcomes —
`aria-labelledby`, `aria-label`, the native `<label>`, then the element's own text
— gathered the way assistive technology gathers it: `aria-hidden` subtrees
contribute nothing, an `<img>` contributes its alt, and an `<svg>` contributes only
a name it was given, since its paths are not text. `<input type="submit">` is never
nameless, because its value (or the browser's default) is its name.

#### Alt text

**Alt text** covers the same ground for images. `alt=""` is deliberately a **pass**:
it is the correct way to say "decorative, skip me", and flagging it would train
people to remove it. The one place it goes wrong is when the image is all a link
contains — then the empty alt takes the control's only possible name with it, and
the finding is reported against the *link*, because that's what's broken.

| Reason | What it means |
| --- | --- |
| `no alt` | No `alt` attribute at all, so a screen reader reads the file name out loud. |
| `filename alt` | `alt="IMG_2043.jpg"` — a name where a description belongs. |
| `empty alt in link` | The image is a link's only content and its alt is empty, leaving the link nameless. |
| `no name` | `role="img"` with no `aria-label` and no `<title>` child. |

#### Both

A scan is a full pass over the document, so it can't run per frame — but a result
that goes stale the moment you fix something is misleading, so the observer
debounces at 300ms. A **backgrounded tab skips the re-scan** and picks it up again
on the way back, so a page left open in another window isn't re-scanning all day.
Only the re-scan is skipped, never the explicit click: a button that silently does
nothing while the tab happens to be unfocused is its own bug, which is exactly what
an earlier version of this shipped.

Everything a check finds is one click from being fixed: the label selects the
element, so the colour picker, the element bar and `Shift+arrow` are all already
pointed at it. Red means broken, amber means worth a look — the tone is the
difference between "a user cannot do this" and "a user will find this awkward".

### Media download

Hovering (or selecting) an image, video, audio, canvas, inline SVG or CSS
background shows a round download button pinned inside its top-right corner. It
appears on *hover* as well as selection, because wanting the asset is usually a
different errand from wanting to edit it.

`currentSrc` is preferred over `src` throughout, so with `srcset` or `<source>`
you get the variant the browser actually painted. Canvases are exported with
`toDataURL` (skipped when cross-origin content has tainted them) and inline SVG is
serialised.

Crucially, *nothing is an `<img>`* on a real site. The file may arrive through
`background-image`, `mask-image` / `-webkit-mask-image`, `border-image-source` or
`list-style-image`, so all of them are checked. `mask-image` matters most: icon
strips are built as a flat background colour punched out by an SVG mask, so the
element paints a picture while `background-image` reads `none` — the reason a
masked logo appeared to have no asset. As a last resort, for leaf elements only,
the element's **custom properties** are scanned, since the URL often lives in a
`--logo` that a stylesheet rule consumes via `var()`. That scan is ~450 property
reads, so its result is cached per element; `mediaOf` runs on every overlay frame. The save itself goes through the worker's `chrome.downloads` call,
which answers to our host permissions rather than the page's CSP; an `<a download>`
fallback covers contexts without the API, such as the local harness.

### Type

The font list is the **entire Google Fonts directory** — ~1,950 families, no API
key — pulled from the same metadata feed fonts.google.com uses, cached for a
week. Each row is set in its own typeface, and each family offers the weights it
actually ships rather than a fixed 300/400/700.

That is affordable because of two things: a row's preview face is subset to the
glyphs of its own name (~3KB) and is only fetched once the row scrolls into
view, so browsing the list costs a few dozen KB. Choosing a family then loads
the real face (~12KB) before the change is applied — otherwise the first paint
falls back to a system font and the change looks like it did nothing.

The list keeps its search text across close/reopen, pins the family currently in
force to the top and marks it, so checking what you applied never costs a scroll.
Its scrollbar appears while scrolling or hovering and dissolves ~0.7s after you
stop.

**Why a font change can look like it did nothing.** Component libraries (MUI,
Chakra) declare `font-family` and `color` on their leaf text elements, often with
`!important`, so setting them on a container changes nothing you can see — and it
depends on which element you picked, not on how many changes you have made.
`textEdit.ts` therefore pushes *those two properties only* into descendants whose
computed value disagrees with what was just set, i.e. the ones declaring it
themselves. Size, weight and spacing deliberately don't cascade: a child heading
differing there is a type hierarchy, and flattening it would cause more damage
than the fix is worth. Subtrees over 800 elements are left alone.

All of it flows through the background worker, which hands the content script
raw bytes for `new FontFace(name, buffer)`. No `<link>` reaches the host page and
no font is fetched from page context, so a site with `font-src 'self'` cannot
block it.

The toolbar carries family, weight, size, **line height**, **letter spacing**,
alignment and colour, in divider-separated groups.

### Colour and contrast

The picker is ours rather than the browser's — the native one can't be styled and
lands as a black OS panel in the middle of a monochrome toolbar. It has a
saturation/value field, a hue slider, a hex field, and the screen eyedropper
where Chrome offers one.

Underneath is the part that earns its keep: a live accessibility readout against
the colour **actually painted behind the text** (`effectiveBackground` walks the
ancestors for the first painted background, blending translucent layers, exactly
as the browser composites them). It reports WCAG 2.1 ratio with AA/AAA verdicts
for body text, the large/bold thresholds in words, APCA `Lc`, and CIE `L*`. Two
systems on purpose: WCAG 2.1 is what audits still cite, APCA predicts legibility
for thin or light type far better, and they disagree often enough that showing
one alone would mislead.

The maths is checked against published vectors — black on white gives APCA
`106.04` and ratio `21.00`, white on black gives `-107.88`. Note `L*` here is the
CIE Lab lightness of the *text* colour; other tools sometimes label a different
quantity `L*`, so it may not match them digit for digit.

**Keeping sight of the target.** Entering edit mode selects the whole element,
and that highlight is drawn by us — so it survives focus moving to the toolbar,
which is when the browser drops the native selection. Style changes land on
exactly what is highlighted: the selected run when part of the text is selected,
the whole element otherwise. The font list also opens away from the text it
would otherwise cover.

Partial selections are wrapped in a `span[data-dominator-text]`, reused on
subsequent tweaks so repeated edits don't nest wrappers. Wrapping is limited to
selections inside a single text node; anything spanning element boundaries
styles one level wider instead, because quietly restructuring someone's markup
is worse than being slightly coarse.

While the editor is on, the page is frozen: clicks don't navigate and forms don't
submit, so a link can be selected like any other box.

## Architecture

Two Vite builds, because MV3 content scripts can't be ES modules:

- `vite.config.ts` → `background.js` (ESM service worker)
- `vite.content.config.ts` → `content.js` (single-entry IIFE)

```
src/
  content/
    index.tsx          mounts the overlay into a Shadow DOM, handles messages
    App.tsx            pure projection of the store
    overlay.css        Tailwind + tokens, imported ?inline and adopted by the shadow root
    core/
      controller.ts    every host-page listener; maps events onto the store
      store.ts         tiny observable read by React via useSyncExternalStore
      picker.ts        hit-testing, container heuristic, drill down / step out
      drag.ts          one rAF-coalesced gesture primitive for all push/pull
      transforms.ts    resize + spacing math → CSS writes
      reorder.ts       drop-target resolution, plus the Shift+arrow keyboard step
      move.ts          the lift-and-drop gesture
      layout.ts        stack axis / wrap / gap, incl. block → flex promotion
      group.ts         Shift+A: derive an auto-layout wrapper from the selection
      gaps.ts          spacing between children, line-grouped for wrapped rows
      textEdit.ts      selection memory + apply-to-selection-or-element
      fonts.ts         FontFace registration from worker-supplied bytes
      color.ts         conversions, WCAG 2.1 + APCA + L*, background resolution
      history.ts       undo stack; one step per gesture, not per frame
      clipboard.ts     copy / paste / duplicate, with container-vs-beside logic
      transfer.ts      cross-tab copy: cascade → inline styles, and the shared shelf
      screenshot.ts    region marquee with edge auto-scroll; tile-and-stitch capture
      scroller.ts      resolves what actually scrolls — window or an inner pane
      zoom.ts          browser zoom, so the chrome keeps a constant size
      media.ts         asset detection + download
      xray.ts          the page-skeleton lens (one injected stylesheet)
      audit.ts         accessibility scans: contrast vs resolved background, tab order
  background/
    fonts.ts           Google Fonts directory + woff2 proxy (worker-only fetch)
      geometry.ts      one-pass box-model measurement
      styles.ts        the only writer: inline + !important, with exact revert
      fonts.ts         Google Fonts list + loading
    ui/                overlay chrome (frame, handles, spacing, text toolbar)
    ui/icons.tsx       the whole icon vocabulary: Bootstrap Icons + the Figma set
  background/          icon + keyboard toggle, font proxy, capture, downloads
  shared/              message union + design constants
```

Two rules keep the tool from fighting the page it edits:

1. **All UI lives in a Shadow DOM** with `all: initial` on the host, so the site's
   CSS can't deform our chrome and our CSS can't leak into the site.
2. **All writes go through `styles.ts`** as inline `!important` declarations,
   recorded per property — so "Revert edits" restores the original inline value
   exactly, rather than blanket-clearing `style`.

The overlay re-measures its target every animation frame, which is what keeps the
frame glued to elements on pages that lazy-load, animate or reflow.

### Icons

Every icon lives in [`ui/icons.tsx`](src/content/ui/icons.tsx), and the artwork is
**Bootstrap Icons** — taken from the official package as raw SVG rather than
through a React wrapper. The wrapper was tried first and rejected on measurement:
a barrel of 2,078 components took the build from 2s to 20s, because Rollup has to
walk every one of them to tree-shake, and it dragged `prop-types` into a bundle
that gets injected into every page the user visits — 35KB for thirty icons.
Imported as `bootstrap-icons/icons/name.svg?raw`, each icon costs only its path
data and the whole set adds ~5KB. Nothing is fetched at runtime and no icon font
has to survive the page's CSP.

Three sets are deliberately **not** Bootstrap:

| Kept | Why |
| --- | --- |
| The six align marks | A rule with two bars pushed against it — the shorthand Figma uses, read without a legend by anyone arriving from there. |
| Stack direction | Two blocks side by side or stacked: auto-layout's own vocabulary. |
| Wrap | Bootstrap's `text-wrap` reads as a *typographic* setting, which is the wrong idea — this control wraps boxes, not sentences. Two blocks and a third dropped onto the next line. |
| Space **evenly** | Bootstrap covers `space-between` on both axes and has nothing for `evenly`, so that half stays drawn rather than borrowing a mark that means something else. |
| The selection grip | It sits on a solid chip where a stroked glyph disappears, so it stays a dot matrix — the one mark that has to read as filled. |

Sizes are **per icon**, mostly 12–13px, each tuned against the container it sits
in — a 24px bar toggle, a 22px picker button, a 26px type-toolbar button. One
uniform size was tried at both 20px and 16px and reverted: it makes the bars
visibly heavier, and it forces every container to grow with it. Two are pinned by
the space they occupy rather than by taste — the bar's drag handle is a 12px strip,
and the drag-dots inside a child gap band are sized to the gap they describe.

Wherever Bootstrap has a true equivalent it is used, including the places that
were previously hand-drawn for no good reason: text alignment, wrap, paste, undo,
the eyedropper, the paint bucket.

One consequence of the shadow boundary is worth knowing, because it cost real
debugging time: our stylesheet is *constructed* (`new CSSStyleSheet()` +
`adoptedStyleSheets`), and **`@property` registrations do not survive that**.
Tailwind's border utilities set `border-style: var(--tw-border-style)` and depend
on an `@property` rule for that variable's `solid` initial value — so every
`border`, `border-t` and `border-b` in the chrome resolved to `style: none`, and a
width with no style is a used width of zero. Fifteen borders across the UI were
silently drawing nothing. `:host` now declares `--tw-border-style: solid`
directly, which inherits through the whole shadow tree. Anything else that leans
on `@property` will need the same treatment.

## Status

Working: hover skeleton, selection with drill-down and step-out, 8-handle resize
with anchored edges, padding/margin push-pull with always-visible values,
lift-and-drop into any container (with container + sibling highlighting and a
seam indicator), auto-layout direction/wrap/gap, child-gap measurement, and
double-click text editing with the full Google Fonts directory, per-family
weights, line height, letter spacing, alignment and a live colour swatch. Plus
revert, and the icon / keyboard toggle.

Also verified: a padding drag lands as exactly one undo step and Ctrl+Z restores
the pristine attribute; Delete hides a card (still in the DOM) and Ctrl+Z brings
it back with the Reset badge correctly cleared; X-ray toggles cleanly on and off
with selection still working underneath; and the download button appears on
`<img>`, inline `<svg>` and `<canvas>` with sane filenames but not on ordinary
elements.

The contrast check is verified against thirteen known-answer cases in the `#ada`
block of the fixture, every ratio computed from the WCAG formula rather than
eyeballed, and all thirteen agree: #999 on white flagged at 2.85, #767676 passed
at 4.54, 28px #999 flagged against the *large*-text 3:1 while 20px bold #888
passed it, white three levels above a `#222` box passed at 15.9 and #555 in the
same place flagged at 2.13, white on a 50%-black scrim over white flagged at 3.98
(the blend resolved correctly), text over a gradient counted as skipped rather
than flagged, `color: transparent` and `display: none` ignored, a #dcdcdc icon
flagged at 1.37, and a dark icon and a two-tone icon both passed.

Also checked: each red box aligns to its element's rect to the pixel, its label
sits top-right and is clickable while the box itself ignores the pointer; clicking
a label selects the element; changing that element's colour drops it from the
findings and removes its box within the debounce; toggling off clears the store and
the DOM and stops the observer; toggling back on catches an element broken while it
was off; and `deactivate()` leaves nothing behind, with a later mutation unable to
resurrect it. The collapsed button group measures genuinely zero-wide and is
`inert`, so its buttons aren't tabbable while hidden — a focusable control inside
an `aria-hidden` subtree being exactly the bug this panel is meant to find.

Tab order has fifteen cases of its own in the `#tabs` block, each tagged with the
stop it should land on or `skip`, and all fifteen agree. The two positive-`tabindex`
buttons correctly become stops **1 and 2 of the whole page**, ahead of the buttons
and link above them, which then follow in document order; `tabindex="-1"`,
`disabled`, `display: none`, `visibility: hidden`, `[inert]` and a hidden input are
all excluded; and a three-radio group contributes exactly one stop, at the checked
radio. Independently confirmed against the DOM rather than only against itself:
every computed stop really does take focus when asked, the four hard exclusions
really do refuse it, and the three programmatically-focusable-but-not-tabbable ones
(`tabindex="-1"`, the two unchecked radios) accept `focus()` while staying out of
the sequence — which is the distinction the whole feature turns on.

The name and alt-text checks have twenty-three more cases across `#names` and
`#alts`, each tagged with the reason it should produce or `ok`, and all
twenty-three agree — including an icon-only button and an icon-only link reported
as nameless, a broken `aria-labelledby`, `aria-hidden` on a focusable button
flagged while `aria-hidden` on inert decoration is not, `input[type=submit]`
correctly treated as named by its value, `alt=""` passing as decorative but
failing when it is a link's only content, `alt="IMG_2043.jpg"` caught as a file
name, and `role="img"` accepting either an `aria-label` or a `<title>` child. Both
checks were also confirmed to produce no false positives anywhere else on the
fixture.

Rendering was checked for all four lenses: seven boxes for the visible tab stops with
numbers in the top right, blue for ordinary stops and amber for the two that jump
the queue, seven mask holes matching the seven boxes exactly, the scrim first in
paint order and the status bar last, exactly one scrim at a time, and switching
checks swapping rather than stacking them.

Keyboard moving was verified against a flex row, a CSS grid column and a plain
block parent: reorder in both directions, the cross-axis key still working inside
a horizontal row, ejecting left landing immediately before the old container and
right immediately after it, an only child ejecting out and leaving its wrapper
empty, and the walk continuing up through `.page` to `<body>` and then **refusing**
to go further — adding no undo steps for the presses that had nowhere to go. Undo
walks the whole trip back to the original parent and sibling order. Also checked:
bare arrows still only move the selection and record nothing; Shift+arrow while
text is being edited leaves the DOM completely alone; a multi-selection moves its
primary and keeps its extras; and a move that pushes the block off screen scrolls
it back into view.

The cross-tab clipboard was verified with the fixture and `test/donor.html` open
side by side, in both directions. A donor card pasted into the fixture keeps its
gradient, its gold serif heading, its pink badge and its 22px swatch squares, and
adapts its width to the destination column instead of arriving at the donor's —
while the fixture's own `.card` rule, which styles that exact class name
completely differently, does not take it over. A two-card multi-selection crosses
in document order. Going the other way, the fixture's media row arrives with its
`<img>`, its inline `<svg>`, a snapshot of its `<canvas>`, and its masked icon
whose relative `logo.svg` was resolved and fetched 200 from the destination page.

Also checked: a same-tab copy still pastes as a bare clone with no inlined styles
at all; a newer cross-tab copy correctly beats an older local one; the paste pill
shows the source host; scripts, stylesheets, `<link>`s, frames and `on*` handlers
are all stripped from the payload, and relative `src`, `srcset` and `../href` are
absolutised. And the pasted node is fully live — hit-test selectable, editable
through the element bar (its 22/20/26px padding and 18px radius arrived intact),
groupable with a sibling, text-editable, deletable, with the whole chain undoing
back to zero edits and zero added nodes. Reset on it returns it to how it arrived
rather than to a bare `div`.

Grouping was verified against every container kind in `test/fixture.html`, with
the page geometry compared pixel for pixel before and after: two adjacent
`flex: 1` cards in a flex row, two rows of a CSS grid, a button and a label in a
flex row that don't grow, two block sections whose vertical margins collapse, and
a single element on its own — all five land with **nothing on the page moving**,
and each undoes back to a byte-identical `style` attribute. Non-adjacent siblings
(cards 1 and 3) keep every size and reorder, which is the one case where the
geometry has to change. Also checked: the full loop through the real event path —
shift+click, Shift+A, stack vertically, align centres, Ctrl/Cmd+Shift+G — leaves
the DOM in its original order with no wrappers behind, and both refusals
(different containers, ungrouping something that isn't a group) explain themselves
without touching the page.

Verified end-to-end against `test/fixture.html`: reparenting a card into the
vertical stack, dropping a stack row between two cards in the horizontal row,
switching the row between column/row/wrap with gap changes, pink child-gap
badges on a selected container, dragging a pink band to take `column-gap` from
16px to 28px, applying twelve families back-to-back from the 1,942-family picker
(all twelve loaded and applied), cascading a family onto leaves pinned with
`font-family: Georgia !important`, and the picker reopening with the applied
family pinned and marked.

Next up:

- **Redo** — the stack only walks backwards; Ctrl+Shift+Z has nothing to do yet.
- **Text edits aren't in the stack** — typing inside `contenteditable` uses the
  browser's own undo (Ctrl+Z is deliberately left to it while editing), so those
  changes and ours undo on separate tracks.
- **Drop into empty containers** — the seam is drawn for them, but a zero-height
  empty container is nearly impossible to hover; it needs a minimum hit area.
- **Italics** — the directory reports italic faces (`400i`), and the picker
  currently ignores them.
- **Font search ranking** — matches are alphabetical and capped at 300 rows;
  popularity ordering would put the families people want first.
- **Icons** — the manifest ships no `default_icon` yet, so Chrome shows a generic badge.
- **Cross-frame editing** — content script is `all_frames: false` for now.

Out of scope by design (PRD §5): generating, saving or exporting prompts/context
for AI IDEs.
