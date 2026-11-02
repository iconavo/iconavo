import { IconavoProvider } from "@iconavo-ui/react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { API } from "../../lib/api";
import { VERSION_META } from "../../lib/catalog-view";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import {
  bareName,
  type IconDetails as Details,
  iconDetailsUrl,
  iconPagePath,
  isIconName,
  parseIconDetails,
} from "../../lib/icon";
import { loadPageIcons } from "../../lib/icons";
import { IconDetails } from "../icon/IconDetails";
import { PageLink } from "../PageLink";

/**
 * Сведения об иконке для страницы — из /icon edge API, один запрос на сборку страницы (cache убирает
 * повтор из generateMetadata). 400 и 404 — иконки нет; остальные сбои — ошибка: тогда Vercel оставит
 * прежнюю страницу, а не 404 на весь срок кэша. Метка set-{набор} — для сброса кэша по набору (ADR-0039);
 * без cache: ответ не ложится в кэш запросов — он пережил бы выкладки.
 */
const getDetails = cache(
  async (
    name: string,
  ): Promise<{ details: Details; version: string } | undefined> => {
    const prefix = name.slice(0, name.indexOf(":"));
    const res = await fetch(iconDetailsUrl(API, name), {
      next: { tags: [`set-${prefix}`] },
    });
    if (res.status === 400 || res.status === 404) return undefined;
    if (!res.ok) {
      throw new Error(`СТОП: /icon ${name} — ответ ${res.status} (ADR-0024)`);
    }
    const details = parseIconDetails(await res.json());
    if (details === undefined) {
      throw new Error(`СТОП: /icon ${name} — ответ не по форме (ADR-0024)`);
    }
    return { details, version: res.headers.get("x-iconavo-version") ?? "" };
  },
);

/** Заголовок, описание и метка версии набора; скрытая иконка — не для поисковиков. */
export async function iconMetadata(
  lang: Lang,
  prefix: string,
  icon: string,
): Promise<Metadata> {
  const name = `${prefix}:${icon}`;
  if (!isIconName(name)) return {};
  const got = await getDetails(name);
  if (got === undefined) return {};
  const t = DICTIONARIES[lang];
  const { details } = got;
  const fill = (text: string) =>
    text
      .replace("{name}", bareName(details.icon))
      .replace("{set}", details.set.name);
  return {
    title: fill(t.iconPageTitle),
    description: details.description?.[lang] ?? fill(t.iconPageDescription),
    ...(details.hidden ? { robots: { index: false, follow: false } } : {}),
    other: { [VERSION_META]: got.version },
  };
}

/**
 * Страница иконки /{набор}/{иконка} (ADR-0037, ADR-0041): всё то же, что в боковой панели. Создаётся при
 * первом открытии и хранится в кэше (ADR-0039). Старое имя — постоянный переход на основное, скрытая
 * иконка — с пометкой «Устарела». Иконка, её варианты и оттенки — в серверном HTML (без мигания);
 * похожие из других наборов догружает браузер.
 */
export async function IconPage({
  lang,
  prefix,
  icon,
}: {
  lang: Lang;
  prefix: string;
  icon: string;
}) {
  const name = `${prefix}:${icon}`;
  if (!isIconName(name)) notFound();
  const got = await getDetails(name);
  if (got === undefined) notFound();
  const { details } = got;
  if (details.icon !== name) {
    permanentRedirect(href(lang, iconPagePath(details.icon)));
  }
  const icons = await loadPageIcons([
    details.icon,
    ...details.variants.flatMap((v) => v.icons),
    ...(details.card === null ? [] : [details.card]),
    ...details.tones,
  ]);
  return (
    <main id="content" className="container page icon-page">
      <p className="crumbs">
        <PageLink lang={lang} path={`/${prefix}`}>
          {details.set.name}
        </PageLink>
      </p>
      <h1>{bareName(details.icon)}</h1>
      <IconavoProvider icons={icons}>
        <IconDetails
          lang={lang}
          icon={details.icon}
          details={details}
          state="ready"
          mode="page"
        />
      </IconavoProvider>
    </main>
  );
}
