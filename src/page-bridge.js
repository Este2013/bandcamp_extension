/*
 * Runs in the PAGE's JS world (manifest "world": "MAIN"), so it can see
 * Bandcamp's own `window.Sidecart`. It does two things:
 *
 *   1. Publishes a plain-data snapshot of the cart to the content script.
 *      The DOM the sidecart renders has no artwork and mashes artist/title/
 *      format into one string ("Hainbach, Vive, digital album"), but the
 *      CartItem objects carry art_id, artist_name, item_id, item_type, ...
 *
 *   2. Replaces Sidecart.wiggle(). Stock Bandcamp shakes #sidecart in the
 *      sidebar; since the cart no longer lives there, we turn every wiggle
 *      (menubar button, add-to-cart) into a "scroll to it and flash it".
 *
 * Communication is via CustomEvents with a JSON *string* payload -- strings
 * survive the main-world -> isolated-world hop, arbitrary objects do not.
 */
(() => {
  'use strict';

  if (window.__bcxBridgeInstalled) return;
  window.__bcxBridgeInstalled = true;

  const EV_CART    = 'bcx:cart';
  const EV_WIGGLE  = 'bcx:wiggle';
  const EV_REQUEST = 'bcx:request-cart';

  const POLL_MS       = 150;
  const POLL_GIVEUP_MS = 30000;

  function snapshot() {
    const cart = window.Sidecart;
    if (!cart || !Array.isArray(cart.cart_items)) return null;

    return cart.cart_items.map((i) => {
      // Server-rendered rows are <div class="item" id="sidecart_item_<id>">,
      // and CartItem.init adopts them by that id. A row added without a reload
      // takes the other branch -- CartItem.render() builds a bare
      // <div class="item"> and nothing ever gives it an id. Stamp it here, so
      // the content script can match the row to its data (and so show its
      // artwork) instead of only after a refresh.
      if (i.el && !i.el.id) i.el.id = 'sidecart_item_' + i.id;

      return {
        // `id` is the cart-line id; the DOM node is #sidecart_item_<id>.
        id: i.id,
        item_id: i.item_id,
        item_type: i.item_type,        // 'a' album | 't' track | 'p' package | 's' subscription
        item_title: i.item_title,
        artist_name: i.artist_name || null,
        url: i.url || null,
        art_id: i.art_id || null,
        image_id: i.image_id || null,
        quantity: i.quantity,
        option_name: i.option_name || null,
        disp_price: i.disp_price || null
      };
    });
  }

  function publish() {
    const items = snapshot();
    if (!items) return;
    document.dispatchEvent(new CustomEvent(EV_CART, { detail: JSON.stringify(items) }));
  }

  document.addEventListener(EV_REQUEST, publish);

  function patch() {
    const cart = window.Sidecart;
    if (!cart) return false;

    if (!cart.__bcxPatched) {
      cart.__bcxPatched = true;

      // Own property shadows Sidecart.prototype.wiggle.
      cart.wiggle = function () {
        document.dispatchEvent(new CustomEvent(EV_WIGGLE));
      };

      // Called by add_item_to_list / delete_item_from_list / quantity changes.
      const update = cart.update_item_list;
      if (typeof update === 'function') {
        cart.update_item_list = function (...args) {
          const result = update.apply(this, args);
          publish();
          return result;
        };
      }
    }

    publish();
    return true;
  }

  if (!patch()) {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (patch() || Date.now() - startedAt > POLL_GIVEUP_MS) clearInterval(timer);
    }, POLL_MS);
  }
})();
