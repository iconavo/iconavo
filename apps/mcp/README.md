# Iconavo MCP server

A remote [MCP](https://modelcontextprotocol.io) server for AI assistants. It searches open-source icons by meaning in any language and returns ready-to-paste code for the [Iconavo packages](https://iconavo.dev/docs). Every response includes the license and author of the icons.

- **Address:** `https://mcp.iconavo.dev/mcp`
- **Transport:** Streamable HTTP, stateless. It works with clients of protocol revision 2026-07-28 and with 2025 clients.
- **Access:** no sign-in and no key; limits are per address (see below).
- **Sets:** Lucide, Tabler Icons, Material Symbols, Phosphor and Fluent Emoji Flat. All of them allow commercial use with attribution.

> **Beta.** Tool names stay as they are. Tools change only by adding new optional inputs and output fields, so connected clients keep working.

## Connect

**Claude Code:**

```sh
claude mcp add --transport http iconavo https://mcp.iconavo.dev/mcp
```

**Claude** (claude.ai and Claude Desktop): Settings → Connectors → Add custom connector, then paste the address.

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "iconavo": { "url": "https://mcp.iconavo.dev/mcp" }
  }
}
```

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "iconavo": { "type": "http", "url": "https://mcp.iconavo.dev/mcp" }
  }
}
```

**ChatGPT:** in developer mode, add a connector with the address and no authentication.

Then ask in your own words, for example: "Find an icon for a share button" or "Add icons for home, search and profile in the style of the house icon we use".

## Tools

| Tool | What it does |
| --- | --- |
| `search_icons` | Finds icons by meaning in any language, or by exact name. Returns names, styles, licenses and authors, plus one PNG grid of numbered previews |
| `get_icon` | Code for one icon: the `<iconavo-icon>` web component by default, React `<Icon>`, or raw SVG or a CSS class on request. Size, color, stroke width and rotation |
| `get_matching_set` | Several icons that look alike — one set, one style, one variant — for a group of concepts, optionally matching an icon you already use |
| `get_usage` | How to install and set up the package: HTML with npm, HTML without a build step, React or Next.js |
| `list_sets` | The icon sets with authors, licenses, styles and sample icons |
| `pick_icon` | Shows a grid of 12 icons right in the chat (MCP Apps). The user picks an icon, its color, stroke width and kind of code, and the assistant gets ready code |

### `search_icons`

- `query` — what the icon should show, in any language (`"shopping cart"`, `"корзина"`), or an exact name such as `"lucide:house"`.
- `sets` — optional list of set prefixes.
- `style` — optional: `outline`, `filled`, `duotone` or `color`.
- `license` — optional SPDX identifier, such as `MIT`.
- `limit` — 1–24, default 12. `offset` — for the next page: the response gives `nextOffset` while there are more results, up to the 1000th.
- `preview` — attach the PNG grid; default `true`. Set it to `false` if your model cannot see images.

The grid numbers the icons in the same order as the list: cell N is result N. Results are ranked by meaning; if the meaning model is unavailable, they are ranked by words and the response says so. The response also links to the same results on iconavo.dev, with the same filters.

### `get_icon`

- `icon` — the full name from `search_icons`, such as `"lucide:house"`. Old names also work: the response gives the current name.
- `format`:
  - `html` (default) — the `<iconavo-icon>` web component. It works in any framework and in plain HTML.
  - `react` — `<Icon>` from `@iconavo-ui/react`.
  - `svg` — raw SVG markup with an attribution comment and a link to the same SVG on the Iconavo API.
  - `css` — a CSS class with the icon as a mask (multicolor icons as a background image) and a `<span>` that uses it. No package needed.
- `size` — in pixels, default 24.
- `color` — hex, such as `#e11d48`; omit it to inherit the text color.
- `strokeWidth` — changes line icons only.
- `rotate` — 0, 90, 180 or 270.

The response also includes:

- the set, its license and author, and the attribution text to keep;
- the same drawing in other styles;
- similar icons in the same style;
- a description;
- the icon's page on iconavo.dev.

Settings that do not apply are reported, not dropped silently — for example, a color for a multicolor emoji.

### `get_matching_set`

