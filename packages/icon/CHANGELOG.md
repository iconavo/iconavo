# Changelog

`@iconavo-ui/icon`, `@iconavo-ui/react` and `@iconavo-ui/core` are released together, with one version. Versions 0.x are betas under the `next` tag: the API may still change before 1.0. The documentation is at [iconavo.dev/docs](https://iconavo.dev/docs).

## 0.1.0 — 2026-10-29

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
