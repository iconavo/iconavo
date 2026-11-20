// Сетка выбора иконки в чате (шаг 11 фазы 4, ADR-0045): данные, которые инструмент pick_icon MCP-сервера
// кладёт в служебную часть ответа (_meta: её видит сетка, а не модель), и что сетка отдаёт ассистенту
// после «Выбрать». Общее у сервера, сетки и проверок конвейера: код выбранной иконки считают те же
// функции, что у get_icon (look.ts), поэтому он совпадает побайтно. Чистые функции без DOM и сети.

import type { IconData } from "@iconavo-ui/core/internal";
import {
  type IconCredit,
  type IconSetSummary,
  isStyle,
  STYLES,
  type Style,
} from "@iconavo-ui/search";
import { attributionText } from "./icon.js";
import type { Install } from "./install.js";
import {
  appliedOf,
  FORMAT_TITLES,
  FORMATS,
  type Format,
  lookCode,
  type Setup,
  settingsOf,
  setupFor,
} from "./look.js";

/** Ключ данных сетки в _meta ответа: имя со своим доменом, как велит MCP. */
export const PICKER_META_KEY = "iconavo.dev/picker";
/** Номер формата данных: сетка из кэша клиента может встретить данные новее себя. */
export const PICKER_FORMAT = 1;
/** Вариантов в сетке (решение владельца 17 октября 2026, ADR-0045). */
export const PICKER_SIZE = 12;

/** Стиль переключателя: любой — каждая карточка в своём стиле, как нашлась. */
export type PickerStyle = Style | "any";

/** Подписи стилей — как на сайте (ADR-0052). */
export const STYLE_LABELS: Record<"en" | "ru", Record<PickerStyle, string>> = {
  en: {
    any: "Any",
    outline: "Outline",
    filled: "Filled",
    duotone: "Duotone",
    color: "Color",
  },
  ru: {
    any: "Любой",
    outline: "Контур",
    filled: "Заливка",
    duotone: "Двухцветные",
    color: "Цветные",
  },
};

export interface PickerCard {
  /** Номер — как в списке ответа и на картинке-сетке. */
  n: number;
  /** Показанная иконка — каноническое имя набор:иконка. */
  icon: string;
  /** Стиль показанной иконки по общей шкале; null — у набора нет таблицы стилей. */
  style: Style | null;
  /** Главное имя карточки в каждом стиле — канонические имена. */
  styles: Partial<Record<Style, string>>;
  /** Запрос — точное имя этой карточки. */
  exact?: true;
}

/** Рисунок иконки и части от других авторов (Feather у Lucide, ADR-0017). */
export interface PickerIcon extends IconData {
  credits?: IconCredit[];
}

export interface PickerPayload {
  v: typeof PICKER_FORMAT;
  query: string;
  /** Адрес edge API — для ссылки на SVG, как у get_icon. */
  api: string;
  /** Адрес сайта — страница иконки. */
  site: string;
  format: Format;
  size: number;
  /** Начальный цвет #rrggbb, если его задал ассистент. */
  color?: string;
  /** Стиль, которым ассистент сузил поиск. */
  style?: Style;
  cards: PickerCard[];
  /** Рисунки по каноническим именам. */
  icons: Record<string, PickerIcon>;
  sets: IconSetSummary[];
  /** Строки установки из README тега. */
  install: Install;
}

const setOf = (name: string) => name.slice(0, name.indexOf(":"));

