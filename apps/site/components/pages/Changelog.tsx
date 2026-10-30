import { IconavoProvider } from "@iconavo-ui/react";
import { getReleases, getSets, orderSets } from "../../lib/catalog";
import { releaseView } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { ReleasesBrowser } from "../catalog/ReleasesBrowser";

/**
 * Лента «Что нового» /changelog (ADR-0018, ADR-0037): выпуски наборов из /changelog edge API, свежие
 * сверху. Смены лицензии в ленте нет (решение владельца 30 октября 2026): её текущий текст — на /licenses.
 */
export async function Changelog({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const releases = (await getReleases()).map((r) =>
    releaseView(lang, r, sets[r.prefix]?.name ?? r.prefix),
  );
  const icons = await loadPageIcons(
    releases.flatMap((r) => r.preview.map((name) => `${r.prefix}:${name}`)),
  );
  return (
    <main id="content" className="container page">
      <h1>{t.newsTitle}</h1>
      <p className="lead">{t.newsLead}</p>
      <IconavoProvider icons={icons}>
        <ReleasesBrowser
          lang={lang}
          releases={releases}
          sets={orderSets(Object.keys(sets)).map((id) => ({
            id,
            name: sets[id]?.name ?? id,
          }))}
        />
      </IconavoProvider>
    </main>
  );
}
