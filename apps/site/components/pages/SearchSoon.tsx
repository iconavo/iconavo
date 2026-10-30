import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

// Заглушка страницы поиска: поле в шапке уже ведёт сюда, сама выдача — шаг 3 фазы 4 (ADR-0040).
// Страница статическая и запрос не читает.
export function SearchSoon({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <main id="content" className="container home">
      <h1>{t.searchTitle}</h1>
      <p>{t.searchSoon}</p>
      <p>
        <PageLink lang={lang} path="/docs">
          {t.searchDocs}
        </PageLink>
      </p>
    </main>
  );
}