/** Данные сетки: карточки и стили без рисунка выпадают, рисунки — только нужные. */
export function pickerPayload(
  input: Omit<PickerPayload, "v" | "icons"> & {
    icons: ReadonlyMap<string, PickerIcon>;
  },
): PickerPayload {
  const used = new Set<string>();
  const cards: PickerCard[] = [];
  for (const card of input.cards) {
    if (!input.icons.has(card.icon)) continue;
    const styles: Partial<Record<Style, string>> = {};
    for (const style of STYLES) {
      const name = card.styles[style];
      if (name !== undefined && input.icons.has(name)) {
        styles[style] = name;
        used.add(name);
      }
    }
    used.add(card.icon);
    cards.push({ ...card, styles });
  }
  const icons: Record<string, PickerIcon> = {};
  for (const name of [...used].sort()) {
    icons[name] = input.icons.get(name) as PickerIcon;
  }
  const prefixes = new Set([...used].map(setOf));
  return {
    v: PICKER_FORMAT,
    query: input.query,
    api: input.api,
    site: input.site,
    format: input.format,
    size: input.size,
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.style === undefined ? {} : { style: input.style }),
    cards,
    icons,
    sets: input.sets.filter((s) => prefixes.has(s.prefix)),
    install: input.install,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isIcon(value: unknown): value is PickerIcon {
  return (
    isObject(value) &&
    isString(value.body) &&
    isNumber(value.width) &&
    isNumber(value.height) &&
    isNumber(value.left) &&
    isNumber(value.top) &&
    (value.credits === undefined || Array.isArray(value.credits))
  );
}

function isSet(value: unknown): value is IconSetSummary {
  return (
    isObject(value) &&
    isString(value.prefix) &&
    isString(value.name) &&
    isObject(value.author) &&
    isString(value.author.name) &&
    isObject(value.license) &&
    isString(value.license.title) &&
    isString(value.license.spdx) &&
    typeof value.palette === "boolean"
  );
}

function isCard(value: unknown): value is PickerCard {
  return (
    isObject(value) &&
    isNumber(value.n) &&
    isString(value.icon) &&
    (value.style === null || isStyle(value.style)) &&
    isObject(value.styles) &&
    Object.entries(value.styles).every(([k, v]) => isStyle(k) && isString(v))
  );
}

function isInstall(value: unknown): value is Install {
  return (
    isObject(value) &&
    isString(value.script) &&
    isObject(value.tag) &&
    isString(value.tag.package) &&
    isString(value.tag.import) &&
    isObject(value.react) &&
    isString(value.react.package) &&
    isString(value.react.import)
  );
}

/**
 * Данные сетки из ответа инструмента — или undefined: не тот формат, клиент их не передал, данные
 * повреждены. Тогда сетка показывает картинку и список из обычной части ответа.
 */
export function parsePickerPayload(value: unknown): PickerPayload | undefined {
  if (
    !isObject(value) ||
    value.v !== PICKER_FORMAT ||
    !isString(value.query) ||
    !isString(value.api) ||
    !isString(value.site) ||
    !(FORMATS as readonly unknown[]).includes(value.format) ||
    !isNumber(value.size) ||
    (value.color !== undefined && !isString(value.color)) ||
    (value.style !== undefined && !isStyle(value.style)) ||
    !Array.isArray(value.cards) ||
    !value.cards.every(isCard) ||
    !isObject(value.icons) ||
    !Object.values(value.icons).every(isIcon) ||
    !Array.isArray(value.sets) ||
    !value.sets.every(isSet) ||
    !isInstall(value.install)
  ) {
    return undefined;
  }
  const icons = value.icons as Record<string, PickerIcon>;
  const sets = value.sets as IconSetSummary[];
  const cards = (value.cards as PickerCard[]).filter(
    (card) =>
      icons[card.icon] !== undefined &&
      sets.some((s) => s.prefix === setOf(card.icon)),
  );
  return { ...(value as unknown as PickerPayload), cards };
}

/** Имя карточки в стиле переключателя; нет такого стиля — undefined. */
export function cardName(
  p: PickerPayload,
  card: PickerCard,
  style: PickerStyle,
): string | undefined {
  const name = style === "any" ? card.icon : card.styles[style];
  return name !== undefined && p.icons[name] !== undefined ? name : undefined;
}

/** Стиль имени по карточке. */
function styleOfName(card: PickerCard, name: string): Style | null {
  for (const style of STYLES) {
    if (card.styles[style] === name) return style;
  }
  return name === card.icon ? card.style : null;
}

/** Стили переключателя: «Любой» и те, что есть хотя бы у одной карточки, — в порядке шкалы. */
export function pickerStyles(p: PickerPayload): PickerStyle[] {
  return [
    "any",
    ...STYLES.filter((style) =>
      p.cards.some((card) => cardName(p, card, style) !== undefined),
    ),
  ];
}

export const cardSet = (
  p: PickerPayload,
  name: string,
): IconSetSummary | undefined => p.sets.find((s) => s.prefix === setOf(name));

/** Цвет применим хотя бы к одной карточке: у монохромного набора. */
export const pickerHasColor = (p: PickerPayload): boolean =>
  p.sets.some((s) => !s.palette);

export interface PickerChoice {
  query: string;
  /** Каноническое имя выбранной иконки. */
  icon: string;
  set: IconSetSummary;
  style: Style | null;
  format: Format;
  size: number;
  /** Цвет, который попал в код: только у монохромного набора. */
  color?: string;
  code: string;
  svgUrl?: string;
  setup?: Setup;
  notes: string[];
  attribution: string;
  credits?: IconCredit[];
  page: string;
}

/** Что сетка отдаёт ассистенту: код — теми же функциями и с теми же входами, что get_icon. */
export function pickerChoice(
  p: PickerPayload,
  card: PickerCard,
  style: PickerStyle,
  color: string | undefined,
): PickerChoice | undefined {
  const name = cardName(p, card, style);
  if (name === undefined) return undefined;
  const set = cardSet(p, name);
  const icon = p.icons[name];
  if (set === undefined || icon === undefined) return undefined;
  const look = { format: p.format, size: p.size, color };
  const applies = { palette: set.palette, strokes: false };
  const { applied, notes } = appliedOf(look, applies, set.name);
  const credits = icon.credits ?? [];
  const code = lookCode(
    p.api,
    p.format,
    name,
    settingsOf(look),
    applies,
    p.install,
    p.format === "svg"
      ? {
          icon,
          details: { set, ...(credits.length > 0 ? { credits } : {}) },
        }
      : undefined,
  );
  return {
    query: p.query,
    icon: name,
    set,
    style: styleOfName(card, name),
    format: p.format,
    size: p.size,
    ...(applied.color === undefined ? {} : { color: applied.color }),
    code: code.code,
    ...(code.svgUrl === undefined ? {} : { svgUrl: code.svgUrl }),
    ...(p.format === "svg" ? {} : { setup: setupFor(p.format, p.install) }),
    notes,
    attribution: attributionText({ set }),
    ...(credits.length > 0 ? { credits } : {}),
    page: `${p.site}/${name.replace(":", "/")}`,
  };
}

/** Текст для модели — как ответ get_icon: имя, код, установка, лицензия, страница. */
export function pickerContextText(c: PickerChoice): string {
  return [
    `The user picked ${c.icon} — ${c.set.name}${c.style === null ? "" : `, ${c.style}`} — in the Iconavo picker for "${c.query}".`,
    "",
    `Code (${FORMAT_TITLES[c.format]}):`,
    c.code,
    "",
    ...(c.setup === undefined
      ? []
      : [
          // Без «<script>» и «<style>» в тексте: строка попадает в код сетки, а тот встроен в <script>
          // страницы — разбор HTML однозначен, только пока тег <script> в ней один.
          `Setup, once per project: ${c.setup.install}, then ${c.setup.import}${c.setup.script === undefined ? "" : " — or, without a build step, the script and stylesheet lines from get_usage"}.`,
        ]),
    ...(c.svgUrl === undefined ? [] : [`The same SVG by URL: ${c.svgUrl}`]),
    ...c.notes,
    `License — keep this attribution: ${c.attribution}`,
    `Page: ${c.page}`,
    "Insert this code where the user needs the icon.",
  ].join("\n");
}

/** Контекст модели: текст и те же данные структурой. */
export function pickerContext(c: PickerChoice): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: pickerContextText(c) }],
    structuredContent: { ...c },
  };
}

/**
 * Сообщение в чат от имени человека (решение владельца 20 ноября 2026): коротко — имя, стиль, цвет.
 * Код в нём не идёт: у Claude предел сообщения 8 000 знаков, а SVG эмодзи бывает до 21 КБ. Если
 * контекст модели не принят, сообщение просит ассистента взять код у get_icon.
 */
export function pickerMessage(
  c: PickerChoice,
  lang: "en" | "ru",
  delivered: boolean,
): string {
  const parts = [
    c.icon,
    ...(c.style === null ? [] : [STYLE_LABELS[lang][c.style]]),
    ...(c.color === undefined ? [] : [c.color.toUpperCase()]),
  ].join(" · ");
  const format = c.format === "html" ? "" : ` (${c.format})`;
  if (lang === "ru") {
    return `Выбрана иконка ${parts}.${delivered ? "" : ` Код возьми через get_icon${format}.`}`;
  }
  return `Picked ${parts}.${delivered ? "" : ` Get the code with get_icon${format}.`}`;
}
