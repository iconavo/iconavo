# @iconavo-ui/core

The shared core of the [Iconavo](https://iconavo.dev) icon packages: loading icons in batches, the icon store and rendering.

> **Beta.** Versions 0.x are published under the `next` tag. The API may still change before 1.0. See the [changelog](https://iconavo.dev/docs/changelog).

You don't need to install it yourself: it comes with the package you use.

| Package | What it is |
| --- | --- |
| [`@iconavo-ui/icon`](https://www.npmjs.com/package/@iconavo-ui/icon) | The `<iconavo-icon>` tag for plain HTML and any framework |
| [`@iconavo-ui/react`](https://www.npmjs.com/package/@iconavo-ui/react) | The `Icon` component for React and Next.js |

Both export the functions of the core — `configure`, `addIcons`, `setLoader` and `loadIcons` — and share one store of icons and settings for the whole page. The functions are described in the [documentation](https://iconavo.dev/docs/reference#functions).

`@iconavo-ui/core/internal` is for these packages and our edge API. It can change in any version.

## License

[MIT](https://github.com/iconavo/iconavo/blob/main/LICENSE).
