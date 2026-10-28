import { Icon, IconavoProvider, loadIcons } from "@iconavo-ui/react";
import Link from "next/link";
import names from "../icons.json";

// A second page with its own IconavoProvider inside the one from the layout. After a client-side
// navigation, its icons come with the page data, so they don't flash either.
export default async function More() {
  const icons = await loadIcons(names.more);
  return (
    <main>
      <h1>Second page</h1>
      <section data-check="nested">
        <h2>From this page's server component</h2>
        <IconavoProvider icons={icons}>
          <div className="row">
            {names.more.map((name) => (
              <Icon key={name} icon={name} width={32} data-name={name} />
            ))}
          </div>
        </IconavoProvider>
      </section>
      <section data-check="browser">
        <h2>Loaded in the browser</h2>
        <div className="row">
          {names.moreBrowser.map((name) => (
            <Icon key={name} icon={name} width={32} data-name={name} />
          ))}
        </div>
      </section>
      <p>
        <Link href="/">
          <Icon icon="lucide:arrow-right" flip="horizontal" /> Back
        </Link>
      </p>
    </main>
  );
}
