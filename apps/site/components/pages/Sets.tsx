import { IconavoProvider } from "@iconavo-ui/react";
import { getSetStyles, getSets, orderSets } from "../../lib/catalog";
import { setSummary } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { SetsBrowser } from "../catalog/SetsBrowser";

/** Каталог наборов /sets (ADR-0037): все наборы карточками, фильтры по лицензии и стилю (ADR-0052). */
export async function Sets({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const cards = (
    await Promise.all(
      orderSets(Object.keys(sets)).map(async (id) => {
        const info = sets[id];
        return info === undefined
          ? []
          : [setSummary(lang, id, info, await getSetStyles(id))];
      }),
    )
  ).flat();
  const icons = await loadPageIcons(
    cards.flatMap((c) => c.samples.map((name) => `${c.id}:${name}`)),
  );
  return (
    <main id="content" className="container page">
      <h1>{t.setsTitle}</h1>
      <p className="lead">{t.setsLead}</p>
      <IconavoProvider icons={icons}>
        <SetsBrowser lang={lang} sets={cards} />
      </IconavoProvider>
    </main>
  );
}
