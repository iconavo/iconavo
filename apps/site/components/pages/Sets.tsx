import { IconavoProvider } from "@iconavo-ui/react";
import {
  CATALOG_TAG,
  getNames,
  getSets,
  orderSets,
  setStyles,
  showcase,
} from "../../lib/catalog";
import { setSummary } from "../../lib/catalog-view";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { SetsBrowser } from "../catalog/SetsBrowser";

/**
 * Каталог наборов /sets (ADR-0037): все наборы карточками с витриной 3 × 3, как на главной (компонент макета
 * «Icon Set Card»), фильтры по лицензии и стилю (ADR-0052).
 */
export async function Sets({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const cards = (
    await Promise.all(
      orderSets(Object.keys(sets)).map(async (id) => {
        const info = sets[id];
        if (info === undefined) return [];
        // Общая страница — метка catalog (ADR-0039): её сбрасывает выпуск любого набора.
        const names = await getNames(id, CATALOG_TAG);
        return [
          {
            ...setSummary(lang, id, info, setStyles(names)),
            samples: showcase(info.samples ?? [], names),
          },
        ];
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
