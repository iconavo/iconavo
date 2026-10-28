import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import { Client } from "./client";
import names from "./icons.json";

// A Server Component that renders icons: Icon is a Client Component, so it works here too.
export default function Home() {
  return (
    <main>
      <h1>Iconavo with Next.js</h1>

      <section data-check="server">
        <h2>From the server</h2>
        <p>
          The layout loads these icons with <code>loadIcons</code> and passes
          them to <code>IconavoProvider</code>, so they are already in the HTML.
        </p>
        <div className="row">
          {names.server.map((name) => (
            <Icon key={name} icon={name} width={32} data-name={name} />
          ))}
        </div>
        <div className="row">
          <Icon icon="lucide:heart" width={48} color="crimson" />
          <Icon icon="lucide:heart" width={48} strokeWidth={1} />
          <Icon icon="lucide:arrow-right" width={48} rotate={1} />
          <Icon icon="lucide:arrow-right" width={48} flip="horizontal" />
          <Icon
            icon="lucide:heart"
            width={48}
            color="var(--brand)"
            data-check="var"
          />
        </div>
        <p className="row">
          The same icon with gradients twice, each with its own IDs:
          <Icon icon="fluent-emoji-flat:violin" width={48} />
          <Icon icon="fluent-emoji-flat:violin" width={48} />
        </p>
        <div className="row">
          <button type="button" data-check="label">
            <Icon icon="lucide:trash" label="Delete" />
          </button>
          <button type="button" data-check="label">
            <Icon icon="lucide:trash" /> Delete
          </button>
        </div>
      </section>

      <section data-check="browser">
        <h2>Loaded in the browser</h2>
        <p>
          These icons are not in <code>IconavoProvider</code>: the server draws
          a placeholder of the right size, and the browser loads them after
          hydration.
        </p>
        <div className="row">
          {names.browser.map((name, i) => (
            <span key={name} className="spot">
              <Icon
                icon={name}
                width={32}
                placeholder={i % 2 ? "spinner" : "skeleton"}
                data-name={name}
              />
              {name}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2>Inline</h2>
        <p>
          A <Icon icon="lucide:heart" inline /> line of text with an inline icon
          from the server.
        </p>
      </section>

      <Client />

      <p>
        <Link href="/more" data-check="link">
          Next page <Icon icon="lucide:arrow-right" />
        </Link>
      </p>
    </main>
  );
}
