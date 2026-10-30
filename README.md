# Iconavo

Icons from open icon sets by their names, with one HTML tag or one React component. Only the icons on the page are loaded. Iconavo is in beta: versions are 0.x, and the API may still change before 1.0.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@iconavo-ui/icon@0.1.1/dist/iconavo-icon.js" integrity="sha384-4jwgOS9euDQZj2iLfo9bjbv1WQK9EisJKx++vmGcOJPvz8bhFi0CB3Xs56eAxak3"></script>
<iconavo-icon icon="lucide:house"></iconavo-icon>
```

- **Documentation:** [iconavo.dev/docs](https://iconavo.dev/docs)
- **Live examples:** [HTML and React on StackBlitz, Next.js with `create-next-app`](https://iconavo.dev/docs#live-examples)
- **Changelog:** [iconavo.dev/docs/changelog](https://iconavo.dev/docs/changelog)

## Packages

| Package | What it is |
| --- | --- |
| [`@iconavo-ui/icon`](packages/icon) | The `<iconavo-icon>` tag for plain HTML and any framework |
| [`@iconavo-ui/react`](packages/react) | The `Icon` component for React and Next.js |
| [`@iconavo-ui/core`](packages/core) | Their shared core; it comes with them |
| `@iconavo-ui/icons-{set}` | Whole icon sets in IconifyJSON format, to use without a network |

The sets are Lucide, Tabler Icons, Material Symbols, Phosphor and Fluent Emoji Flat, with the same names and prefixes as on [Iconify](https://iconify.design).

## Repository

| Folder | What is inside |
| --- | --- |
| `packages` | The packages above, the pipeline that builds the icon data, and its schemas |
| `apps/api` | The edge API at `api.iconavo.dev` |
| `apps/site` | The site at `iconavo.dev` |
| `data` | The icon sets, built by the pipeline from their authors' sources |
| `sources` | Where each set comes from |
| `examples` | Live examples and a Next.js example |
| `docs` | Project docs: the plan and decisions, in Russian |

## License

The code is [MIT](LICENSE). The icons keep their authors' licenses: ISC for Lucide (icons that came from Feather, MIT), MIT for Tabler Icons, Phosphor and Fluent Emoji Flat, and Apache-2.0 for Material Symbols. The full texts are in [`data`](data).
