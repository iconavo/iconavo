import { Icon, IconavoProvider } from "@iconavo-ui/react";
import {
  CATALOG_TAG,
  getNames,
  getReleases,
  getSets,
  groupSets,
  setStyles,
  showcase,
} from "../../lib/catalog";
import { GROUP_TEXTS, setSummary } from "../../lib/catalog-view";
import { countOf, formatDate, ICON_FORMS, SET_FORMS } from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { Crumbs } from "../Crumbs";
import type { SetSummary } from "../catalog/SetCard";
import { SetsBrowser, type SetsGroup } from "../catalog/SetsBrowser";
import { PageLink } from "../PageLink";

/**
 * Каталог наборов /sets (ADR-0037) в стиле сайта (решения владельца 23 ноября 2026, ADR-0038): шапка — как у
 * страницы набора (крошки «Icon Sets / All sets», заголовок, строка сведений — иконок и наборов всего,
 * лицензии, последний выпуск и «Что нового»; линия), ниже — фильтры чипсами с числом наборов и наборы по
 * группам, как на главной (Material, UI 24px, Emoji — lib/catalog.ts, SET_GROUPS), карточками Icon Set Card
 * с витриной 3 × 3. Иконки витрин — в серверном HTML (loadPageIcons).
 */
export async function Sets({ lang }: { lang: Lang }) {
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
          // Общая страница — метка catalog (ADR-0039): её сбрасывает выпуск любого набора.
          const names = await getNames(id, CATALOG_TAG);
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
  const latest = (await getReleases()).at(0);
  const total = Object.values(sets).reduce((sum, s) => sum + s.total, 0);
  const licenses = [
    ...new Set(Object.values(sets).map((s) => s.license.title)),
  ].sort((a, b) => a.localeCompare(b, "en"));
  const browserGroups: SetsGroup[] = groups.map((g) => ({
    id: g.id,
    title: t[GROUP_TEXTS[g.id].title],
    text: t[GROUP_TEXTS[g.id].text],
    sets: g.ids.flatMap((id) => {
      const card = cards.get(id);
      return card === undefined ? [] : [card];
    }),
  }));
  return (
    <main id="content" className="page sets-page">
      <header className="set-head">
        <div className="set-head-title">
          <Crumbs
            lang={lang}
            items={[{ path: "/", label: t.navIconSets }]}
            current={t.setsCrumb}
          />
          <PageLink lang={lang} path="/" className="set-back">
            <Icon
              icon="material-symbols:keyboard-arrow-left"
              className="pill-chevron"
            />
            {t.navIconSets}
          </PageLink>
          <h1 className="set-title">{t.setsTitle}</h1>
        </div>
        <ul className="set-meta">
          <li>
            <Icon icon="site:set-count" className="set-meta-icon" />
            <span>{countOf(lang, total, ICON_FORMS[lang])}</span>
          </li>
          <li>
            <span>
              {countOf(lang, Object.keys(sets).length, SET_FORMS[lang])}
            </span>
          </li>
          <li>
            <span className="set-meta-label">{t.setsLicenses}:</span>
            <PageLink lang={lang} path="/licenses">
              {licenses.join(", ")}
            </PageLink>
          </li>
          {latest === undefined ? null : (
            <>
              <li>
                <span className="set-meta-label">{t.setLatest}:</span>
                <time dateTime={latest.date}>
                  {formatDate(lang, latest.date)}
                </time>
                <PageLink
                  lang={lang}
                  path="/changelog"
                  className="set-meta-news-long"
                >
                  {t.setNewsShort}
                </PageLink>
              </li>
              {/* Телефон: короткая ссылка отдельной группой, как у страницы набора. */}
              <li className="set-meta-news">
                <PageLink lang={lang} path="/changelog">
                  {t.setNewsShort}
                </PageLink>
              </li>
            </>
          )}
        </ul>
      </header>
      <div className="set-body">
        <IconavoProvider icons={icons}>
          <SetsBrowser lang={lang} groups={browserGroups} />
        </IconavoProvider>
      </div>
    </main>
  );
}
