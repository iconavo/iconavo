# Iconavo icons

Any icon from the [Iconavo](https://iconavo.dev) catalog by its name, with one HTML tag or one React component. Only the icons on the page are loaded, in batches, and if a host fails, they come from the next one.

> **Beta.** Versions 0.x are published under the `next` tag. The API may still change before 1.0. See the [changelog](https://iconavo.dev/docs/changelog).

| Package | What it is |
| --- | --- |
| `@iconavo-ui/icon` | The `<iconavo-icon>` tag for plain HTML and any framework |
| `@iconavo-ui/react` | The `Icon` component for React and Next.js |

Icon names are `set:icon`, for example `lucide:house`. Both parts use lowercase Latin letters, digits and single hyphens. The sets are Lucide (`lucide`), Tabler Icons (`tabler`), Material Symbols (`material-symbols`), Phosphor (`ph`) and Fluent Emoji Flat (`fluent-emoji-flat`), with the same names and prefixes as on [Iconify](https://iconify.design).

## Install

**Without a build step**, add two lines to `<head>`:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@0.1.1/dist/iconavo-icon.js" integrity="sha384-4jwgOS9euDQZj2iLfo9bjbv1WQK9EisJKx++vmGcOJPvz8bhFi0CB3Xs56eAxak3"></script>
<style>iconavo-icon:not(:defined) { display: inline-block; width: 1em; height: 1em; }</style>
```

The script is a single ES module with everything inside. With the `integrity` hash, the browser runs it only if it is exactly the published file. The style keeps a `1em` square for each icon until the script has run, so the text next to icons does not jump; it does not know about the `width` and `height` attributes.

**With npm**:

```sh
npm install @iconavo-ui/icon@next
```

```js
import "@iconavo-ui/icon"; // registers <iconavo-icon>
```

**For React**:

```sh
npm install @iconavo-ui/react@next
```

With pnpm or yarn: `pnpm add @iconavo-ui/react@next`, `yarn add @iconavo-ui/react@next`. Until 1.0, new versions are published under the `next` tag, so install with `@next`.

## Examples

### HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <script type="module" src="https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@0.1.1/dist/iconavo-icon.js" integrity="sha384-4jwgOS9euDQZj2iLfo9bjbv1WQK9EisJKx++vmGcOJPvz8bhFi0CB3Xs56eAxak3"></script>
    <style>iconavo-icon:not(:defined) { display: inline-block; width: 1em; height: 1em; }</style>
  </head>
  <body>
    <a href="/"><iconavo-icon icon="lucide:house"></iconavo-icon> Home</a>
  </body>
</html>
```

### React

```jsx
import { Icon } from "@iconavo-ui/react";

export function HomeLink() {
  return (
    <a href="/">
      <Icon icon="lucide:house" /> Home
    </a>
  );
}
```

### Size and color

An icon is as tall as the text (`1em`) and takes the text color, so CSS sizes and colors it like text:

```html
<h2 style="font-size: 32px; color: crimson">
  <iconavo-icon icon="lucide:heart"></iconavo-icon> Favorites
</h2>
```

Or set them on the icon:

```html
<iconavo-icon icon="lucide:heart" width="32" color="crimson" stroke-width="1.5"></iconavo-icon>
```

```jsx
<Icon icon="lucide:heart" width={32} color="crimson" strokeWidth={1.5} />
```

With only `width` or only `height`, the other side follows the icon's proportions. `stroke-width` changes the lines of line icons, such as Lucide and the outline icons of Tabler; other icons ignore it.

### A label for screen readers

Icons are decorative by default, and screen readers skip them. An icon that is the only content of a button needs a `label`:

```html
<button type="button">
  <iconavo-icon icon="lucide:trash" label="Delete"></iconavo-icon>
</button>

<button type="button">
  <iconavo-icon icon="lucide:trash"></iconavo-icon> Delete
</button>
```

A screen reader announces both buttons as "Delete". In the first one, the name comes from the label; in the second, from the text, and the icon is skipped. The label is not shown as a tooltip.

### Your own host

```js
import { configure } from "@iconavo-ui/icon";

configure({
  api: ["https://icons.example.com/api"],
  cdn: ["https://icons.example.com/static"],
});
```

Each list replaces ours, so icons now load only from `icons.example.com`. To keep our hosts as a fallback, add them to the lists yourself. Call `configure()` before the first icon renders, in the same module that imports the package. See also [What your own host must serve](#what-your-own-host-must-serve).

Without a build step, import `configure` from the same address as the script, in a single module:

```html
<script type="module">
  import { configure } from "https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@0.1.1/dist/iconavo-icon.js";
  configure({ api: ["https://icons.example.com/api"], cdn: ["https://icons.example.com/static"] });
</script>
```

## Live examples

Open an example in the browser, change the code, and the preview updates:

| Example | What it shows |
| --- | --- |
| [HTML](https://stackblitz.com/github/iconavo/iconavo/tree/main/examples/starters/html?file=index.html&startScript=dev) | The tag without a build step: size, color and a label |
| [React](https://stackblitz.com/github/iconavo/iconavo/tree/main/examples/starters/react?file=src%2FApp.tsx&startScript=dev) | The `Icon` component in a Vite app, and an icon that changes with state |

The examples run on [StackBlitz](https://stackblitz.com).

The Next.js example shows icons in the server HTML with `IconavoProvider`, and icons loaded in the browser. StackBlitz can't run Next.js 16 yet, so create a project from it on your computer:

```sh
npx create-next-app@latest --example https://github.com/iconavo/iconavo/tree/main/examples/starters/next my-icons
```

The code of all examples is in [`examples/starters`](https://github.com/iconavo/iconavo/tree/main/examples/starters).

## Attributes and props

| Attribute | React prop | Values | Default |
| --- | --- | --- | --- |
| `icon` | `icon` | Icon name, `set:icon` | Required |
| `width`, `height` | `width`, `height` | A number of pixels, a CSS length (`2em`, `1.5rem`, `24px`), or `auto` for the icon's own size | Height `1em`, width in proportion |
| `color` | `color` | Any CSS color | The text color |
| `stroke-width` | `strokeWidth` | A positive number, in units of the icon's grid | The icon's own: 2 for Lucide and Tabler |
| `rotate` | `rotate` | `90deg`, `180deg`, `270deg`, or quarter turns `1`, `2`, `3` | No rotation |
| `flip` | `flip` | `horizontal`, `vertical`, or both: `horizontal,vertical` | No flip |
| `inline` | `inline` | Present or absent; `true` or `false` in React | Absent |
| `label` | `label` | Text for screen readers | None: the icon is decorative |
| `placeholder` | `placeholder` | `skeleton`, `spinner` or `none` | `skeleton`, or the value from `configure()` |
| `noobserver` | — | Present or absent | Absent: an icon loads when it comes near the visible part of the page |

- **Multicolor icons** (Fluent Emoji Flat) keep their colors: `color` and `stroke-width` do not change them.
- **Rotation and flip** are drawn inside the SVG, not with a CSS transform, so the icon's box follows the drawing: at 90° and 270° a non-square icon swaps its width and height. Flip is applied before rotation.
- **`inline`** lowers the icon by `0.125em`, so it sits on the text baseline like a letter.
- **Invalid values** are ignored: the icon renders without that setting, and the console shows one warning with the allowed values.
- **In React**, sizes also take numbers (`width={32}`), and `rotate` also takes the numbers `1`–`3`. The component always renders an `<svg>`, also while the icon loads, and other props such as `className`, `style`, event handlers and `ref` go to it.
- **Color in React** is an attribute of the `<svg>`, so CSS that targets the `<svg>` itself, such as a `text-*` class in `className`, takes precedence over it.
- **With Tailwind CSS**, its base styles make every `<svg>` a block, so an `Icon` sits on a line of its own. Add `className="inline-block"` to the icon, or `svg { display: inline-block; }` to your base styles. The `<iconavo-icon>` tag is not affected.

## Functions

`@iconavo-ui/icon` and `@iconavo-ui/react` export the same four functions and share one store of icons and settings for the whole page. Both also export the TypeScript types `IconavoIconSet`, `IconavoIcon` and `IconavoAlias`, the same as in the data packages.

### `configure(options)`

```ts
function configure(options: {
  api?: string[];
  cdn?: string[];
  placeholder?: "skeleton" | "spinner" | "none";
  dev?: boolean;
}): void;
```

| Option | What it sets | Default |
| --- | --- | --- |
| `api` | Hosts that answer batch requests, like the [Iconify API](https://iconify.design/docs/api/icon-data.html) | `["https://api.iconavo.dev"]` |
| `cdn` | Hosts with the static layout of `cdn.iconavo.dev`, one icon per request | `["https://cdn.iconavo.dev", "https://cdn2.iconavo.dev", "https://iconavo.b-cdn.net"]` |
| `placeholder` | What icons show while they load | `"skeleton"` |
| `dev` | Development mode: a dashed frame in place of a missing icon | Detected, see [Missing icons](#missing-icons) |

- A list replaces the default one, and `[]` turns that kind of host off.
- Options you leave out keep their values.
- A change applies to requests made after the call, so call `configure()` before the first icon renders.

### `addIcons(data)`

```ts
function addIcons(data: IconavoIconSet | IconavoIconSet[]): void;
```

Adds icons in [IconifyJSON](https://iconify.design/docs/types/iconify-json.html) format, one icon set per object. Added icons are never requested from the network. They replace icons with the same names, and icons already on the page redraw. It accepts:

- a batch from our API saved to a file, for example `https://api.iconavo.dev/lucide.json?icons=house,heart`;
- `icons` from the data packages `@iconavo-ui/icons-{set}`, which hold whole sets;
- IconifyJSON from Iconify's `@iconify-json/*` packages;
- your own icons under your own prefix.

```js
import { addIcons } from "@iconavo-ui/icon";

addIcons({
  prefix: "acme",
  width: 24,
  height: 24,
  icons: {
    logo: { body: '<path fill="currentColor" d="M3 3h18v18H3z"/>' },
  },
});
```

```html
<iconavo-icon icon="acme:logo"></iconavo-icon>
```

A prefix follows the same rules as icon names; an invalid one throws an error. Names listed in `not_found` are remembered as missing.

### `loadIcons(names)`

```ts
function loadIcons(names: string[]): Promise<IconavoIconSet[]>;
```

Loads icons ahead of time: before a menu opens, or on the server for [server rendering](#nextjs-and-server-rendering). It resolves with one IconifyJSON object per set, holding the loaded icons and, in `not_found`, the missing names.

It never rejects. It makes one pass over the hosts, at most 5 seconds, and leaves out icons that failed to load; components in the browser retry them later. An invalid name goes to `not_found` of its set with a warning; a name without a valid set prefix gets only the warning.

### `setLoader(prefix, loader)`

```ts
function setLoader(
  prefix: string,
  loader: ((names: string[]) => Promise<IconavoIconSet | null>) | null,
): void;
```

Loads one set from your own source instead of the hosts: a server with another format, a database, generated icons. It works for our sets too.

- The core calls `loader` with the names it needs, in batches and without duplicates.
- The result is added as with `addIcons`. Names missing from it, or a `null` result, count as missing icons.
- A rejected promise, or one that does not settle within 5 seconds, counts as a failed host and is retried.
- `null` instead of a function removes the loader.

```js
import { setLoader } from "@iconavo-ui/icon";

setLoader("acme", async (names) => {
  const response = await fetch(`/icons/acme.json?icons=${names.join(",")}`);
  if (!response.ok) throw new Error(`Icons: HTTP ${response.status}`);
  return response.json();
});
```

### `IconavoProvider` (React)

```tsx
<IconavoProvider icons={icons}>{children}</IconavoProvider>
```

Passes icons loaded on the server (`IconavoIconSet[]`, as returned by `loadIcons`) to the components inside, for the server HTML and for hydration. See [Next.js and server rendering](#nextjs-and-server-rendering).

## Loading and errors

### While an icon loads

- The icon keeps a `1em` × `1em` square, or the size you set, so the text around it does not jump. With only one side set, the square has that side; with `auto`, it is `1em` until the icon's own size is known.
- If loading takes longer than 150 ms, a placeholder appears: a skeleton by default, a spinner with `placeholder="spinner"`, nothing with `placeholder="none"`. When the system asks to reduce motion, placeholders do not animate.
- The tag loads an icon when it comes within half a screen of the visible part of the page, so it is usually ready when you scroll to it; `noobserver` turns this off. The React component loads it when it mounts.
- Inside a scrolling container, and in an iframe from another site, such as a live example's preview, the half-screen margin does not apply: the tag loads an icon when it becomes visible.
- A tag that has never come near the visible part of the page prints empty. Add `noobserver` to icons that must print.
- In React, placeholders, `inline` and the development frame come from a stylesheet that the package adds when the page's scripts run. Until then, server-rendered HTML keeps an empty box of the icon's size, and `inline` icons sit on the baseline.

### Batches and hosts

- Icons requested at the same moment (in one tick of the event loop) go out together: one request per set, with sorted names, split into several requests when the address would be longer than 500 characters or hold more than 100 names. For example, 100 Lucide icons take 4 requests. An icon that is already loading is not requested again.
- The hosts are tried in order: `api.iconavo.dev` sends batches, then `cdn.iconavo.dev`, `cdn2.iconavo.dev` and `iconavo.b-cdn.net` send one icon per request, using their `manifest.json` to find the current version of a set.
- If `api.iconavo.dev` does not answer within 1.5 seconds, the same icons are also requested from the static hosts. Static hosts send one icon per request, so the core waits longer before switching to them. Between hosts of the same kind (API hosts or static hosts), the wait is 750 ms. A host that fails outright is not waited for. The first host that has the icon wins; an icon counts as missing only when every host says it does not have it. After 5 seconds without an answer, the attempt has failed.
- A failed attempt is repeated after 1, 2 and 4 seconds while the icon is on the page, and the placeholder stays meanwhile. After the last attempt, the icon looks like a missing one and the console shows one warning with the error, but the icon is requested again the next time it appears.

### Missing icons

- If no host has the icon, its place stays empty, and the console shows one warning per name.
- A missing name is remembered and not requested again while the page is open.
- In development mode, a dashed frame marks the place. Development mode is on in the development build of your bundler (for example Vite or webpack) and, without a bundler, on pages opened from `localhost`, `127.0.0.1`, `[::1]` or a `file:` address. `configure({ dev: true })` or `configure({ dev: false })` overrides it.
- Names never break: renamed icons still answer to their old names, and icons that their authors removed still render.

## Recipes

### Without network requests

Save the icons you use to a file, add them with `addIcons`, and turn the hosts off:

```sh
curl -o src/icons/lucide.json "https://api.iconavo.dev/lucide.json?icons=heart,house,search"
```

```js
import { addIcons, configure } from "@iconavo-ui/icon";
import lucide from "./icons/lucide.json";

addIcons(lucide);
configure({ api: [], cdn: [] });
```

Icons in your bundle also stay the same when the sets update. Whole sets come in the npm packages `@iconavo-ui/icons-{set}`, but they are large: from about 0.1 MB (Lucide) to 1.5 MB (Material Symbols) gzipped.

### Next.js and server rendering

```tsx
// app/layout.tsx is a Server Component
import { IconavoProvider, loadIcons } from "@iconavo-ui/react";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const icons = await loadIcons(["lucide:house", "lucide:search"]);
  return (
    <html lang="en">
      <body>
        <IconavoProvider icons={icons}>{children}</IconavoProvider>
      </body>
    </html>
  );
}
```

```tsx
// any Server or Client Component inside
import { Icon } from "@iconavo-ui/react";

<Icon icon="lucide:house" />;
```

- Icons passed to `IconavoProvider` are in the server HTML, so there is no flash.
- Other icons render the placeholder on the server and load in the browser after hydration. The server and the browser draw the same markup, so there are no hydration warnings.
- Icons added with `addIcons` at the top level of a module appear right after hydration. Do not call `addIcons` during rendering: on the server, memory is shared by all requests.
- Next.js builds Server Components and Client Components separately, and each build has its own copy of the icon store. Call `configure`, `setLoader` and top-level `addIcons` in a module that both your layout and a Client Component import: the layout's copy serves `loadIcons` on the server, the other one serves the browser.

### `loadIcons` on the server

- `loadIcons` waits for the hosts, at most 5 seconds, so a page rendered on request sends its first byte only after the icons arrive.
- Loaded icons stay in the server's memory: later calls return them without a request.
- In the Next.js App Router, a layout that reads no request data, such as cookies or headers, is rendered at build time, so its icons load once, during the build.
- On pages rendered on request, pass to `IconavoProvider` only the icons above the fold; the others load in the browser.

### What your own host must serve

- **`api`**: `GET {host}/{set}.json?icons=a,b` returns IconifyJSON with the requested icons, the alias chains of the requested aliases, and the missing names in `not_found`. An unknown set is a 404.
- **`cdn`**: `GET {host}/manifest.json` returns `{"sets": {"lucide": {"version": "…"}}}`, and `GET {host}/v/{version}/{set}/{icon}.json` returns IconifyJSON with one icon. A version is made of letters, digits, `.`, `_` and `-`, for example `1.2.0`. A missing icon file is a 404; a 403 counts as missing too, as on S3 without list access.
- **Both** answer plain `GET` requests with `Access-Control-Allow-Origin` that allows your site. The core sends no custom headers, so there are no preflight requests.

The simplest host is a caching reverse proxy to `api.iconavo.dev` and `cdn.iconavo.dev`. A self-hosted [Iconify API](https://iconify.design/docs/api/hosting.html) answers batches too.

The full reference of our API, with the SVG and CSS addresses, is in the [edge API documentation](https://github.com/iconavo/iconavo/blob/main/apps/api/README.md).

## Hosts, privacy and security

- **Requests** go to `https://api.iconavo.dev`, `https://cdn.iconavo.dev`, `https://cdn2.iconavo.dev` and `https://iconavo.b-cdn.net`, in this order, and to the next host only if the previous one fails, is slow or does not have the icon. They are plain `GET` requests for icon data, without cookies.
- **Nothing is stored** in the browser: no cookies, no localStorage, only the browser's HTTP cache.
- **Content Security Policy.** With a strict policy, allow:

  ```
  connect-src https://api.iconavo.dev https://cdn.iconavo.dev https://cdn2.iconavo.dev https://iconavo.b-cdn.net;
  script-src https://cdn.jsdelivr.net;
  trusted-types iconavo;
  ```

  `script-src` is needed only for the script tag, and `trusted-types` only if you enforce Trusted Types.
- **Script integrity.** The script line from [Install](#install) has an exact version and an `integrity` hash: if jsDelivr ever served different bytes, the browser would not run them. When you move to a new version, copy the whole line again.
- **Trust.** Icon data becomes part of your page as SVG markup. Load icons only from hosts, files and loaders that you trust as much as your scripts.

## Coming from Iconify

- Rename the tag: `<iconify-icon icon="lucide:house">` becomes `<iconavo-icon icon="lucide:house">`. In React, import `Icon` from `@iconavo-ui/react` instead of `@iconify/react`. Names and prefixes are the same for our sets.
- `icon`, `width`, `height`, `rotate`, `flip`, `inline` and `noobserver` work as on Iconify, but invalid values are not guessed: `rotate="90"` is ignored with a warning. Use `90deg` or `1`, as in Iconify's documentation.
- Use `flip="horizontal"` or `flip="vertical"` instead of the `hFlip` and `vFlip` attributes, and CSS or the `color` attribute for color.
- For screen readers, use `label` instead of your own `role` and `aria-label`.
- `addCollection` becomes `addIcons`, `addAPIProvider` becomes `configure({ api, cdn })`, and custom icon loaders become `setLoader`. `loadIcons` returns a promise with the icon data instead of taking a callback.
- Only the SVG mode exists so far: there is no `mode` attribute.

## Browsers and frameworks

- The last two versions of Chrome, Edge, Firefox and Safari.
- ES modules only; there is no CommonJS build.
- React 18 and 19, including the Next.js App Router.
- Size, gzipped: the tag with its core is at most 7 KB, the React component with the core at most 7.5 KB, not counting React. CI fails if a change goes over.

## License

The package code is [MIT](https://github.com/iconavo/iconavo/blob/main/LICENSE). The icons keep their authors' licenses:

| Set | Prefix | License |
| --- | --- | --- |
| Lucide | `lucide` | ISC; icons that came from Feather, MIT |
| Tabler Icons | `tabler` | MIT |
| Material Symbols | `material-symbols` | Apache-2.0 |
| Phosphor | `ph` | MIT |
| Fluent Emoji Flat | `fluent-emoji-flat` | MIT |

The full texts are in the [`data`](https://github.com/iconavo/iconavo/tree/main/data) folder and in the `@iconavo-ui/icons-{set}` packages.
