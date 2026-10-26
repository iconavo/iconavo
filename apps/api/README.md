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
  "results": [
    { "icon": "lucide:trash", "tones": [], "variants": [] },
    { "icon": "ph:trash", "tones": [], "variants": ["trash-bold", "trash-duotone"] }
  ],
  "semantic": "full",
  "start": 0,
  "total": 4
}
```

- **Iconify-compatible fields.** `icons`, `total`, `limit` and `start` work as on Iconify: `total` is the number of icons in this response, and if it equals `limit`, request the next page with `start`.
- **`results`** groups each base icon with its style `variants` and Fluent Emoji skin `tones`. Variant and tone names are given without the set prefix.
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

- **Rate limit.** At most 60 uncached searches per minute from one address (IPv6 — per /64 network); more gives 429 with `Retry-After: 60`. Cached responses are not counted.
- **Caching.** Full results are cached for 5 minutes in browsers (`Cache-Control: public, max-age=300`); `pending` and `text` results are not cached. `X-Iconavo-Index` is the version of the search index.
- **Privacy.** Queries are not logged and IP addresses are not stored.

## Errors

Errors are short JSON with an HTTP status:

```json
{ "error": "set_not_found", "message": "Icon set \"foo\" not found", "status": 404 }
```

| Status | Codes |
| --- | --- |
| 400 | `icons_required`, `too_many_icons`, `duplicate_parameter`, `invalid_parameter`, `invalid_color`, `invalid_size`, `invalid_rotate`, `invalid_flip`, `invalid_mode`, `invalid_format`; search: `query_required`, `invalid_limit`, `invalid_start`, `invalid_prefix`, `invalid_license` |
| 404 | `not_found` (unknown address), `set_not_found`, `icon_not_found` |
| 405 | `method_not_allowed`: only `GET`, `HEAD` and `OPTIONS` are allowed |
| 429 | `rate_limited`: too many searches, retry after a minute |
| 503 | `storage_unavailable`: retry later. The static files on `cdn.iconavo.dev` and `cdn2.iconavo.dev` keep working. `search_unavailable`: the search service is down, retry later; icons keep working. |

## Differences from the Iconify API

Invalid values are rejected with 400 instead of being silently ignored. Search results group style variants into one result, and `/search` does not return the `collections` block yet. For example, `rotate=90` means 180° on Iconify; here it is an error. Use `90deg` or `1` instead.

These are not supported:
- custom CSS selectors, `pseudo` and `var`;
- JSONP;
- the legacy `/{set}/icons.json` address.

`/collections`, `/collection` and `/last-modified` are planned.

## Caching and headers

- Successful responses are cached for a week (`Cache-Control: public, max-age=604800`), search results for 5 minutes. Errors are cached for 5 minutes, outages and rate limits not at all.
- A new release of a set is served within a minute; the edge cache needs no purge.
- `X-Iconavo-Version` is the data version of the set, `X-Iconavo-Build` is the API build, and `X-Cache` says `HIT` or `MISS`.
- Every response allows any origin (`Access-Control-Allow-Origin: *`). SVG responses carry a strict `Content-Security-Policy`.
