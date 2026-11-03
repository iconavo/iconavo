// Сведения об иконке на сайте (шаг 4 фазы 4, ADR-0041): адрес /icon edge API, разбор его ответа, адреса
// панели и страницы иконки, текст указания авторства. Чистые функции — их проверяют тесты без сети;
// запросы — в components/icon/ (браузер) и components/pages/IconPage.tsx (сервер).

import {
  type IconCredit,
  type IconDetails,
  isStyle,
  type StyleVariants,
} from "@iconavo-ui/search";

export type { IconDetails };

/** Параметр адреса открытой панели: ?icon=lucide:house (решение владельца 2 ноября 2026). */
export const PANEL_PARAM = "icon";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;

/** Имя иконки `набор:иконка` по правилу ADR-0001; как у API — не длиннее 129 знаков. */
export const isIconName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 129 && NAME.test(value);

/** Иконка открытой панели из адреса; имя не по правилу — панели нет. */
export function panelIcon(query: URLSearchParams): string | undefined {
  const value = query.get(PANEL_PARAM);
  return isIconName(value) ? value : undefined;
}

/** Адрес /icon edge API. */
export const iconDetailsUrl = (api: string, name: string): string =>
  `${api}/icon?${new URLSearchParams({ icon: name })}`;

/** Путь страницы иконки без языка: lucide:house → /lucide/house. */
export const iconPagePath = (name: string): string =>
  `/${name.replace(":", "/")}`;

/** Имя без набора: lucide:house → house. */
export const bareName = (name: string): string =>
  name.slice(name.indexOf(":") + 1);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const isNames = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isIconName);

function pair<T>(
  value: unknown,
  check: (v: unknown) => v is T,
): { en: T; ru: T } | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !check(value.en) || !check(value.ru)) {
    return undefined;
  }
  return { en: value.en, ru: value.ru };
}

const isString = (v: unknown): v is string => typeof v === "string";

/** Части набора от других авторов: нет поля — пусто, не по форме — undefined. */
function creditsOf(value: unknown): IconCredit[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const credits: IconCredit[] = [];
  for (const c of value) {
    if (
      !isObject(c) ||
      !isString(c.name) ||
      !isString(c.author) ||
      !isString(c.license) ||
      !isString(c.url)
    ) {
      return undefined;
    }
    credits.push({
      name: c.name,
      author: c.author,
      license: c.license,
      url: c.url,
    });
  }
  return credits;
}

/** Ответ /icon по форме или undefined — тогда панель покажет «не удалось». */
export function parseIconDetails(json: unknown): IconDetails | undefined {
  if (!isObject(json) || !isIconName(json.icon)) return undefined;
  const set = json.set;
  if (
    !isObject(set) ||
    !isString(set.prefix) ||
    !isString(set.name) ||
    !isObject(set.author) ||
    !isString(set.author.name) ||
    !isObject(set.license) ||
    !isString(set.license.title) ||
    !isString(set.license.spdx)
  ) {
    return undefined;
  }
  const variants: StyleVariants[] = [];
  if (!Array.isArray(json.variants)) return undefined;
  for (const v of json.variants) {
    if (!isObject(v) || !isStyle(v.style) || !isNames(v.icons)) {
      return undefined;
    }
    variants.push({ style: v.style, icons: v.icons });
  }
  const credits = creditsOf(json.credits);
  const setCredits = creditsOf(set.credits);
  if (credits === undefined || setCredits === undefined) return undefined;
  const description = pair(json.description, isString);
  const synonyms = pair(json.synonyms, isStrings);
  if (
    description === undefined ||
    synonyms === undefined ||
    !(json.card === null || isIconName(json.card)) ||
    !(json.style === null || isStyle(json.style)) ||
    !isNames(json.tones) ||
    typeof json.strokes !== "boolean" ||
    !isStrings(json.tags) ||
    !isNames(json.similar) ||
    (json.alias !== undefined && !isIconName(json.alias))
  ) {
    return undefined;
  }
  return {
    icon: json.icon,
    ...(json.alias === undefined ? {} : { alias: json.alias }),
    ...(json.hidden === true ? { hidden: true as const } : {}),
    set: {
      prefix: set.prefix,
      name: set.name,
      author: {
        name: set.author.name,
        ...(isString(set.author.url) ? { url: set.author.url } : {}),
      },
      license: {
        title: set.license.title,
        spdx: set.license.spdx,
        ...(isString(set.license.url) ? { url: set.license.url } : {}),
      },
      palette: set.palette === true,
      ...(setCredits.length > 0 ? { credits: setCredits } : {}),
    },
    card: json.card,
    style: json.style,
    variants,
    tones: json.tones,
    strokes: json.strokes,
    description,
    synonyms,
    tags: json.tags,
    ...(credits.length > 0 ? { credits } : {}),
    similar: json.similar,
  };
}

/**
 * Готовый текст указания авторства — один на весь набор и по-английски (решение владельца 3 ноября 2026):
 * иконку обычно берут вместе с другими из того же набора. Набор, автор, лицензия и части от других
 * авторов (Feather у Lucide, ADR-0017) — у любой иконки набора. Его вставляют в «О программе» или файл
 * лицензий проекта.
 */
export function attributionText(d: Pick<IconDetails, "set">): string {
  const { set } = d;
  const linked = (text: string, url?: string) =>
    url === undefined ? text : `${text} (${url})`;
  return [
    `Icons: ${set.name} by ${linked(set.author.name, set.author.url)}, ${linked(`${set.license.title} license`, set.license.url)}.`,
    ...(set.credits ?? []).map(
      (c) =>
        `Includes icons from ${c.name} by ${linked(c.author, c.url)}, ${c.license} license.`,
    ),
  ].join(" ");
}
