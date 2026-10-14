# Bandcamp Cart Relocator

Chrome extension that moves Bandcamp's shopping cart from the right sidebar to the bottom of the main page, just above the recommendations footer.

The default cart pushes the artist photo and other sidebar content down as items are added. This extension gives the cart its own full-width panel, with items arranged as cards rather than a vertical list.

## Features

### Cart layout

* **Relocated cart:** Moves `#sidecart` below the main page content. On album and track pages, it appears above the "… recommends:" footer. On discography and band pages, it appears below the release grid.
* **Card layout:** Cart items appear in a wrapping row, with cover art, title, artist, format, quantity, price, and remove button.
* **Full-width cards:** At Bandcamp's standard 975px width, five cards fit per row.
* **Compact header:** Subtotal, additional contribution, and shipping destination appear below the *Shopping cart* heading. The checkout button sits at the top right, with the tax note beneath it.

The extension moves Bandcamp's existing cart elements rather than rebuilding them. Remove buttons, checkout, and the shipping country selector continue using Bandcamp's own handlers.

### Cart navigation

Clicking the menubar cart button normally scrolls to the top and shakes the sidebar cart.

The extension replaces this with a smooth scroll to the relocated cart and a brief highlight lasting about two seconds.

The same happens when an item is added to the cart.

### Items already in the cart

On album and track pages:

* The menubar cart button shows **Already in cart** when the current release is in the cart.
* The matching cart card gets an outline and an **On this page** label.
* Each buy option already in the cart gets a **✓ In cart** badge beside its buy button. Options are marked individually, so the vinyl can show the badge while the cassette does not.
* Albums and their merch packages are recognised separately through their item IDs.

On discography and band pages:

* Release tiles already represented in the cart get an **In cart** badge and an outlined cover.
* Merch packages also mark their associated album tile.
* The menubar button does not show **Already in cart**, since these pages display multiple releases rather than one item.

### Artist themes

The cart uses the artist page's background and text colours instead of imposing a fixed light theme.

Text contrast is checked at runtime. If the theme colours would make the cart unreadable, the extension adjusts them or gives the cart its own background.

