import { configure } from "@iconavo-ui/react";

// Your own hosts, if any. Next.js builds two module graphs: Server Components and Client Components
// (which also render on the server). Each graph has its own copy of the icon store, so this module is
// imported from both: from the layout, for loadIcons on the server, and from a Client Component, for
// the browser. Here the hosts come from NEXT_PUBLIC_ICONAVO_API and NEXT_PUBLIC_ICONAVO_CDN, which only
// the repository's automated check sets; without them the default hosts are used.
const api = process.env.NEXT_PUBLIC_ICONAVO_API;
const cdn = process.env.NEXT_PUBLIC_ICONAVO_CDN;
if (api) configure({ api: [api], cdn: cdn ? [cdn] : [] });
