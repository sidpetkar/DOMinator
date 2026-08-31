import { EDITOR_PRESENT_ATTR, SNAPSHOT_STATE_ID, STORE_URL } from '@/shared/constants'
import { FIGMA_MARK_URL } from '@/shared/figma'
import { LOGO_DATA_URL } from '@/shared/logo'

/**
 * The reader that travels inside every saved canvas.
 *
 * This is the half of the format that makes it a *document* rather than a
 * project file. Someone you send a `.dom.html` to has no extension, no account
 * and no intention of installing anything — and they still get the board: pan
 * it, zoom it, and flip to the page as it originally was. That is the difference
 * between a file people open and a file people ask you to screenshot for them.
 *
 * It is written as a string rather than as a module because it has to run in a
 * document that is not this one, with nothing to import from. Every line of it
 * ends up inside a single `<script>` in the saved file, so it is plain ES5-ish
 * JavaScript with no build step behind it, and it must never throw: a viewer
 * that fails takes the whole page down with it, and the page is the thing worth
 * saving.
 *
 * When the extension is present it stands down entirely — see
 * `EDITOR_PRESENT_ATTR`. Two bottom bars saying the same thing is the file
 * arguing with the tool that made it.
 */
export function viewerScript(): string {
  return `(function(){
  var STATE_ID = ${JSON.stringify(SNAPSHOT_STATE_ID)};
  var PRESENT = ${JSON.stringify(EDITOR_PRESENT_ATTR)};
  var STORE = ${JSON.stringify(STORE_URL)};
  var LOGO = ${JSON.stringify(LOGO_DATA_URL)};
  var FIGMA = ${JSON.stringify(FIGMA_MARK_URL)};

  var node = document.getElementById(STATE_ID);
  if (!node) return;
  var state;
  try { state = JSON.parse(node.textContent || '{}'); } catch (e) { return; }

  var body = document.body;
  var view = { x: state.view.x, y: state.view.y, scale: state.view.scale };
  /**
   * Canvas on, or the page as it shipped.
   *
   * "Preview the original" is not a second copy of the page — it is this one
   * with the board taken away: no transform, no surface, the document scrolling
   * the way a document does. That is the honest meaning of the switch, and it
   * costs nothing to store because it is the absence of what canvas mode adds.
   */
  var onCanvas = true;

  function paint() {
    if (onCanvas) {
      body.style.setProperty('transform', 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')', 'important');
      body.style.setProperty('transform-origin', '0 0', 'important');
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.documentElement.style.setProperty('background', state.surface, 'important');
      body.setAttribute('data-dm-canvas', '');
    } else {
      body.style.removeProperty('transform');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('background');
      body.removeAttribute('data-dm-canvas');
    }
    var pct = document.getElementById('dm-zoom');
    if (pct) pct.textContent = Math.round(view.scale * 100) + '%';
  }

  function clamp(n) { return Math.min(4, Math.max(0.05, n)); }

  // Zoom about the cursor, so the pixel under it stays under it.
  function zoomAt(cx, cy, factor) {
    var next = clamp(view.scale * factor);
    if (next === view.scale) return;
    var wx = (cx - view.x) / view.scale;
    var wy = (cy - view.y) / view.scale;
    view.x = cx - wx * next; view.y = cy - wy * next; view.scale = next;
    paint();
  }

  window.addEventListener('wheel', function (event) {
    if (!onCanvas || event.target.closest('#dm-viewer-bar')) return;
    event.preventDefault();
    var unit = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, Math.exp((-event.deltaY * unit) / 400));
    } else {
      view.x -= event.deltaX * unit; view.y -= event.deltaY * unit; paint();
    }
  }, { passive: false });

  // Drag anywhere on the surface to pan. Links still work: a press that never
  // travels is left alone entirely.
  var from = null;
  window.addEventListener('pointerdown', function (event) {
    if (!onCanvas || event.button !== 0 || event.target.closest('#dm-viewer-bar')) return;
    from = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
  });
  window.addEventListener('pointermove', function (event) {
    if (!from) return;
    var dx = event.clientX - from.x, dy = event.clientY - from.y;
    if (!from.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    from.moved = true;
    document.documentElement.style.cursor = 'grabbing';
    view.x = from.vx + dx; view.y = from.vy + dy; paint();
  });
  window.addEventListener('pointerup', function () {
    from = null; document.documentElement.style.cursor = '';
  });

  function fit() {
    var w = body.offsetWidth, h = body.offsetHeight;
    if (!w || !h) return;
    var next = clamp(Math.min((innerWidth - 96) / w, (innerHeight - 96) / h));
    view = { scale: next, x: (innerWidth - w * next) / 2, y: (innerHeight - h * next) / 2 };
    paint();
  }

  // — the bar ————————————————————————————————————————————————
  var bar = document.createElement('div');
  bar.id = 'dm-viewer-bar';
  bar.setAttribute('data-dominator', '');
  bar.innerHTML =
    '<img src="' + LOGO + '" alt="" width="16" height="16" style="border-radius:4px;display:block">' +
    '<span class="dm-v-name">DOMinator</span>' +
    '<span class="dm-v-rule"></span>' +
    '<button id="dm-info" class="dm-v-pill" type="button" aria-label="About this file">i</button>' +
    '<span class="dm-v-rule"></span>' +
    '<img src="' + FIGMA + '" alt="" width="14" height="14" style="display:block">' +
    '<button id="dm-switch" class="dm-v-switch" type="button" role="switch" aria-checked="true" aria-label="Canvas"><span></span></button>' +
    '<span id="dm-zoom" class="dm-v-pill" style="cursor:pointer" title="Fit the frame">100%</span>' +
    '<span class="dm-v-rule"></span>' +
    '<a class="dm-v-cta" href="' + STORE + '" target="_blank" rel="noopener">Edit with DOMinator</a>';

  var card = document.createElement('div');
  card.id = 'dm-info-card';
  card.innerHTML =
    '<p><strong>A DOMinator canvas.</strong> A saved design board — the page and every variation beside it, exactly as they were.</p>' +
    '<p>Drag to pan, scroll to move, pinch or Ctrl+scroll to zoom. The switch turns the board off and shows the page as it originally was.</p>' +
    '<p>This is a snapshot, so nothing on it is live — menus, carousels and hover effects are frozen.</p>' +
    '<dl>' +
    '<dt>From</dt><dd>' + escape(state.source || 'an unknown page') + '</dd>' +
    '<dt>Saved</dt><dd>' + escape(state.savedAt || '') + '</dd>' +
    '<dt>Edits</dt><dd>' + (state.edits || 0) + ' element' + (state.edits === 1 ? '' : 's') + ' changed</dd>' +
    '</dl>' +
    '<p class="dm-v-foot">Install the extension to keep editing this file.</p>';
  bar.appendChild(card);

  function escape(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  document.documentElement.appendChild(bar);

  bar.querySelector('#dm-info').addEventListener('click', function () {
    card.classList.toggle('is-open');
  });
  bar.addEventListener('pointerleave', function () { card.classList.remove('is-open'); });

  bar.querySelector('#dm-zoom').addEventListener('click', fit);

  var toggle = bar.querySelector('#dm-switch');
  toggle.addEventListener('click', function () {
    onCanvas = !onCanvas;
    toggle.setAttribute('aria-checked', String(onCanvas));
    toggle.classList.toggle('is-off', !onCanvas);
    paint();
  });

  /**
   * The handshake.
   *
   * The extension's content script sets the attribute when it takes this file
   * over. It may already be there when this runs, or arrive a moment later —
   * content scripts run at document-idle — so both are watched for.
   */
  /**
   * Hand over, and touch nothing else.
   *
   * It is tempting to undo the transform here — the viewer put it on, after all
   * — but the extension has already put its own on by the time this runs, and
   * clearing it wiped the board back to a flat scrolling page a frame after it
   * appeared. Ownership passes at the attribute: from here on the transform,
   * the overflow and the surface are the editor's, and the viewer's only
   * remaining job is to get its bar out of the way.
   */
  function standDown() {
    bar.remove();
  }
  if (document.documentElement.hasAttribute(PRESENT)) { standDown(); return; }
  new MutationObserver(function (records, self) {
    if (!document.documentElement.hasAttribute(PRESENT)) return;
    self.disconnect();
    standDown();
  }).observe(document.documentElement, { attributes: true, attributeFilter: [PRESENT] });

  paint();
})();`
}

