import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, href, type Lang } from "../lib/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Поле поиска в шапке: обычная форма, работает и без JavaScript; страница поиска — шаг 3 фазы 4. */
export function SearchField({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    // <search> — ориентир «поиск» для скринридеров (HTML, есть во всех браузерах из ADR-0034).
    <search className="header-search">
      <form action={href(lang, "/search")} className="header-search-form">
        <label htmlFor="site-search" className="sr-only">
          {t.searchLabel}
        </label>
        <Input
          id="site-search"
          type="search"
          name="q"
          placeholder={t.searchPlaceholder}
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label={t.searchSubmit}
        >
          <Icon icon="lucide:search" />
        </Button>
      </form>
    </search>
  );
}
