import { Icon } from "@iconavo-ui/react";
import Link from "next/link";
import type { DocPage as Page } from "../lib/docs";
import { Crumbs } from "./Crumbs";
import { Markdown } from "./Markdown";

// Страница документации в стиле сайта (решение владельца 23 ноября 2026, ADR-0050). Устройство прежнее:
// меню разделов — своей колонкой слева от текста, справа — оглавление «On this page»; на телефоне меню
// свёрнуто в <details> — работает и без JavaScript. Левая панель сайта остаётся с наборами. Вид — из частей
// сайта: шапка как у страницы набора (крошки, заголовок, линия), строки меню — как строки левой панели,
// текст из README — шрифтами проекта, внизу — «назад» и «дальше» карточками и правка на GitHub.

function Pages({ pages, current }: { pages: readonly Page[]; current: Page }) {
  return (
    <ul>
      {pages.map((p) => (
        <li key={p.slug}>
          <Link
            href={p.path}
            className="docs-nav-link"
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
    <main id="content" className="page docs-page">
      <header className="docs-head">
        <Crumbs
          lang="en"
          items={[{ path: "/docs", label: "Docs" }]}
          current={page.title}
        />
        <h1 className="docs-title">{page.title}</h1>
      </header>
      <div className="docs-body">
        <nav className="docs-nav" aria-label="Documentation">
          <Pages pages={pages} current={page} />
        </nav>
        <details className="docs-menu">
          <summary>
            <Icon icon="material-symbols:menu" className="docs-menu-icon" />
            Menu
            <Icon
              icon="material-symbols:keyboard-arrow-down"
              className="docs-menu-chevron"
            />
          </summary>
          <nav aria-label="Documentation">
            <Pages pages={pages} current={page} />
          </nav>
        </details>
        <article className="docs-main prose">
          <Markdown blocks={page.blocks} />
          <nav className="docs-pager" aria-label="Previous and next pages">
            {prev ? (
              <Link href={prev.path} rel="prev" className="docs-pager-card">
                <span className="docs-pager-label">
                  <Icon
                    icon="material-symbols:arrow-back"
                    className="docs-pager-icon"
                  />
                  Previous
                </span>
                <span className="docs-pager-title">{prev.title}</span>
              </Link>
            ) : null}
            {next ? (
              <Link
                href={next.path}
                rel="next"
                className="docs-pager-card docs-pager-next"
              >
                <span className="docs-pager-label">
                  Next
                  <Icon
                    icon="material-symbols:arrow-forward"
                    className="docs-pager-icon"
                  />
                </span>
                <span className="docs-pager-title">{next.title}</span>
              </Link>
            ) : null}
          </nav>
          <p className="docs-edit">
            <a href={page.edit}>
              <Icon icon="material-symbols:edit" className="docs-edit-icon" />
              Edit this page on GitHub
            </a>
          </p>
        </article>
        {contents.length > 0 ? (
          <nav className="toc" aria-labelledby="toc-title">
            <p id="toc-title" className="toc-title">
              On this page
            </p>
            <ul>
              {contents.map((h) => (
                <li
                  key={h.id}
                  className={h.depth === 3 ? "toc-sub" : undefined}
                >
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </main>
  );
}
