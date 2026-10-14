# Bandcamp Cart Relocator

Moves Bandcamp's shopping cart out of the right sidebar (where it pushes the
artist photo and everything else down) to a panel just above the
"… recommends:" footer, laid out as a wrapping row of cards.

## What it does

- **Relocates the cart.** `#sidecart` is moved — node and all, so Bandcamp's own
  delete/checkout handlers keep working — into a panel inserted immediately
  after the page body, which on album and track pages puts it right above the
  `#pgFt` recommendations footer. Discography and band pages have no `#pgFt`,
  so there the panel lands between the release grid and the site footer.
- **Cards instead of a list.** `#item_list` becomes a wrapping flex row across
  the full panel width. Each item gets its cover art, the title and artist on
  separate lines, the format ("Digital album", "Limited Edition Vinyl LP · ×2"),
  and a price/remove row.
- **The recap lives in the header.** Subtotal, additional contribution and
  "ship to …" read as a subtitle under the *Shopping cart* title. *Check out*
  sits on the title line at the far right, with "taxes calculated at checkout"
  directly beneath it. Nothing sits beside the cards, so they get the whole
  width — five per row at Bandcamp's 975px instead of four.
- **No more wiggle.** Clicking the menubar cart button used to scroll the page
  to the top and shake the sidebar. It now smooth-scrolls to the relocated cart
  and highlights it for ~2 seconds. Adding something to the cart does the same.
- **"Already in cart".** When something from the page you are looking at is in
  the cart, the menubar cart button gets an *Already in cart* badge and the
  matching card is outlined and tagged *On this page*. This matches by item id,
  so an album *and* any of its merch packages are both recognised. Discography
  pages show no single item, so they get no badge — see below.
- **Release grids are flagged too.** On a discography or band page, every tile
  already in the cart gets an *In cart* pill and an outlined cover.

