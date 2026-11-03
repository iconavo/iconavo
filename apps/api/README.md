# Iconavo edge API

Icon data, SVG, CSS and semantic search from `https://api.iconavo.dev`, compatible with the [Iconify API](https://iconify.design/docs/api/) addresses. The API is public and free, with no key. It runs on Cloudflare Workers on top of the versioned static files of `cdn.iconavo.dev`.

Icon names follow `set:icon`, for example `lucide:heart`. Both parts use lowercase Latin letters, digits and single hyphens.

## Icon data: `/{set}.json?icons=a,b`

Returns several icons of one set in [IconifyJSON](https://iconify.design/docs/types/iconify-json.html) format.

```
GET https://api.iconavo.dev/lucide.json?icons=heart,home,nope
```

```json
{
  "aliases": { "home": { "parent": "house" } },
  "height": 24,
  "icons": { "heart": { "body": "…" }, "house": { "body": "…" } },
  "lastModified": 1792571709,
  "not_found": ["nope"],
  "prefix": "lucide",
  "width": 24
}
```

- **Names.** Separate names with commas only. Duplicates are ignored, and the order of names does not change the response. At most 100 names per request.
- **Aliases.** An alias comes with its whole chain in `aliases`, plus the icon at the end of the chain in `icons`.
- **Hidden icons** are returned with `"hidden": true`: names are never removed.
- **`not_found`** lists the names that are missing. It appears only when something is missing.

## SVG: `/{set}/{icon}.svg`

```
GET https://api.iconavo.dev/lucide/heart.svg?color=red&height=64
```

Without parameters, the SVG is byte for byte the static file from `cdn.iconavo.dev`: height `1em`, width in proportion.

| Parameter | Values |
| --- | --- |
| `color` | Replaces `currentColor`. Accepts hex with or without `#` (`ff0000`, `#f00`), a color name (`red`), or `rgb()`, `rgba()`, `hsl()`, `hsla()`. Has no effect on multicolor icons. |
| `width`, `height` | A number with an optional CSS unit (`24`, `2em`, `50%`), `auto` for the icon's own size, or `unset` / `none` to omit the attribute. If only one is set, the other follows the aspect ratio. |
| `rotate` | `90deg`, `180deg`, `270deg`, or quarter turns `1`, `2`, `3`. |
| `flip` | `horizontal`, `vertical`, or both, comma-separated. Flip is applied before rotation. |
| `box` | `1` adds a transparent rectangle the size of the view box, for editors that ignore `viewBox`. |
| `download` | `1` sends the file as an attachment. |

## CSS: `/{set}.css?icons=a,b`

```html
<link rel="stylesheet" href="https://api.iconavo.dev/lucide.css?icons=heart,house">
<span class="icon--lucide icon--lucide--heart"></span>
```

- **Monochrome icons** are drawn with a mask and take the text color.
- **Multicolor icons** are drawn as a background.

| Parameter | Values |
| --- | --- |
| `color` | Same values as for SVG. Switches to background mode unless `mode` is set. |
| `mode` | `mask` or `background` (`bg`). By default it is detected from the icon. |
| `square` | `1` makes non-square icons square. |
| `format` | `expanded` (default), `compact` or `compressed`. |
| `download` | `1` sends the file as an attachment. |

## Search: `/search?query=…`

Hybrid search over all icon sets: words (names, tags, Russian and English synonyms) plus meaning (embeddings). It understands Russian and English and finds icons by what they show, not only by their names.

```
GET https://api.iconavo.dev/search?query=trash%20can&limit=4
```

```json
{
  "icons": ["lucide:trash", "tabler:trash", "ph:trash", "material-symbols:delete"],
  "limit": 4,
  "matched": true,
  "results": [
    { "icon": "lucide:trash", "styles": { "outline": "trash" }, "tones": [], "variants": [] },
    {
      "icon": "ph:trash",
      "styles": { "duotone": "trash-duotone", "filled": "trash-fill", "outline": "trash" },
      "tones": [],
      "variants": ["trash-bold", "trash-duotone", "trash-fill"]
    }
  ],
  "semantic": "full",
  "start": 0,
  "total": 4
}
```

- **Iconify-compatible fields.** `icons`, `total`, `limit` and `start` work as on Iconify: `total` is the number of icons in this response, and if it equals `limit`, request the next page with `start`.
- **`results`** groups each base icon with its style `variants` and Fluent Emoji skin `tones`. Variant and tone names are given without the set prefix.
- **`styles`** in each result maps a common style — `outline`, `filled`, `duotone` or `color` — to the name to show in that style (see `styles` of [`/collection`](#icons-of-a-set-collectionprefix)). It can be an alias: Material Symbols draws many icons the same way in both styles.
- **`icons`** lists what to show: the name in the requested `style`; for an exact match with a variant or a skin tone, that name itself (`house-fill`, not `house`); otherwise the base icon.
- **`matched`** is `false` when no icon matched the words or the exact name, so the results only look close in meaning. Show a hint to rephrase the query.
- **Exact names first.** A query that looks like an icon name (`house`, `lucide:house`) puts the matching icons first and marks them with `"exact": true`. With a `set:` prefix, only the exact match is limited to that set; the other results come from all sets (use `prefix` to filter them).
- **`semantic`** says how complete the results are:
  - `full` — words and meaning;
  - `pending` — the meaning of a new query is still being computed: these are word matches only, not cached; repeat the request in about a second to get full results;
  - `text` — the embedding model is unavailable right now: word matches only.

| Parameter | Values |
| --- | --- |
| `query` | Required, up to 100 characters, in any language. |
| `limit` | 1–96 results, 64 by default. |
| `start` | Index of the first result; `start` + `limit` is at most 1000. |
| `prefix`, `prefixes` | One icon set, or several separated by commas. |
| `palette` | `1` — multicolor sets only, `0` — monochrome sets only. |
| `license` | SPDX license ids separated by commas, for example `MIT,ISC`. |
| `style` | One common style: `outline`, `filled`, `duotone` or `color`. Only icons that have it, shown in it. |

- **Rate limit.** At most 60 uncached searches per minute from one address (IPv6 — per /64 network); more gives 429 with `Retry-After: 60`. Pages can read `Retry-After`. Cached responses are not counted.
- **Caching.** Full results are cached for 5 minutes in browsers (`Cache-Control: public, max-age=300`); `pending` and `text` results are not cached. `X-Iconavo-Index` is the version of the search index.
- **Privacy.** Queries are not logged and IP addresses are not stored.

## Icon details: `/icon?icon=…`

Everything about one icon: its set, author and license, the style variants of its card, skin tones, whether stroke width can change it, descriptions and synonyms in English and Russian, tags and icons similar in meaning. The Iconavo site shows it in the icon panel and on the icon page.

```
GET https://api.iconavo.dev/icon?icon=ph:house-bold
```

```json
{
  "icon": "ph:house-bold",
  "set": {
    "prefix": "ph",
    "name": "Phosphor",
    "author": { "name": "Phosphor Icons", "url": "https://github.com/phosphor-icons/core" },
    "license": { "title": "MIT", "spdx": "MIT", "url": "https://spdx.org/licenses/MIT.html" },
    "palette": false
  },
  "card": "ph:house",
  "style": "outline",
  "variants": [
    { "style": "outline", "icons": ["ph:house-thin", "ph:house-light", "ph:house", "ph:house-bold"] },
    { "style": "filled", "icons": ["ph:house-fill"] },
    { "style": "duotone", "icons": ["ph:house-duotone"] }
  ],
  "tones": [],
  "strokes": false,
  "description": { "en": "…", "ru": "…" },
  "synonyms": { "en": ["home", "…"], "ru": ["дом", "…"] },
  "tags": ["home", "…"],
  "similar": ["tabler:home", "lucide:house", "…"]
}
```

- **Names are full**, `set:icon`, everywhere in the response.
- **`alias`** appears when you asked for an old name: `icon` is the icon it leads to, `alias` is what you asked for.
- **`hidden: true`** — the author removed the icon. It still works by name, but it is not listed in the catalog or search.
- **`variants`** are the styles of the card in the order of the common scale (`outline`, `filled`, `duotone`, `color`), with the variants of each style in the order the set shows them: Phosphor weights, Material Symbols shapes. A Material Symbols name that draws the same as another variant is listed only if it is the main name of a style.
- **`style`** is the style of this icon; **`strokes`** is `true` when `stroke-width` changes it — Lucide and the outline icons of Tabler.
- **`description`, `synonyms`** — both languages, or `null` until a new icon is described. **`card`** and **`style`** are `null` for hidden icons and for icons not yet in the search index.
- **`credits`** lists another author whose icon this is, under their license: Lucide icons that come from Feather (MIT). **`set.credits`** lists such parts for the whole set, on every icon of it — for one attribution line per set.
- **`similar`** — up to 12 icons from all sets that are closest in meaning, each in the style of this icon when it has one.

| Parameter | Values |
| --- | --- |
| `icon` | Required: `set:icon`, such as `lucide:house`. |

- **Rate limit.** At most 300 uncached requests per minute from one address; more gives 429 with `Retry-After: 60`.
- **Caching.** 5 minutes in browsers (`Cache-Control: public, max-age=300`). `X-Iconavo-Version` is the version of the icon set, `X-Iconavo-Index` — of the search index, `X-Iconavo-Content` — a fingerprint of all data of the set: it changes with any change of the set, descriptions included.

## Icon sets: `/collections`

Lists the icon sets with their author, license and showcase icons, as on Iconify: an object of [IconifyInfo](https://iconify.design/docs/types/iconify-info.html) by set prefix.

```
GET https://api.iconavo.dev/collections?prefix=lucide
```

```json
{
  "lucide": {
    "author": { "name": "Lucide Contributors", "url": "https://github.com/lucide-icons/lucide" },
    "height": 24,
    "license": { "spdx": "ISC", "title": "ISC", "url": "https://spdx.org/licenses/ISC.html" },
    "name": "Lucide",
    "palette": false,
    "samples": ["house", "search", "settings", "user", "heart", "star"],
    "total": 1998,
    "version": "81875c8"
  }
}
```

- **`total`** counts visible icons, style variants included; aliases and hidden icons are not counted.
- **`version`** is the author's version: the npm package version, or the first 7 characters of the git commit.
- **`palette`** is `true` for multicolor sets.

| Parameter | Values |
| --- | --- |
| `prefix` | One set prefix. |
| `prefixes` | Several prefixes separated by commas. A prefix ending with `-` matches the start of a name: `mdi-` finds `mdi-light`. |

## Icons of a set: `/collection?prefix=…`

Lists all icon names of one set, as on Iconify: visible icons by the author's categories, hidden icons and aliases.

```
GET https://api.iconavo.dev/collection?prefix=ph&info=true
```

```json
{
  "info": { "name": "Phosphor", "license": { "spdx": "MIT", "text": "MIT License…", "title": "MIT" } },
  "aliases": { "activity-bold": "pulse-bold" },
  "categories": { "arrows": ["arrow-arc-left", "arrow-arc-left-bold"] },
  "prefix": "ph",
  "styles": { "duotone": ["duotone"], "filled": ["fill"], "outline": ["thin", "light", "", "bold"] },
  "suffixes": { "": "Regular", "bold": "Bold", "thin": "Thin" },
  "title": "Phosphor",
  "total": 9072
}
```

- **Visible icons** are the names in `categories` plus `uncategorized`. An icon can be in several categories. Sets without the author's categories have only `uncategorized`.
- **`hidden`** lists icons the author removed: they still work by name but are not listed.
- **`aliases`** maps an old name or an identical variant to its icon.
- **`suffixes`** names the style variants: `house-bold` is the `Bold` variant of `house`.
- **`styles`** (Iconavo's addition) puts every suffix into one of the common styles — `outline`, `filled`, `duotone` or `color` — in display order. Weights and shapes, such as Phosphor `thin` or Material Symbols `rounded`, are variants within a style. The main variant of a style is the unsuffixed one if it belongs to the style, otherwise the first listed.
- **`info`**, with `info=true`, is the set's IconifyInfo plus the full license: `license.text`, `license.notice` when the author has one, `license.source` and `license.revision`. It comes as the first field.

| Parameter | Values |
| --- | --- |
| `prefix` | Required, the set prefix. |
| `info` | `1` or `true` adds `info`. |
| `chars` | Accepted and ignored: no set here is an icon font. |

## Last modified: `/last-modified`

When each set was last released, in Unix seconds, as on Iconify. The same `prefix` and `prefixes` parameters as `/collections`; unknown sets give an empty object.

```json
{ "lastModified": { "lucide": 1793359690, "tabler": 1793180395 } }
```

## Changelog: `/changelog`

What changed in recent releases of the sets, newest first: up to the 100 latest releases. This address is Iconavo's own; Iconify has none.

```
GET https://api.iconavo.dev/changelog?prefix=lucide
```

```json
{
  "releases": [
    {
      "added": ["circle-letter-a", "circle-letter-b"],
      "changed": ["dollar-sign"],
      "date": "2026-10-30T11:28:10Z",
      "hidden": ["circle-parking"],
      "prefix": "lucide",
      "previous": "c3b3f7a7",
      "renamed": { "bold": "letter-b" },
      "revision": "81875c8c42d2320fa5123b37fee3554f4ca2bddc",
      "total": 1998,
      "version": "8d1ee623"
    }
  ]
}
```

- **Lists** appear only when not empty: `added`, `changed` (the drawing changed), `restored`, `hidden`, `renamed` (old name → new name) and `aliases` (new alias → its icon).
- **`version`** is the data version of the set, `previous` the one before it, and `revision` the author's npm version or git commit.
- The same `prefix` and `prefixes` parameters as `/collections`.

## Errors

Errors are short JSON with an HTTP status:

```json
{ "error": "set_not_found", "message": "Icon set \"foo\" not found", "status": 404 }
```

| Status | Codes |
| --- | --- |
| 400 | `icons_required`, `too_many_icons`, `duplicate_parameter`, `invalid_parameter`, `invalid_color`, `invalid_size`, `invalid_rotate`, `invalid_flip`, `invalid_mode`, `invalid_format`; search: `query_required`, `invalid_limit`, `invalid_start`, `invalid_prefix`, `invalid_license`, `invalid_style`; `/icon`: `icon_required`, `invalid_icon`; `/collection`: `prefix_required` |
| 404 | `not_found` (unknown address), `set_not_found`, `icon_not_found` |
| 405 | `method_not_allowed`: only `GET`, `HEAD` and `OPTIONS` are allowed |
| 429 | `rate_limited`: too many searches or icon details, retry after a minute |
| 503 | `storage_unavailable`: retry later. The static files on `cdn.iconavo.dev` and `cdn2.iconavo.dev` keep working. `search_unavailable`: the search service is down, retry later; icons keep working. `/icon` needs it too. |

## Differences from the Iconify API

Invalid values are rejected with 400 instead of being silently ignored. Search results group style variants into one result, and `/search` does not return the `collections` block yet. For example, `rotate=90` means 180° on Iconify; here it is an error. Use `90deg` or `1` instead.

These are not supported:
- custom CSS selectors, `pseudo` and `var`;
- JSONP;
- the legacy `/{set}/icons.json` address;
- the `pretty` parameter: responses are always compact.

In `/collection?info=true`, `info.license` also carries the full license text; `/collection` also has `styles`; `/changelog` is Iconavo's own address.

## Caching and headers

- Successful responses are cached for a week (`Cache-Control: public, max-age=604800`); search results, `/icon` and `/collections`, `/collection`, `/last-modified` and `/changelog` for 5 minutes, because their addresses carry no version. Errors are cached for 5 minutes, outages and rate limits not at all.
- A new release of a set is served within a minute; the edge cache needs no purge.
- `X-Iconavo-Version` is the data version of the set (on `/collections`, `/last-modified` and `/changelog` — of the whole catalog), `X-Iconavo-Build` is the API build, and `X-Cache` says `HIT` or `MISS`. `/collection` and `/icon` also send `X-Iconavo-Content`: a fingerprint of all data of the set, descriptions included.
- `Server-Timing` on icon, SVG and CSS responses shows where the time went: `cache` (`hit` or `miss`), `files` (icon files found in the edge cache / looked up), `r2` (files read from storage) and `total`, all in milliseconds. `Timing-Allow-Origin: *` lets pages read it.
- Every response allows any origin (`Access-Control-Allow-Origin: *`) and lets pages read `Retry-After`, `Server-Timing`, `X-Cache`, `X-Iconavo-Build`, `X-Iconavo-Content`, `X-Iconavo-Index` and `X-Iconavo-Version`. SVG responses carry a strict `Content-Security-Policy`.
