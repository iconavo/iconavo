import { Icon, IconavoProvider } from "@iconavo-ui/react";
import { notFound } from "next/navigation";
import {
  categoriesOf,
  categoryCards,
  FIRST_PAGE_MAX,
  getReleases,
  getSet,
  setCards,
  setStyles,
  setTag,
  visibleNames,
} from "../../lib/catalog";
import {
  countOf,
  formatDate,
  formatNumber,
  ICON_FORMS,
} from "../../lib/format";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { loadPageIcons } from "../../lib/icons";
import { PAGE_PANEL_ID } from "../../lib/panel-layout";
import { IconGrid } from "../catalog/IconGrid";
import { PageLink } from "../PageLink";
import { Soon } from "../shell/Soon";
import { Tip } from "../shell/Tip";

/**
 * Страница набора /{префикс} (ADR-0037) по макету «Icon Set Page» (Figma «Iconavo — Макеты»): крошки,
 * название, «Subscribe to updates» (подписок пока нет — «Soon»), строка сведений — число иконок, лицензия,
 * автор, последний выпуск; ниже сетка по 96 карточек с поиском по набору, стилями (ADR-0052) и
 * категориями автора. Число иконок в шапке — все варианты, как у Iconify; в сетке — карточки. Скрытых
 * иконок нет: в /collection они отдельно (ADR-0018).
 */
export async function SetPage({
  lang,
  prefix,
}: {
  lang: Lang;
  prefix: string;
}) {
  const t = DICTIONARIES[lang];
  const set = await getSet(prefix);
  if (set === undefined) notFound();
  const { info } = set;
  // Свой последний выпуск меняется только с выпуском набора — метка набора, а не catalog (ADR-0039).
  const latest = (await getReleases(setTag(prefix))).find(
    (r) => r.prefix === prefix,
  );
  const names = visibleNames(set);
  const grouped = setCards(set);
  const first = grouped.cards.slice(0, FIRST_PAGE_MAX).map((card) => card.base);
  const icons = await loadPageIcons(first.map((name) => `${prefix}:${name}`));
  return (
    <main id="content" className="page set-page">
      <header className="set-head">
        <div className="set-head-title">
          <nav aria-label={t.crumbsLabel} className="crumbs">
            <ol>
              <li>
                <PageLink lang={lang} path="/">
                  {t.navIconSets}
                </PageLink>
              </li>
              <li aria-current="page">{info.name}</li>
            </ol>
          </nav>
          <PageLink lang={lang} path="/" className="set-back">
            <Icon
              icon="material-symbols:keyboard-arrow-left"
              className="pill-chevron"
            />
            {t.navIconSets}
          </PageLink>
          <h1 className="set-title">{info.name}</h1>
        </div>
        <Soon lang={lang} className="subscribe">
          <Icon icon="site:add-alert-light" className="pill-icon" />
          <span>{t.setSubscribe}</span>
        </Soon>
        <ul className="set-meta">
          <li>
            <Icon icon="site:set-count" className="set-meta-icon" />
            <span>{countOf(lang, names.length, ICON_FORMS[lang])}</span>
          </li>
          <li>
            <span className="set-meta-label">{t.setLicense}:</span>
            <PageLink lang={lang} path={`/licenses#${prefix}`}>
              {info.license.title}
            </PageLink>
            <Tip text={t.setCommercialHint}>
              <Icon icon="material-symbols:help" className="pill-icon" />
            </Tip>
          </li>
          <li>
            <span className="set-meta-label">{t.setAuthor}:</span>
            {info.author.url === undefined ? (
              <span>{info.author.name}</span>
            ) : (
              <a href={info.author.url}>{info.author.name}</a>
            )}
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
                  path={`/changelog?set=${prefix}`}
                  className="set-meta-news-long"
                >
                  {t.setNews}
                </PageLink>
              </li>
              {/* Телефон (кадр «Icon Set Page / Mobile»): короткая ссылка отдельной группой с разделителем.
                  На компьютере её нет (display: none) — ссылка не повторяется. */}
              <li className="set-meta-news">
                <PageLink lang={lang} path={`/changelog?set=${prefix}`}>
                  {t.setNewsShort}
                </PageLink>
              </li>
            </>
          )}
        </ul>
      </header>
      <div className="set-body">
        <IconavoProvider icons={icons}>
          <IconGrid
            lang={lang}
            prefix={prefix}
            setName={info.name}
            first={first}
            total={grouped.cards.length}
            allCount={formatNumber(lang, grouped.cards.length)}
            categories={categoriesOf(set).map((c) => {
              const size = categoryCards(c.names, grouped).length;
              return {
                slug: c.slug,
                title: c.title,
                size,
                count: formatNumber(lang, size),
              };
            })}
            styles={setStyles(set).map((style) => {
              const size = grouped.cards.filter((c) => c.styles[style]).length;
              return { style, size, count: formatNumber(lang, size) };
            })}
          />
        </IconavoProvider>
      </div>
      {/* Место панели иконки во всю высоту страницы (lib/panel-layout.ts). */}
      <div id={PAGE_PANEL_ID} className="page-panel" />
    </main>
  );
}