Themed artist pages are respected — the panel borrows its width, background and
text colour from `#pgBd` at runtime rather than forcing a white box onto a dark
layout. See [Colour on themed pages](#colour-on-themed-pages).

## Install (unpacked, dev mode)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.

No build step, no permissions, no background worker. Reload the extension from
that page after editing any file.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; three content scripts, no permissions |
| `src/cart.css` | Injected at `document_start`, so the cart never flashes in the sidebar |
| `src/content.js` | Isolated world: moves the cart, builds the cards, hijacks the button |
| `src/page-bridge.js` | Main world: reads `window.Sidecart`, replaces `Sidecart.wiggle()` |
| `test/harness.html` | Offline stand-in for an album page (not loaded by the extension) |

### Why two scripts

A content script can't see the page's own JavaScript. The cart DOM has no
artwork and mashes everything into one string
(`"Hainbach, Vive, digital album"`), but `window.Sidecart.cart_items[]` has
`art_id`, `artist_name`, `item_id` and `item_type` as separate fields. So
`page-bridge.js` runs in the page's world (`"world": "MAIN"`) and passes a JSON
snapshot across with `CustomEvent`. It also replaces `Sidecart.wiggle()`, which
is what Bandcamp calls both from the menubar button and after an add-to-cart.

If the bridge ever fails to find `Sidecart`, the extension degrades: the cart is
still relocated and still laid out as cards, just without artwork and with
Bandcamp's original one-line labels, and "already in cart" falls back to
comparing item URLs.

## Page layouts

Album and track pages end with `#pgFt`, the "… recommends:" footer. Discography
and band pages (`artist.bandcamp.com`, `/music`) have no such footer at all, so
anchoring only to `#pgFt` left the cart in the sidebar there. Since `#pgFt`
always sits immediately after `#pgBd` anyway, the panel is placed *after the
page body* instead, which covers both layouts with one rule.

Discography pages also carry a `script[data-tralbum]`, but a stub one — no
`id`, no `item_type`, just the `/music` URL. The "already in cart" check
therefore requires those fields rather than trusting the blob's presence;
otherwise the cart button could claim *Already in cart* on a page that shows no
single item.

### Marking release grids

Grid tiles carry `data-item-id="album-<id>"` or `"track-<id>"`, which lines up
directly with the cart's `item_type` + `item_id`. Merch packages carry a
*package* id instead, so those fall back to matching the release URL — having
the vinyl in your cart marks the album's tile, which is the useful behaviour.

The badge is a `::after` on the tile rather than an injected element. Tiles are
already `position: relative` and define no `::after`, so there is nothing for
Bandcamp's Knockout bindings to clobber and nothing to clean up. It carries
`pointer-events: none`; marked and unmarked tiles hit-test identically.

## Colour on themed pages

Bandcamp styles the sidecart as `#sidecart { color: #333; background: #e6e6e6 }`
and the entire cart subtree inherits that `#333`. That is fine inside its own
light-grey sidebar panel, but once the cart is relocated onto a themed page the
grey background goes and the dark text stays. On
`rigeltheatre.bandcamp.com`, whose theme is `#pgBd { background: #2B2F36 }`,
that left `#333` on `#2B2F36` — a contrast ratio of **1.06:1**, i.e. invisible.

So the extension re-anchors the whole subtree to `#pgBd`'s own `color`, which is
exactly what artist themes set and what the track list, titles and about text
all inherit — it is the main section's text colour by definition. Dimmed text
(the format line, the tax note, the item count) is mixed *toward the surface*
with `color-mix` rather than dimmed with `opacity`, because a fixed opacity has
no predictable contrast on a dark background.

Two deliberate exceptions:

- **The Check out button keeps pure white text** regardless of the page. It has
  its own fill, which artists can theme (green on Rigel Theatre), and Bandcamp
  already labels it white.
- **If a theme pairs a text colour with a background it is unreadable against**,
  the extension drops to plain black or white. If even that falls short — a
  mid-grey background reads poorly against both — the panel takes its own
  surface instead of matching the page.

Measured worst-case contrast over every text element in the cart: **10:1** on a
default page, **5.45:1** on the Rigel Theatre theme, **8.21:1** on a
deliberately unreadable one. WCAG AA for body text is 4.5:1.

## Testing

```bash
python -m http.server 8787
```

Then open <http://127.0.0.1:8787/test/harness.html>. The harness reproduces the
real album-page DOM and pulls in Bandcamp's actual stylesheets, so the extension
CSS is exercised against the rules it has to override. Buttons at the top
simulate an add-to-cart wiggle and item removal.

Add `?theme=dark` to reproduce the Rigel Theatre colours, or `?theme=awful` for
a background that is unreadable against both black and white. Add
`?layout=disco` to drop `#pgFt` and swap in the stub tralbum blob, reproducing
a discography page. The parameters combine, e.g.
`?layout=disco&theme=dark`.

The harness also carries a real `#music-grid`: three of its five tiles match
the fixture cart (an album, a release whose *merch package* is in the cart, and
a track), two do not.

## Notes and limits

- Matches `*://*.bandcamp.com/*` only. Artists on custom domains serve the same
  pages from their own hostname — add it to `content_scripts[].matches` in
  `manifest.json` if you buy from one.
- Needs Chrome 111+ for `"world": "MAIN"` content scripts.
- Bandcamp ships two menubars (an older Knockout one and a newer Vue one). The
  button is matched by `aria-label="Cart"` plus a few fallbacks, which covers
  both; modifier-clicks (ctrl/cmd/shift) are deliberately left alone so
  open-in-new-tab still works.
- Pages with neither `#pgFt` nor `#pgBd` are left untouched — the cart stays in
  the sidebar and the button keeps its stock behaviour.
- `#sidecartSummary` and the *Check out* button are **moved** into the header,
  not rebuilt, so the country picker and the checkout handler keep working.
  Bandcamp replaces that summary's `innerHTML` on every cart update but keeps
  the element, so the move survives. The "taxes calculated at checkout" line is
  the exception: it lives inside that re-rendered HTML, so its text is mirrored
  into a separate node under the button and the original row is hidden.
