import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import type { DocPage as Page } from "../lib/docs";
import { Markdown } from "./Markdown";

// Страница документации: меню разделов, текст из README, оглавление страницы, назад и дальше, правка на
// GitHub. На телефоне меню свёрнуто в <details> — работает и без JavaScript.

function Pages({ pages, current }: { pages: readonly Page[]; current: Page }) {
  return (
    <ul>
      {pages.map((p) => (
        <li key={p.slug}>
          <Link
            href={p.path}
            aria-current={p.slug === current.slug ? "page" : undefined}
          >
            {p.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DocPage({
  page,
  pages,
}: {
  page: Page;
  pages: readonly Page[];
}) {
  const index = pages.findIndex((p) => p.slug === page.slug);
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const contents = page.headings.filter((h) => h.depth <= 3);
  return (
    <div className="container docs">
      <nav className="docs-nav" aria-label="Documentation">
        <Pages pages={pages} current={page} />
      </nav>
      <details className="docs-menu">
        <summary>
          <Icon icon="lucide:menu" className="inline-block" /> Menu
        </summary>
        <nav aria-label="Documentation">
          <Pages pages={pages} current={page} />
        </nav>
      </details>
      <main id="content" className="docs-main prose">
        <h1>{page.title}</h1>
        <Markdown blocks={page.blocks} />
        <nav className="pager" aria-label="Previous and next pages">
          {prev ? (
            <Link href={prev.path} rel="prev">
              <Icon icon="lucide:arrow-left" className="inline-block" />{" "}
              Previous: {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={next.path} rel="next">
              Next: {next.title}{" "}
              <Icon icon="lucide:arrow-right" className="inline-block" />
            </Link>
          ) : null}
        </nav>
        <p className="edit">
          <a href={page.edit}>
            <Icon icon="lucide:pencil" className="inline-block" /> Edit this
            page on GitHub
          </a>
        </p>
      </main>
      {contents.length > 0 ? (
        <nav className="toc" aria-labelledby="toc-title">
          <p id="toc-title" className="toc-title">
            On this page
          </p>
          <ul>
            {contents.map((h) => (
              <li key={h.id} className={h.depth === 3 ? "toc-sub" : undefined}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
