# @iconavo-ui/react

The `Icon` component for React and Next.js: any icon from the [Iconavo](https://iconavo.dev) catalog by its name. Only the icons on the page are loaded, in batches, and if a host fails, they come from the next one.

> **Beta.** Versions 0.x are published under the `next` tag. The API may still change before 1.0.

```sh
npm install @iconavo-ui/react@next
```

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

For server rendering without a flash, load the icons on the server and pass them to `IconavoProvider`:

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

Works with React 18 and 19, including the Next.js App Router. Props, the functions `configure`, `addIcons`, `setLoader` and `loadIcons`, and recipes are in the [full documentation](https://iconavo.dev/docs).

## License

The package code is [MIT](https://github.com/iconavo/iconavo/blob/main/LICENSE). The icons keep their authors' licenses, listed in the [full documentation](https://iconavo.dev/docs/security#license).
