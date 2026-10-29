import { Icon } from "@iconavo-ui/react";
import { useState } from "react";

export function App() {
  const [liked, setLiked] = useState(false);
  return (
    <main>
      <h1>Iconavo with React</h1>
      <p>
        Change an icon name below, for example <code>lucide:house</code> to{" "}
        <code>lucide:rocket</code>, and the preview updates.
      </p>

      <h2>A link with an icon</h2>
      <p>
        <a href="/">
          <Icon icon="lucide:house" /> Home
        </a>
      </p>

      <h2>Size and color</h2>
      <p>An icon is as tall as the text and takes the text color:</p>
      <p className="large">
        <Icon icon="lucide:heart" /> Favorites
      </p>
      <p>Or set them on the icon:</p>
      <p>
        <Icon
          icon="lucide:heart"
          width={32}
          color="crimson"
          strokeWidth={1.5}
        />
      </p>

      <h2>A label for screen readers</h2>
      <p>A screen reader announces both buttons as “Delete”.</p>
      <p>
        <button type="button">
          <Icon icon="lucide:trash" label="Delete" />
        </button>{" "}
        <button type="button">
          <Icon icon="lucide:trash" /> Delete
        </button>
      </p>

      <h2>An icon that changes with state</h2>
      <p>
        <button
          type="button"
          aria-pressed={liked}
          onClick={() => setLiked(!liked)}
        >
          <Icon
            icon={liked ? "ph:heart-fill" : "ph:heart"}
            color={liked ? "crimson" : undefined}
          />{" "}
          Like
        </button>
      </p>

      <h2>Five icon sets</h2>
      <p className="sets">
        <Icon icon="lucide:house" /> <Icon icon="tabler:star" />{" "}
        <Icon icon="material-symbols:home-rounded" /> <Icon icon="ph:smiley" />{" "}
        <Icon icon="fluent-emoji-flat:rocket" />
      </p>

      <p>
        <a href="https://iconavo.dev/docs">Read the documentation</a>
      </p>
    </main>
  );
}