- `concepts` — 2–10 concepts in any language, such as `["home", "search", "notifications", "profile"]`.
- `like` — optional: an icon already used in the project. Its set, style and variant are matched: with `"ph:house-bold"`, every icon comes as `ph:*-bold`.
- `set`, `style` — optional. Without them, the set and style that cover the most concepts are chosen.
- `format`, `size`, `color`, `strokeWidth` — as in `get_icon`.

For each concept, the response returns an icon, its code and two alternatives. It also lists the concepts that have no icon in the set; a concept without letters or digits, such as `"—"`, is listed there too. As in `get_icon`, settings that do not apply are reported — and so is a `style` that `like` overrides.

### `get_usage`

- `framework`:
  - `html` (default) — the web component from npm;
  - `script` — without a build step: two lines in `<head>`, with an `integrity` hash;
  - `react`;
  - `next` — the Next.js App Router with icons in the server HTML.
- `packageManager` — `npm`, `pnpm` or `yarn`.

The text comes from the package documentation, so it always matches the published version.

### `list_sets`

`licenseText: true` adds the full license text of each set. It is long, so it is off by default.

### `pick_icon`

An interactive icon picker for clients that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps), such as Claude and ChatGPT.

- `query`, `sets`, `style`, `license` — as in `search_icons`. The grid always shows 12 icons, each in the style it was found in.
- `format` — the kind of code selected first: `html` (default), `react`, `svg` or `css`. The user can change it.
- `size` — in pixels, as in `get_icon`.
- `color` — optional starting color, such as a brand color. The user can change it.

The grid follows the chat's theme; its text is always in English. Under the icons the user can set:

- **Color** — for single-color sets;
- **Stroke width** — for line icons; the previews change right away;
- **the kind of code** — the same buttons as the icon panel on iconavo.dev. SVG, CSS, HTML and React work; SVG+CSS, Vue, Svelte, Solid and Astro are marked "Soon".

Then the user presses **Select**:

- the ready code in the chosen format, with the color and stroke width, the license and the attribution go into the assistant's context;
- a request for that code goes to the chat, such as "Use lucide:house (Lucide, outline, #E11D48, stroke 1.5) — give me the React code." ChatGPT sends it at once; Claude puts it in the message box, where the user can add to it.

The picker is the `ui://picker/{version}` resource. The version changes with every new build, so clients never show a stale picker. It loads nothing from the network: the icons arrive with the tool result.

Clients without MCP Apps get the same numbered list and PNG grid as `search_icons`. The assistant then asks the user for a number and calls `get_icon`.

## Limits

| Tool | Calls per minute from one address |
| --- | --- |
| `search_icons`, `get_matching_set`, `pick_icon` | 60 |
| `get_icon` | 300 |
| `get_usage`, `list_sets` | not limited |

- Repeated identical calls are answered from the cache and do not count.
- Over the limit, the tool returns an error that tells the assistant to wait about a minute.
- Some clients, such as Claude on the web and ChatGPT, call the server from their own machines. All their users then share one address and one limit.

## Licenses

- The server code is [MIT](https://github.com/iconavo/iconavo/blob/main/LICENSE).
- Every icon keeps the license of its set: ISC for Lucide (with icons from Feather, MIT), MIT for Tabler Icons, Phosphor and Fluent Emoji Flat, Apache-2.0 for Material Symbols. Keep the attribution that the tools return.
- The full texts are on [iconavo.dev/licenses](https://iconavo.dev/licenses).

## Privacy

- No accounts and no keys.
- The server logs only its own errors. It keeps no request logs and no IP addresses; your address is used only by the rate-limit counters.
- Search queries go to the search service and to an embeddings model, the same as the search on [iconavo.dev](https://iconavo.dev). Results are cached for up to a week.

## Development

The server runs on Cloudflare Workers and uses the official MCP TypeScript SDK. Inside, it runs the same code as the [Iconavo API](../api/README.md), on the same storage. See ADR-0044 in [`docs/adr`](../../docs/adr).

```sh
pnpm mcp build     # the bundle in dist-mcp/
pnpm mcp preview   # http://127.0.0.1:4285/mcp, with the same restrictions as Workers
pnpm mcp check --base=http://127.0.0.1:4285   # all tools with the official MCP client
pnpm mcp picker    # http://127.0.0.1:4286 — the pick_icon grid in a test host
pnpm mcp picker --check   # the grid in Chrome, Firefox and WebKit
```