/** The viewer's own styles, kept out of the page's way by a hard reset. */
export function viewerStyles(): string {
  return `
#dm-viewer-bar {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  z-index: 2147483646; display: flex; align-items: center; gap: 8px;
  padding: 5px 6px 5px 10px; border-radius: 999px;
  background: #fff; border: 1px solid rgba(11,11,12,.10);
  box-shadow: 0 6px 24px rgba(11,11,12,.14), 0 1px 2px rgba(11,11,12,.08);
  font: 500 11px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #0b0b0c; letter-spacing: -0.01em; user-select: none;
}
#dm-viewer-bar * { box-sizing: border-box; }
#dm-viewer-bar .dm-v-name { font-weight: 500; }
#dm-viewer-bar .dm-v-rule { width: 1px; height: 14px; background: rgba(11,11,12,.12); }
#dm-viewer-bar .dm-v-pill {
  display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
  border: 0; border-radius: 999px; background: transparent; color: #0b0b0c;
  font: 500 11px/1 ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums;
}
#dm-viewer-bar .dm-v-pill:hover { background: rgba(11,11,12,.05); }
#dm-viewer-bar #dm-info { font-style: italic; font-family: Georgia, serif; }
#dm-viewer-bar .dm-v-switch {
  width: 30px; height: 18px; padding: 0; border: 0; border-radius: 999px;
  background: #0a84ff; position: relative; cursor: pointer; transition: background .16s ease;
}
#dm-viewer-bar .dm-v-switch.is-off { background: rgba(11,11,12,.18); }
#dm-viewer-bar .dm-v-switch span {
  position: absolute; top: 2px; left: 14px; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(11,11,12,.3); transition: left .16s ease;
}
#dm-viewer-bar .dm-v-switch.is-off span { left: 2px; }
#dm-viewer-bar .dm-v-cta {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border-radius: 999px; background: #0a84ff; color: #fff; text-decoration: none;
  font: 500 11px/1 ui-sans-serif, system-ui, sans-serif; white-space: nowrap;
}
#dm-viewer-bar .dm-v-cta:hover { background: #0072e6; }
#dm-info-card {
  position: absolute; bottom: calc(100% + 10px); left: 0; width: 300px;
  padding: 12px 14px; border-radius: 12px; background: #fff;
  border: 1px solid rgba(11,11,12,.10); box-shadow: 0 10px 34px rgba(11,11,12,.16);
  font: 400 11px/1.5 ui-sans-serif, system-ui, sans-serif; color: #0b0b0c;
  display: none; text-align: left;
}
#dm-info-card.is-open { display: block; }
#dm-info-card p { margin: 0 0 8px; }
#dm-info-card dl { margin: 10px 0 0; display: grid; grid-template-columns: 52px 1fr; gap: 3px 8px; }
#dm-info-card dt { color: rgba(11,11,12,.5); }
#dm-info-card dd { margin: 0; word-break: break-all; }
#dm-info-card .dm-v-foot { margin: 10px 0 0; color: rgba(11,11,12,.5); }
`
}
