# Changelog

`@iconavo-ui/icon`, `@iconavo-ui/react` and `@iconavo-ui/core` are released together, with one version. Versions 0.x are betas: the API may still change before 1.0. The documentation is at [iconavo.dev/docs](https://iconavo.dev/docs).

## 0.1.2 — 2026-11-25

Fixes from a code review. No API changes.

- Your own icon data (`addIcons`, `setLoader`): when a name is both an icon and an alias, the icon is used, as on Iconify. Before, the alias won.
- `<iconavo-icon>` no longer misses a redraw when attribute values contain commas.
- Very large sizes keep their exponent in the SVG: `1e30` no longer turns into `1e+3`. Tiny negative numbers are written as `0`, not `-0`.
- React: `dangerouslySetInnerHTML` passed to `Icon` from JavaScript is ignored, like `children`. Before, it could show up inside the placeholder while the icon loaded.
- The READMEs install the packages without `@next`: the `latest` tag follows each beta.

## 0.1.1 — 2026-10-30

Documentation only, no code changes.

- The HTML live example on StackBlitz now shows its icons: it runs on a small static server instead of the StackBlitz static template.

## 0.1.0 — 2026-10-30

The first public beta.

- The `<iconavo-icon>` tag for plain HTML and any framework, and the `Icon` component with `IconavoProvider` for React 18 and 19, including the Next.js App Router.
- Any icon by its name, `set:icon`, from five sets: Lucide, Tabler Icons, Material Symbols, Phosphor and Fluent Emoji Flat, with the same names and prefixes as on Iconify.
- Only the icons on the page are loaded, in batches from `api.iconavo.dev`. If it fails, icons come one by one from `cdn.iconavo.dev`, `cdn2.iconavo.dev` and `iconavo.b-cdn.net`.
- Icons take the size and color of the text. The `width`, `height`, `color`, `stroke-width`, `rotate`, `flip` and `inline` attributes change them, and `label` names an icon for screen readers.
- While an icon loads, its place is kept and a placeholder is shown, so the text next to it does not jump.
- Server rendering without a flash: `loadIcons` on the server and `IconavoProvider`.
- `configure`, `addIcons`, `setLoader` and `loadIcons`: your own hosts, icons without network requests, and your own icon source.
- A script for pages without a build step, on jsDelivr with an `integrity` hash.
- Works with a strict Content Security Policy and with Trusted Types.
