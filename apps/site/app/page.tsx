import { Icon } from "@iconavo-ui/react";
import Link from "next/link";

// Главная — пока минимальная: настоящая, с поиском и наборами, — в фазе 4 (ADR-0037).
export default function Home() {
  return (
    <main id="content" className="container home">
      <h1>Iconavo</h1>
      <p className="lead">
        Any icon from open icon sets by its name, with one HTML tag or one React
        component.
      </p>
      <p>
        The packages are in beta: install them with the <code>next</code> tag.
        The catalog with search in English and Russian is coming in 2027.
      </p>
      <p>
        <Link href="/docs" className="button">
          Read the docs{" "}
          <Icon icon="lucide:arrow-right" className="inline-block" />
        </Link>
      </p>
      <div className="showcase" aria-hidden="true">
        <Icon icon="lucide:house" className="inline-block" />
        <Icon icon="tabler:star" className="inline-block" />
        <Icon icon="material-symbols:home-rounded" className="inline-block" />
        <Icon icon="ph:smiley" className="inline-block" />
        <Icon icon="fluent-emoji-flat:rocket" className="inline-block" />
      </div>
    </main>
  );
}
