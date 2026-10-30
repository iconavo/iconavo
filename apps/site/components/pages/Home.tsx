import { Icon, IconavoProvider } from "@iconavo-ui/react";
import { getReleases, getSets, orderSets } from "../../lib/catalog";
import {
  releaseSummary,
  releaseView,
  setSummary,
} from "../../lib/catalog-view";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { SetCard } from "../catalog/SetCard";
import { PageLink } from "../PageLink";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** Новостей на главной — остальное в ленте /changelog. */
const HOME_RELEASES = 4;

/**
 * Главная (ADR-0037, решение владельца): поиск в центре, ниже популярные наборы и «Что нового». Поле
 * ведёт на страницу поиска — выдача там появится в шаге 3.
 */
export async function Home({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const ids = orderSets(Object.keys(sets));
  const cards = ids.flatMap((id) => {
    const info = sets[id];
    return info === undefined ? [] : [setSummary(lang, id, info)];
  });
  const news = (await getReleases())
    .slice(0, HOME_RELEASES)
    .map((r) => releaseView(lang, r, sets[r.prefix]?.name ?? r.prefix));
  const icons = await loadPageIcons(
    cards.flatMap((c) => c.samples.map((name) => `${c.id}:${name}`)),
  );
  return (
    <main id="content" className="container page home-page">
      <h1>Iconavo</h1>
      <p className="lead">{t.homeLead}</p>
      <search className="home-search">
        <form action={href(lang, "/search")} className="home-search-form">
          <label htmlFor="home-search" className="sr-only">
            {t.searchLabel}
          </label>
          <Input
            id="home-search"
            type="search"
            name="q"
            placeholder={t.searchPlaceholder}
            autoComplete="off"
          />
          <Button type="submit">{t.searchSubmit}</Button>
        </form>
      </search>
      <p>
        {t.homeBeta}{" "}
        <PageLink lang={lang} path="/docs">
          {t.homeDocs}
        </PageLink>
      </p>
      <section aria-labelledby="home-sets" className="page-section">
        <h2 id="home-sets">{t.homeSets}</h2>
        <IconavoProvider icons={icons}>
          <div className="set-grid">
            {cards.map((set) => (
              <SetCard key={set.id} lang={lang} set={set} heading="h3" />
            ))}
          </div>
        </IconavoProvider>
        <p>
          <PageLink lang={lang} path="/sets">
            {t.homeAllSets}{" "}
            <Icon icon="lucide:arrow-right" className="inline-block" />
          </PageLink>
        </p>
      </section>
      <section aria-labelledby="home-news" className="page-section">
        <h2 id="home-news">{t.homeNews}</h2>
        <ul className="news-lines">
          {news.map((r) => (
            <li key={r.id}>
              <PageLink lang={lang} path={`/${r.prefix}`}>
                {r.setName}
              </PageLink>{" "}
              · <time dateTime={r.iso}>{r.date}</time> ·{" "}
              {releaseSummary(lang, r)}
            </li>
          ))}
        </ul>
        <p>
          <PageLink lang={lang} path="/changelog">
            {t.homeAllNews}{" "}
            <Icon icon="lucide:arrow-right" className="inline-block" />
          </PageLink>
        </p>
      </section>
    </main>
  );
}
