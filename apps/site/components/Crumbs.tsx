import { DICTIONARIES, type Lang } from "../lib/i18n";
import { PageLink } from "./PageLink";

/**
 * Хлебные крошки по макету: ссылки на уровни выше и текущая страница без ссылки. Общие у страницы набора,
 * страницы иконки и страницы поиска (редизайн, ADR-0038). На телефоне их заменяет ссылка «‹ …» (.set-back).
 */
export function Crumbs({
  lang,
  items,
  current,
  className,
}: {
  lang: Lang;
  /** Уровни выше: путь без префикса языка и подпись. */
  items: readonly { path: string; label: string }[];
  /** Текущая страница. */
  current: string;
  className?: string;
}) {
  const t = DICTIONARIES[lang];
  return (
    <nav
      aria-label={t.crumbsLabel}
      className={className === undefined ? "crumbs" : `crumbs ${className}`}
    >
      <ol>
        {items.map((item) => (
          <li key={item.path}>
            <PageLink lang={lang} path={item.path}>
              {item.label}
            </PageLink>
          </li>
        ))}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}
