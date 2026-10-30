import { getSet, getSets, orderSets, revisionLabel } from "../../lib/catalog";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

/**
 * Лицензии /licenses (ADR-0037, ADR-0017): автор, лицензия, источник и полный текст лицензии каждого
 * набора — из /collection?info=true edge API. Юридические тексты сайта — фаза 7.
 */
export async function Licenses({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  const ids = orderSets(Object.keys(await getSets()));
  const sets = (await Promise.all(ids.map((id) => getSet(id)))).flatMap(
    (set) => (set === undefined ? [] : [set]),
  );
  return (
    <main id="content" className="container page">
      <h1>{t.licensesTitle}</h1>
      <p className="lead">{t.licensesLead}</p>
      {sets.map(({ prefix, info }) => (
        <section key={prefix} id={prefix} className="license">
          <h2>
            <PageLink lang={lang} path={`/${prefix}`}>
              {info.name}
            </PageLink>
          </h2>
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
                {info.license.url === undefined ? (
                  info.license.title
                ) : (
                  <a href={info.license.url}>{info.license.title}</a>
                )}{" "}
                (<code>{info.license.spdx}</code>)
              </dd>
            </div>
            <div>
              <dt>{t.licenseSource}</dt>
              <dd>
                <a href={info.license.source}>{info.license.source}</a> ·{" "}
                <code>{revisionLabel(info.license.revision)}</code>
              </dd>
            </div>
          </dl>
          <details>
            <summary>{t.licenseText}</summary>
            <pre className="license-text">{info.license.text}</pre>
          </details>
          {info.license.notice === undefined ? null : (
            <details>
              <summary>{t.licenseNotice}</summary>
              <pre className="license-text">{info.license.notice}</pre>
            </details>
          )}
        </section>
      ))}
    </main>
  );
}
