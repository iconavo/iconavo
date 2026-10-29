import { Icon } from "@iconavo-ui/react";
import { LikeButton } from "./like-button";

export default function Home() {
  return (
    <main>
      <h1>Iconavo with Next.js</h1>

      <h2>From the server</h2>
      <p>
        These icons are loaded in <code>app/layout.tsx</code>, so they are in
        the server HTML and don&apos;t flash:
      </p>
      <p className="large">
        <Icon icon="lucide:house" /> <Icon icon="lucide:search" />{" "}
        <Icon icon="lucide:settings" />{" "}
        <Icon icon="lucide:heart" color="crimson" />
      </p>

      <h2>Loaded in the browser</h2>
      <p>
        Icons that are not in <code>IconavoProvider</code> load after hydration.
        Until then, they keep their space:
      </p>
      <p className="large">
        <Icon icon="fluent-emoji-flat:rocket" /> <Icon icon="ph:smiley" />{" "}
        <Icon icon="tabler:star" />{" "}
        <Icon icon="material-symbols:home-rounded" />
      </p>

      <h2>A Client Component</h2>
      <p>
        <LikeButton />
      </p>

      <p>
        <a href="https://iconavo.dev/docs">Read the documentation</a>
      </p>
    </main>
  );
}
