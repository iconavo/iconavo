import { Icon, IconavoProvider } from "@iconavo-ui/react";
import { notFound } from "next/navigation";
import {
  categoriesOf,
  getReleases,
  getSet,
  pageOf,
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
import { IconGrid } from "../catalog/IconGrid";
import { PageLink } from "../PageLink";

/**
 * Страница набора /{префикс} (ADR-0037): автор, лицензия, версия и последний выпуск, витрина из шести
 * иконок (ADR-0017), сетка по 96 иконок с категориями автора. Скрытых иконок нет: в /collection они
 * отдельно (ADR-0018).
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
  const latest = (await getReleases()).find((r) => r.prefix === prefix);
  const names = visibleNames(set);
  const first = pageOf(names, 1);
  const samples = info.samples ?? [];
  const icons = await loadPageIcons(
    [...samples, ...first].map((name) => `${prefix}:${name}`),
  );
  const height = Array.isArray(info.height)
    ? info.height.join(", ")
    : String(info.height);
  return (
    <main id="content" className="container page">
      <p className="crumbs">
        <PageLink lang={lang} path="/sets">
          {t.setsTitle}
        </PageLink>
      </p>
      <h1>{info.name}</h1>
      <p className="lead">
        {countOf(lang, names.length, ICON_FORMS[lang])} ·{" "}
        {info.palette ? t.setMulticolor : t.setMonochrome}
      </p>
      <dl className="set-facts">
        <div>
          <dt>{t.setAuthor}</dt>
          <dd>
            {info.author.url === undefined ? (
              info.author.name
            ) : (
              <a href={info.author.url}>{info.author.name}</a>
            )}
          </dd>
        </div>
        <div>
          <dt>{t.setLicense}</dt>
          <dd>
            <PageLink lang={lang} path={`/licenses#${prefix}`}>
              {info.license.title}
            </PageLink>
          </dd>
        </div>
        <div>
          <dt>{t.setVersion}</dt>
          <dd>{info.version}</dd>
        </div>
        <div>
          <dt>{t.setGrid}</dt>
          <dd>{height}</dd>
        </div>
        {latest === undefined ? null : (
          <div>
            <dt>{t.setLatest}</dt>
            <dd>
              <time dateTime={latest.date}>
                {formatDate(lang, latest.date)}
              </time>{" "}
              ·{" "}
              <PageLink lang={lang} path={`/changelog?set=${prefix}`}>
                {t.setNews}
              </PageLink>
            </dd>
          </div>
        )}
        <div>
          <dt>{t.setNpm}</dt>
          <dd>
            <a
              href={`https://www.npmjs.com/package/@iconavo-ui/icons-${prefix}`}
            >
              @iconavo-ui/icons-{prefix}
            </a>
          </dd>
        </div>
      </dl>
      <IconavoProvider icons={icons}>
        <p className="set-samples" aria-hidden="true">
          {samples.map((name) => (
            <Icon
              key={name}
              icon={`${prefix}:${name}`}
              className="inline-block"
            />
          ))}
        </p>
        <IconGrid
          lang={lang}
          prefix={prefix}
          first={first}
          total={names.length}
          allCount={formatNumber(lang, names.length)}
          categories={categoriesOf(set).map((c) => ({
            slug: c.slug,
            title: c.title,
            size: c.names.length,
            count: formatNumber(lang, c.names.length),
          }))}
        />
      </IconavoProvider>
    </main>
  );
}
