import { getSets, orderSets } from "../../lib/catalog";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { SEARCH_EXAMPLES } from "../../lib/search";
import { SearchResults } from "../search/SearchResults";

/**
 * Страница поиска /search (шаг 3 фазы 4, ADR-0040): поле — в общей раскладке с главной (SearchHero),
 * здесь — фильтры и выдача. Наборы и лицензии для фильтров — из каталога при сборке, сам поиск — в
 * браузере: страница статическая и не индексируется никогда (ADR-0039).
 */
export async function SearchPage({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const ids = orderSets(Object.keys(sets));
  const options = ids.flatMap((id) => {
    const info = sets[id];
    return info === undefined ? [] : [{ id, title: info.name }];
  });
  const licenses = [
    ...new Set(ids.flatMap((id) => sets[id]?.license.spdx ?? [])),
  ].sort((a, b) => a.localeCompare(b, "en"));
  return (
    <>
      <noscript>
        <p>{t.searchNoScript}</p>
      </noscript>
      <SearchResults
        lang={lang}
        sets={options}
        licenses={licenses}
        examples={SEARCH_EXAMPLES[lang]}
      />
    </>
  );
}
