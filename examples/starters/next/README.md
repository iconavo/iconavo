# Iconavo with Next.js

The App Router with server rendering. The layout loads the icons above the fold with `loadIcons` and passes them to `IconavoProvider`, so they are in the server HTML and don't flash. Other icons load in the browser after hydration.

Create a project from this example and run it:

```sh
npx create-next-app@latest --example https://github.com/iconavo/iconavo/tree/main/examples/starters/next my-icons
cd my-icons
npm run dev
```

StackBlitz can't run Next.js 16 yet, so this example has no live link.

Documentation: [iconavo.dev/docs](https://iconavo.dev/docs)