See [Theme colours](#theme-colours) for details.

## Installation

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the extension folder.

After changing any extension file, reload the extension from `chrome://extensions`.

Requires Chrome 111 or newer.

## Files

| File                 | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `manifest.json`      | Manifest V3 configuration. Three content scripts, no permissions.                              |
| `src/cart.css`       | Cart styling, injected at `document_start` to prevent the original sidebar cart from flashing. |
| `src/content.js`     | Moves the cart, arranges its contents, and handles cart navigation.                            |
| `src/page-bridge.js` | Reads Bandcamp's cart data and overrides `Sidecart.wiggle()`.                                  |
| `test/harness.html`  | Offline album-page test harness. Not loaded by the extension.                                  |

## Implementation

### Accessing Bandcamp's cart data

Bandcamp's cart DOM does not contain artwork IDs or structured item details. Item labels also combine several fields into one string, such as:

`"Hainbach, Vive, digital album"`

The page's `window.Sidecart.cart_items[]` contains the individual fields:

* `art_id`
* `artist_name`
* `item_id`
* `item_type`

Chrome content scripts run in an isolated JavaScript environment, so `content.js` cannot access `window.Sidecart` directly.

`page-bridge.js` runs in the page's main world using `"world": "MAIN"`. It reads the cart data and sends a JSON snapshot to `content.js` through a `CustomEvent`.

The bridge also replaces `Sidecart.wiggle()`, which Bandcamp calls when the cart button is clicked or an item is added.

**If the bridge fails:** The cart still moves and uses the card layout. Artwork and structured item labels are unavailable, so the extension falls back to Bandcamp's original labels. Cart matching falls back to item URLs.

### Cart placement

Album and track pages have a `#pgFt` recommendations footer immediately after `#pgBd`.

Discography and band pages, including `artist.bandcamp.com` and `/music`, do not have `#pgFt`.

The extension therefore inserts the cart panel after the page body rather than anchoring it to `#pgFt`.

This places the cart correctly on both layouts without separate positioning rules.

### Detecting the current release

Album and track pages expose release information through `script[data-tralbum]`.

Discography pages also have this script, but it contains only a stub with the `/music` URL. It has no release `id` or `item_type`.

The **Already in cart** check requires both fields. This prevents the menubar badge from appearing on discography pages.

### Marking release grids

Release tiles use IDs in these formats:

* `data-item-id="album-<id>"`
* `data-item-id="track-<id>"`

These correspond directly to the cart's `item_type` and `item_id`.

Merch packages use a separate `package` ID, so the extension matches those by release URL instead. For example, adding an album's vinyl edition marks that album's tile as **In cart**.

The badge uses a CSS `::after` pseudo-element rather than an injected DOM node.

Bandcamp's tiles already use `position: relative` and do not define their own `::after`. This avoids interfering with Knockout bindings and requires no additional cleanup.

Badges also use `pointer-events: none`, so marked tiles behave exactly like unmarked tiles when clicked.

### Marking buy options

Bandcamp has no "add to cart" button in the page markup. One is injected only after a buy form is expanded, so the badge attaches to the control that opens that form, `h4.compound-button.main-button`, inside each `li.buyItem`.

Merch options carry their package ID in the DOM as:

```html
<span id="package-title-1587956078">
```

The extension matches on that rather than the sibling button's `data-pkg`, which is only an index into `TralbumData.packages`.

The digital option, `li.buyItem.digital`, is matched against the release itself.

Without the page bridge, the extension can still tell whether the release is in the cart, but not which merch option, so only the digital option is marked.

### Rows added without a reload

`CartItem.init` has two branches:

* On page load, rows are server-rendered as `<div class="item" id="sidecart_item_<id>">` and the item adopts that element by ID.
* When an item is added without a reload, `CartItem.render()` builds a bare `<div class="item">`. Neither it nor `add_item_to_list` ever sets an ID.

The extension keys cart data by `sidecart_item_<id>`, so a row added live matched nothing and appeared without artwork or a split title until the page was reloaded.

`page-bridge.js` holds each `CartItem.el`, the actual node, so it stamps the missing ID during every snapshot.

The content script also re-requests cart data whenever a row has no data yet, not only when the set of row IDs changes. Without that, a row that missed its stamp would stay undecorated until a reload.

## Theme colours

Bandcamp's default sidebar cart uses:

```css
#sidecart {
  color: #333;
  background: #e6e6e6;
}
```

Moving the cart onto an artist page removes the original grey background, but the dark text colour remains.

On `rigeltheatre.bandcamp.com`, for example, the main page background is `#2B2F36`. The inherited `#333` cart text has a contrast ratio of just **1.06:1**, making it nearly invisible.

The extension fixes this by using the computed text colour from `#pgBd`, which also controls the main page's track list, titles, and other text.

Secondary text, such as format labels, item counts, and tax notes, uses `color-mix` to blend toward the background. This gives more predictable contrast than applying a fixed opacity.

Two exceptions apply:

**Checkout button**

The button keeps white text because it has its own background colour, which artists can customise.

**Unreadable artist themes**

If the artist's text colour has insufficient contrast against the background, the extension switches to black or white.

If neither provides enough contrast, the cart gets its own background instead of matching the page.

### Measured contrast

Lowest measured text contrast across cart elements:

| Theme                              | Minimum contrast |
| ---------------------------------- | ---------------: |
| Default Bandcamp                   |             10:1 |
| Rigel Theatre                      |           5.45:1 |
| Deliberately unreadable test theme |           8.21:1 |

WCAG AA requires at least **4.5:1** for normal body text.

## Testing

Start a local server from the project folder:

```bash
python -m http.server 8787
```

Open:

`http://127.0.0.1:8787/test/harness.html`

The harness reproduces an album page's DOM and loads Bandcamp's actual stylesheets. This allows the extension CSS to be tested against Bandcamp's existing rules.

Buttons at the top simulate cart updates and item removal. **Add item (no id, as Bandcamp does)** reproduces `CartItem.render()`, appending a row with no ID so the live-add path can be tested without a reload.

Any uncaught page errors are collected into `window.__errs` for inspection.

### Test parameters

| Parameter       | Result                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| `?theme=dark`   | Uses the Rigel Theatre colours.                                                |
| `?theme=awful`  | Tests a background with poor contrast against both black and white.            |
| `?layout=disco` | Removes `#pgFt` and uses a stub tralbum object to simulate a discography page. |

Parameters can be combined:

`?layout=disco&theme=dark`

The harness also includes a `#music-grid` with five release tiles.

Three match items in the test cart:

* An album
* An album with a merch package in the cart
* A track

The other two remain unmarked.

It also includes a buy list with three options. The vinyl package and the digital album are in the test cart; the cassette is not.

## Notes and limitations

### Supported domains

The extension matches:

`*://*.bandcamp.com/*`

Artist pages hosted on custom domains are not included.

To support a custom domain, add it to `content_scripts[].matches` in `manifest.json`.

### Chrome version

Chrome 111 or newer is required for content scripts using `"world": "MAIN"`.

### Menubar compatibility

Bandcamp uses two menubar implementations: an older Knockout version and a newer Vue version.

The extension identifies the cart button through `aria-label="Cart"` and several fallback selectors.

Ctrl, Cmd, and Shift clicks retain their original behaviour, including opening the cart in a new tab.

### Unsupported page layouts

Pages without `#pgFt` or `#pgBd` are left unchanged.

The cart stays in the sidebar, and the menubar button keeps its original behaviour.

### Cart summary updates

The extension moves the existing `#sidecartSummary` and **Check out** button into the new header.

It does not recreate them, so Bandcamp's country selector and checkout handler continue working.

Bandcamp replaces the summary's `innerHTML` after cart updates but preserves the summary element itself. The relocated summary therefore survives these updates.

The tax note needs separate handling. Since Bandcamp recreates that line during updates, the extension copies its text into a separate element below the checkout button and hides the original row.
