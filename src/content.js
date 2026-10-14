/*
 * Bandcamp Cart Relocator -- isolated-world content script.
 *
 *   #sidecart lives in #rightColumn, above the artist photo. We move the whole
 *   node (not a copy, so Bandcamp's own jQuery handlers keep working) into a
 *   panel inserted right before #pgFt, which holds the "... recommends:"
 *   footer. CSS then re-lays the item list out as wrapping cards.
 */
(() => {
  'use strict';

  const PANEL_ID  = 'bcx-cart-panel';
  const INNER_CLS = 'bcx-cart-inner';
  const PENDING   = 'bcx-pending';

  const FLASH_MS   = 2200;
  const SWEEP_MS   = 2000;
  const PENDING_MS = 5000;

  // Covers both menubars Bandcamp currently ships: the Vue one (the
  // data-v-* button with aria-label="Cart") and the older Knockout one.
  const CART_BUTTON_SELECTOR = [
    'button[aria-label="Cart" i]',
    'a[aria-label="Cart" i]',
    '[role="menuitem"][aria-label="Cart" i]',
    '[data-test="menubar-cart"]',
    '#menubar li.cart > a',
    '#menubar .cart-link'
  ].join(',');

  const TYPE_LABEL = { a: 'Digital album', t: 'Digital track', p: 'Merch', s: 'Subscription' };

  const docEl = document.documentElement;

  let cartById    = new Map();   // "sidecart_item_<id>" -> bridge data
  let cartStamp   = 0;           // bumped whenever bridge data changes
  let lastCartRaw = '';
  let lastDomSig  = null;
  let lastSig     = '';
  let frame       = 0;
  let flashTimer  = 0;
  let observer    = null;

  // Hide the cart in its original spot until we have moved it, so it does not
  // flash in the sidebar on load. Always released, even if something throws.
  docEl.classList.add(PENDING);
  const pendingTimer = setTimeout(releasePending, PENDING_MS);
  function releasePending() {
    clearTimeout(pendingTimer);
    docEl.classList.remove(PENDING);
  }

  /* ------------------------------------------------------------- bridge -- */

  document.addEventListener('bcx:cart', (event) => {
    const raw = event.detail;
    if (typeof raw !== 'string' || raw === lastCartRaw) return;  // guards a request/publish loop
    lastCartRaw = raw;

    let list;
    try { list = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(list)) return;

    const next = new Map();
    for (const item of list) next.set('sidecart_item_' + item.id, item);
    cartById = next;
    cartStamp++;
    schedule();
  });

  document.addEventListener('bcx:wiggle', () => { revealCart(); });

  function requestCartData() {
    document.dispatchEvent(new CustomEvent('bcx:request-cart'));
  }

  /* -------------------------------------------------------- click hijack -- */

  document.addEventListener('click', onClickCapture, true);

  function onClickCapture(event) {
    // Let the browser's own "open in new tab/window" behaviour through.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.contains(target)) return;        // never hijack the cart's own links

    if (!target.closest(CART_BUTTON_SELECTOR)) return;

    // Empty cart: stock Bandcamp just follows the link. Leave it be.
    if (!panel || !panel.classList.contains('bcx-has-items')) return;

    // Capture phase, so this runs before the menubar's own handler ever sees
    // the event -- that handler scrolls the page to the top before wiggling.
    event.preventDefault();
    event.stopImmediatePropagation();
    revealCart();
  }

  function revealCart() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panel.classList.contains('bcx-has-items')) return false;

    // The phone layout keeps the cart body collapsed behind this class.
    const sidecart = document.getElementById('sidecart');
    if (sidecart) sidecart.classList.add('expanded');

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

    panel.classList.remove('bcx-flash');
    void panel.offsetWidth;                              // restart the animation
    panel.classList.add('bcx-flash');

    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => panel.classList.remove('bcx-flash'), FLASH_MS);
    return true;
  }

  /* ----------------------------------------------------------- the sync -- */

  // setTimeout rather than requestAnimationFrame: a background tab produces no
  // animation frames, and we want an album opened in one to be fully laid out
  // the moment it is brought forward, not a frame later.
  function schedule() {
    if (frame) return;
    frame = setTimeout(() => { frame = 0; sync(); }, 16);
  }

  function signature() {
    const list     = document.getElementById('item_list');
    const panel    = document.getElementById(PANEL_ID);
    const sidecart = document.getElementById('sidecart');
    return [
      list ? Array.from(list.children, (c) => c.id).join(',') : '-',
      panel && sidecart && panel.contains(sidecart) ? 1 : 0,
      document.querySelectorAll(CART_BUTTON_SELECTOR + ':not(.bcx-cart-btn)').length,
      document.querySelectorAll('[data-item-id]').length,   // a grid loading in
      cartStamp
    ].join('#');
  }

  function sync() {
    const sig = signature();
    if (sig === lastSig) return;
    lastSig = sig;

    const sidecart = document.getElementById('sidecart');
    if (!sidecart) { releasePending(); return; }

    withObserverPaused(() => {
      placePanel(sidecart);

      const list  = document.getElementById('item_list');
      const items = list ? Array.from(list.children).filter((el) => el.classList.contains('item')) : [];

      const domSig = items.map((el) => el.id).join('|');
      if (domSig !== lastDomSig) {
        lastDomSig = domSig;
        requestCartData();
      }

      decorateItems(items);
      buildHeader(items.length);
      updateCartButtons(items);
      markGrid();

      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.classList.toggle('bcx-has-items', items.length > 0);

      applyTheme();
    });

    releasePending();
    lastSig = signature();   // account for our own edits so we do not loop
  }

  /* ------------------------------------------------------------- layout -- */

  // Album and track pages end with #pgFt (the "... recommends:" footer) and the
  // panel goes right above it. Discography and band pages have no such footer,
  // but #pgFt always sits immediately after #pgBd anyway, so "just after the
  // page body" covers both layouts.
  function panelSlot() {
    const footer = document.getElementById('pgFt');
    if (footer && footer.parentElement) return { parent: footer.parentElement, before: footer };

    const body = document.getElementById('pgBd');
    if (body && body.parentElement) return { parent: body.parentElement, before: body.nextElementSibling };

    return null;
  }

  function placePanel(sidecart) {
    const slot = panelSlot();
    if (!slot) return;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.setAttribute('aria-label', 'Shopping cart');
      const inner = document.createElement('div');
      inner.className = INNER_CLS;
      panel.appendChild(inner);
    }

    if (panel.parentElement !== slot.parent || panel.nextElementSibling !== slot.before) {
      slot.parent.insertBefore(panel, slot.before);
    }

    const inner = panel.querySelector('.' + INNER_CLS);
    if (inner && sidecart.parentElement !== inner) inner.appendChild(sidecart);
  }

  // Artist pages are themed, so borrow #pgBd's colours and width rather than
  // hardcoding a white panel onto a dark layout. #pgBd's own `color` is what
  // the themes set and what the track list, about text and titles all inherit,
  // so it is the page's main text colour by definition. The CSS derives the
  // muted/border/tint shades from these two.
  function applyTheme() {
    const panel = document.getElementById(PANEL_ID);
    const body  = document.getElementById('pgBd');
    if (!panel || !body) return;

    const width = Math.round(body.getBoundingClientRect().width);
    let surface = opaqueBackground(body) || WHITE;
    let text    = parseColor(getComputedStyle(body).color) || NEAR_BLACK;

    // A few themes pair a text colour with a background it cannot be read
    // against. Rather than ship mush, fall back to plain black or white.
    if (contrastRatio(text, surface) < MIN_CONTRAST) {
      text = contrastRatio(WHITE, surface) >= contrastRatio(NEAR_BLACK, surface) ? WHITE : NEAR_BLACK;

      // Mid-tone backgrounds read poorly against black *and* white. When even
      // the better of the two falls short, give the panel its own surface
      // rather than matching a page colour nothing is legible on.
      if (contrastRatio(text, surface) < MIN_CONTRAST) {
        const preferDark = contrastRatio(NEAR_BLACK, surface) >= contrastRatio(WHITE, surface);
        surface = preferDark ? WHITE : NEAR_BLACK;
        text    = preferDark ? NEAR_BLACK : WHITE;
      }
    }

    const set = (name, value) => {
      if (value && panel.style.getPropertyValue(name) !== value) panel.style.setProperty(name, value);
    };

    if (width > 0) set('--bcx-page-width', width + 'px');
    set('--bcx-surface', toRgb(surface));
    set('--bcx-text', toRgb(text));
  }

  const WHITE = [255, 255, 255];
  const NEAR_BLACK = [17, 17, 17];
  const MIN_CONTRAST = 4.5;          // WCAG AA for body text

  const toRgb = ([r, g, b]) => 'rgb(' + r + ', ' + g + ', ' + b + ')';

  function parseColor(value) {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    if (parts.length > 3 && parts[3] === 0) return null;      // fully transparent
    return parts.slice(0, 3);
  }

  // What the element actually appears to sit on, the way the page paints it.
  function opaqueBackground(el) {
    for (let node = el; node; node = node.parentElement) {
      const colour = parseColor(getComputedStyle(node).backgroundColor);
      if (colour) return colour;
    }
    return null;
  }

  function contrastRatio(a, b) {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* -------------------------------------------------------------- cards -- */

  function decorateItems(items) {
    const current = currentPageItem();
    for (const item of items) {
      const data = cartById.get(item.id) || null;
      decorate(item, data);
      item.classList.toggle('bcx-current', isCurrentPageItem(item, data, current));
    }
  }

  function decorate(item, data) {
    syncArtwork(item, data, data ? artworkUrl(data) : null);

    const para = item.querySelector('.cartItemContents p');
    if (!para) return;

    const name  = para.querySelector('a.itemName');
    const price = para.querySelector('span.price');
    const trash = para.querySelector('a.delete');

    // The stock link text is "Artist, Title, digital album" -- split it into
    // real lines now that the bridge gives us the fields separately.
    if (data && name) {
      const title = String(data.item_title == null ? '' : data.item_title);
      if (title && name.dataset.bcxTitle !== title) {
        name.dataset.bcxTitle = title;
        name.textContent = title;
        name.title = [data.artist_name, title].filter(Boolean).join(' – ');
      }
      upsertLine(para, 'bcx-artist', data.artist_name || '', name);
      upsertLine(para, 'bcx-format', formatLabel(data), para.querySelector('.bcx-artist') || name);
    }

    if (price || trash) {
      let row = para.querySelector(':scope > .bcx-row');
      if (!row) {
        row = document.createElement('span');
        row.className = 'bcx-row';
        para.appendChild(row);
      }
      // Moving nodes keeps their jQuery-bound handlers (a.delete) intact.
      if (price && price.parentElement !== row) row.appendChild(price);
      if (trash && trash.parentElement !== row) row.appendChild(trash);
      if (trash && trash.getAttribute('aria-label') !== 'Remove from cart') {
        trash.setAttribute('aria-label', 'Remove from cart');
        trash.title = 'Remove from cart';
      }
      if (row !== para.lastElementChild) para.appendChild(row);
    }
  }

  // The tile is always present (even with no usable image) so that cards in a
  // row keep the same shape instead of collapsing to a text-only stub.
  function syncArtwork(item, data, url) {
    let tile = item.querySelector(':scope > .bcx-art');

    if (!data) { if (tile) tile.remove(); return; }

    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'bcx-art';
      item.insertBefore(tile, item.firstChild);
    }

    let img = tile.querySelector('img');
    if (!url || tile.dataset.bcxFailed === url) { if (img) img.remove(); return; }

    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      // Remember the failure, otherwise the next sync re-adds a broken image.
      img.addEventListener('error', () => {
        tile.dataset.bcxFailed = img.getAttribute('src') || '';
        img.remove();
      }, { once: true });
      tile.appendChild(img);
    }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  }

  function upsertLine(parent, className, text, after) {
    let el = parent.querySelector(':scope > .' + className);
    if (!text) { if (el) el.remove(); return; }

    if (!el) {
      el = document.createElement('span');
      el.className = className;
      if (after && after.parentElement === parent) after.insertAdjacentElement('afterend', el);
      else parent.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  // _9 is Bandcamp's 210x210 thumbnail; album art is prefixed "a", merch is not.
  function artworkUrl(data) {
    if (data.art_id)   return 'https://f4.bcbits.com/img/a' + data.art_id + '_9.jpg';
    if (data.image_id) return 'https://f4.bcbits.com/img/' + data.image_id + '_9.jpg';
    return null;
  }

  function formatLabel(data) {
    let label = data.option_name || TYPE_LABEL[data.item_type] || '';
    if (data.quantity > 1) label = (label ? label + ' · ' : '') + '×' + data.quantity;
    return label;
  }

  // Pulls the whole recap up into the header -- totals as a subtitle under the
  // cart title, Check out on the title line, tax note beneath it -- so the
  // cards below get the full width instead of a summary rail beside them.
  //
  // The summary and the button are *moved*, not rebuilt: Bandcamp re-renders
  // #sidecartSummary's innerHTML on every update but keeps the element itself,
  // and the button carries its own checkout handler.
  function buildHeader(count) {
    const header = document.getElementById('sidecartHeader');
    if (!header) return;

    const left     = ensureChild(header, 'div', 'bcx-head-left');
    const titleRow = ensureChild(left, 'div', 'bcx-title-row');
    const right    = ensureChild(header, 'div', 'bcx-head-right');

    const title = header.querySelector('h3.title');
    if (title && title.parentElement !== titleRow) titleRow.appendChild(title);

    const badge = ensureChild(titleRow, 'span', 'bcx-count');
    const text  = count + (count === 1 ? ' item' : ' items');
    if (badge.textContent !== text) badge.textContent = text;

    const summary = document.getElementById('sidecartSummary');
    if (summary && summary.parentElement !== left) left.appendChild(summary);

    const checkout = document.getElementById('sidecartCheckout');
    if (checkout && checkout.parentElement !== right) right.insertBefore(checkout, right.firstChild);

    // The tax row is inside the re-rendered innerHTML, so mirror its text
    // rather than moving the node out of the table.
    const source  = summary && summary.querySelector('.sidecartTaxText');
    const taxText = source ? source.textContent.trim() : '';
    let tax = right.querySelector(':scope > .bcx-tax');
    if (taxText) {
      if (!tax) tax = ensureChild(right, 'div', 'bcx-tax');
      if (tax.textContent !== taxText) tax.textContent = taxText;
    } else if (tax) {
      tax.remove();
    }

    // Whitespace text nodes keep the emptied footer a line tall otherwise.
    const footer = document.getElementById('sidecartFooter');
    if (footer) footer.classList.toggle('bcx-empty', footer.childElementCount === 0);
  }

  function ensureChild(parent, tag, className) {
    let el = parent.querySelector(':scope > .' + className);
    if (!el) {
      el = document.createElement(tag);
      el.className = className;
      parent.appendChild(el);
    }
    return el;
  }

  /* --------------------------------------------------- "already in cart" -- */

  // Only album and track pages have a "current item". Discography and band
  // pages carry a data-tralbum blob too, but a stub one -- no id, no
  // item_type, just the /music URL -- so require the real fields rather than
  // trusting the blob's presence, or the cart button claims "Already in cart"
  // on a page that shows no single item.
  function currentPageItem() {
    const el = document.querySelector('script[data-tralbum]');
    if (!el) return null;

    let data;
    try { data = JSON.parse(el.getAttribute('data-tralbum')); } catch { return null; }
    if (!data) return null;
    if (!Number.isFinite(data.id)) return null;
    if (data.item_type !== 'album' && data.item_type !== 'track') return null;

    return {
      id: data.id,
      type: data.item_type,                                   // "album" | "track"
      url: normalizeUrl(data.url || location.href),
      packageIds: (data.packages || []).map((p) => p.id).filter(Boolean)
    };
  }

  function isCurrentPageItem(item, data, current) {
    if (!current) return false;

    if (data) {
      if (data.item_type === 'a' && current.type === 'album' && data.item_id === current.id) return true;
      if (data.item_type === 't' && current.type === 'track' && data.item_id === current.id) return true;
      if (data.item_type === 'p' && current.packageIds.includes(data.item_id)) return true;
      return !!data.url && normalizeUrl(data.url) === current.url;
    }

    // No bridge data (e.g. Sidecart never initialised): fall back to the link.
    const link = item.querySelector('a.itemName[href]');
    return !!link && normalizeUrl(link.href) === current.url;
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(value, location.href);
      return (url.host + url.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch {
      return String(value || '').toLowerCase();
    }
  }

  // Flags releases in a discography grid that are already in the cart. Tiles
  // carry data-item-id="album-<id>" / "track-<id>", which lines up with the
  // cart's item_type + item_id. Merch packages carry a package id instead, so
  // those fall back to matching the release URL -- buying the vinyl marks the
  // album tile, which is what you want to see.
  function markGrid() {
    const panel = document.getElementById(PANEL_ID);
    const tiles = document.querySelectorAll('[data-item-id]');
    if (!tiles.length) return;

    const keys = new Set();
    const urls = new Set();

    for (const data of cartById.values()) {
      const prefix = GRID_PREFIX[data.item_type];
      if (prefix && data.item_id) keys.add(prefix + '-' + data.item_id);
      if (data.url) urls.add(normalizeUrl(data.url));
    }

    // Without the bridge, the links in the cart itself still give us URLs.
    if (!cartById.size) {
      for (const link of document.querySelectorAll('#item_list a.itemName[href]')) {
        urls.add(normalizeUrl(link.href));
      }
    }

    for (const tile of tiles) {
      if (panel && panel.contains(tile)) continue;
      const id = tile.getAttribute('data-item-id') || '';
      if (!GRID_ID.test(id)) continue;

      const link = tile.querySelector('a[href]');
      const inCart = keys.has(id) || (!!link && urls.has(normalizeUrl(link.href)));
      tile.classList.toggle('bcx-grid-in-cart', inCart);
    }
  }

  const GRID_PREFIX = { a: 'album', t: 'track' };
  const GRID_ID = /^(album|track)-\d+$/;

  function updateCartButtons(items) {
    const panel  = document.getElementById(PANEL_ID);
    const inCart = items.length > 0 && items.some((el) => el.classList.contains('bcx-current'));

    if (document.body) document.body.classList.toggle('bcx-current-in-cart', inCart);

    // Tag the buttons so the CSS has a stable hook even if Bandcamp's markup
    // shifts; re-applied on every sync because Vue rewrites class attributes.
    for (const button of document.querySelectorAll(CART_BUTTON_SELECTOR)) {
      if (panel && panel.contains(button)) continue;
      button.classList.add('bcx-cart-btn');
    }
  }

  /* ---------------------------------------------------------- observers -- */

  const OBSERVE_OPTIONS = { childList: true, subtree: true };

  function withObserverPaused(fn) {
    if (observer) observer.disconnect();
    try {
      fn();
    } finally {
      if (observer) {
        observer.takeRecords();                 // drop records caused by our own edits
        observer.observe(docEl, OBSERVE_OPTIONS);
      }
    }
  }

  function start() {
    observer = new MutationObserver(schedule);
    observer.observe(docEl, OBSERVE_OPTIONS);

    // Catches attribute-only changes (Vue re-rendering the menubar button)
    // that the childList observer does not see.
    setInterval(() => { lastSig = ''; schedule(); }, SWEEP_MS);

    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyTheme, 120);
    });

    requestCartData();
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
