import { IconavoProvider } from "@iconavo-ui/react";
import {
  getNames,
  getSets,
  groupSets,
  type SetGroupId,
  setStyles,
  showcase,
} from "../../lib/catalog";
import { GROUP_TEXTS, setSummary } from "../../lib/catalog-view";
import { countOf, SET_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { SetCard, type SetSummary } from "../catalog/SetCard";
import { HomeGroups, SeeAll } from "../home/HomeGroups";

/**
 * Главная по макету «Icon Sets — Search (start scenario)» (Figma «Iconavo — Макеты»): заголовок и поле
 * поиска — в общей раскладке с /search (SearchHero), ниже — наборы по группам (lib/catalog.ts,
 * SET_GROUPS) с карточками и витриной 3 × 3. Иконки витрин — в серверном HTML (loadPageIcons).
 */
export async function Home({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const sets = await getSets();
  const groups = groupSets(sets);
  const cards = new Map<string, SetSummary>(
    await Promise.all(
      groups
        .flatMap((g) => g.ids)
        .flatMap((id) => {
          const info = sets[id];
          return info === undefined ? [] : [{ id, info }];
        })
        .map(async ({ id, info }): Promise<[string, SetSummary]> => {
          const names = await getNames(id);
          return [
            id,
            {
              ...setSummary(lang, id, info, setStyles(names)),
              samples: showcase(info.samples ?? [], names),
            },
          ];
        }),
    ),
  );
  const icons = await loadPageIcons(
    [...cards.values()].flatMap((c) => c.samples.map((n) => `${c.id}:${n}`)),
  );
  const text = (id: SetGroupId) => GROUP_TEXTS[id];
  return (
    <IconavoProvider icons={icons}>
      <HomeGroups
        lang={lang}
        groups={groups.map((g) => ({ id: g.id, label: t[text(g.id).short] }))}
      >
        {groups.map((g) => (
          <section
            key={g.id}
            className="set-group"
            data-group={g.id}
            aria-labelledby={`group-${g.id}`}
          >
            <div className="set-group-head">
              <h2 id={`group-${g.id}`} className="set-group-title">
                {t[text(g.id).title]}{" "}
                <span className="set-group-count">
                  ({countOf(lang, g.ids.length, SET_FORMS[lang])})
                </span>
              </h2>
              {g.ids.length > 1 ? <SeeAll lang={lang} group={g.id} /> : null}
              <p className="set-group-text">{t[text(g.id).text]}</p>
            </div>
            <div id={`group-grid-${g.id}`} className="set-grid">
              {g.ids.flatMap((id) => {
                const card = cards.get(id);
                return card === undefined
                  ? []
                  : [<SetCard key={id} lang={lang} set={card} heading="h3" />];
              })}
            </div>
          </section>
        ))}
      </HomeGroups>
    </IconavoProvider>
  );
}
