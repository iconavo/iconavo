"use client";

import { track } from "../../lib/analytics";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { attributionText, type IconSetSummary } from "../../lib/icon";
import { PageLink } from "../PageLink";
import { CodeBlock } from "./parts";

/**
 * Последний раздел панели — автор и лицензия с указанием авторства (решение владельца 12 ноября 2026).
 * Текст указания авторства — тот же английский текст на весь набор, что в комментарии файла
 * (attributionText, решение владельца 3 ноября 2026).
 */
export function PanelCredits({
  lang,
  name,
  set,
}: {
  lang: Lang;
  name: string;
  set: IconSetSummary | undefined;
}) {
  const t = DICTIONARIES[lang];
  if (set === undefined) return null;
  return (
    <section
      className="panel-section panel-credits"
      aria-label={t.pAttribution}
    >
      <dl className="panel-facts">
        <div>
          <dt className="panel-label">{t.pAuthor}</dt>
          <dd>
            {set.author.url === undefined ? (
              set.author.name
            ) : (
              <a href={set.author.url}>{set.author.name}</a>
            )}
          </dd>
        </div>
        <div>
          <dt className="panel-label">{t.pLicense}</dt>
          <dd>
            <PageLink lang={lang} path={`/licenses#${set.prefix}`}>
              {set.license.title}
            </PageLink>
          </dd>
        </div>
      </dl>
      <CodeBlock
        lang={lang}
        label={t.pAttribution}
        code={attributionText({ set })}
        onCopied={() =>
          track({ name: "copy", what: "attribution", icon: name })
        }
      />
    </section>
  );
}
