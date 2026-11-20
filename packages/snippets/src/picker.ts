// Сетка выбора иконки в чате (шаг 11 фазы 4, ADR-0045): данные, которые инструмент pick_icon MCP-сервера
// кладёт в служебную часть ответа (_meta: её видит сетка, а не модель), и что сетка отдаёт ассистенту
// после Select. Общее у сервера, сетки и проверок конвейера: код выбранной иконки считают те же
// функции, что у get_icon (look.ts), поэтому он совпадает побайтно. Чистые функции без DOM и сети.

import { hasStrokeWidth, type IconData } from "@iconavo-ui/core/internal";
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
  needsDrawing,
  type Setup,
  settingsOf,
  setupFor,
} from "./look.js";
import { DEFAULT_SETTINGS } from "./settings.js";

/** Ключ данных сетки в _meta ответа: имя со своим доменом, как велит MCP. */
export const PICKER_META_KEY = "iconavo.dev/picker";
/** Номер формата данных: сетка из кэша клиента может встретить данные новее себя. */
export const PICKER_FORMAT = 1;
/** Вариантов в сетке (решение владельца 17 октября 2026, ADR-0045). */
export const PICKER_SIZE = 12;

/** Подписи стилей — как на сайте (ADR-0052); сетка и сообщения — по-английски (решение владельца 20 ноября 2026). */
export const STYLE_LABELS: Record<Style, string> = {
  outline: "Outline",
  filled: "Filled",
  duotone: "Duotone",
  color: "Color",
};

/** Подписи форматов — как кнопки панели сайта. */
export const FORMAT_LABELS: Record<Format, string> = {
  svg: "SVG",
  css: "CSS",
  html: "HTML",
  react: "React",
};

/** Кнопка формата: без format — «Soon», как в панели сайта. */
export interface PickerFormatOption {
  label: string;
  format?: Format;
}

/**
 * Кнопки формата сетки — те же группы и тот же порядок, что в панели сайта (ADR-0042). Чего в продукте
 * нет, то «Soon» (решение владельца 20 ноября 2026): заработает в сетке, когда появится на сайте.
 */
export const PICKER_FORMAT_GROUPS: readonly {
  label: string;
  options: readonly PickerFormatOption[];
}[] = [
  {
    label: "SVG and CSS",
    options: [
      { label: "SVG", format: "svg" },
      { label: "SVG+CSS" },
      { label: "CSS", format: "css" },
    ],
  },
  {
    label: "Components",
    options: [
      { label: "HTML", format: "html" },
      { label: "React", format: "react" },
      { label: "Vue" },
      { label: "Svelte" },
      { label: "Solid" },
      { label: "Astro" },
    ],
  },
];

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

export const cardSet = (
  p: PickerPayload,
  name: string,
): IconSetSummary | undefined => p.sets.find((s) => s.prefix === setOf(name));

/** Цвет применим хотя бы к одной карточке: у монохромного набора. */
export const pickerHasColor = (p: PickerPayload): boolean =>
  p.sets.some((s) => !s.palette);

/** Толщина линии меняет рисунок карточки: линии с currentColor (hasStrokeWidth ядра, как у /icon). */
export const cardHasStroke = (p: PickerPayload, card: PickerCard): boolean => {
  const icon = p.icons[card.icon];
  return icon !== undefined && hasStrokeWidth(icon.body);
};

/** Что выбрал человек в сетке, кроме иконки. */
export interface PickerLook {
  format: Format;
  /** Свой цвет #rrggbb; нет — цвет текста вокруг. */
  color?: string | undefined;
  /** Своя толщина линии; нет — как у рисунка. */
  stroke?: number | undefined;
}

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
  /** Толщина, которая попала в код: только у линий. */
  stroke?: number;
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
  look: PickerLook,
): PickerChoice | undefined {
  const name = card.icon;
  const set = cardSet(p, name);
  const icon = p.icons[name];
  if (set === undefined || icon === undefined) return undefined;
  const asked = {
    format: look.format,
    size: p.size,
    color: look.color,
    strokeWidth: look.stroke,
  };
  const applies = { palette: set.palette, strokes: hasStrokeWidth(icon.body) };
  const { applied, notes } = appliedOf(asked, applies, set.name);
  const credits = icon.credits ?? [];
  const code = lookCode(
    p.api,
    look.format,
    name,
    settingsOf(asked),
    applies,
    p.install,
    needsDrawing(look.format)
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
    style: card.style,
    format: look.format,
    size: p.size,
    ...(applied.color === undefined ? {} : { color: applied.color }),
    ...(applied.strokeWidth === undefined
      ? {}
      : { stroke: applied.strokeWidth }),
    code: code.code,
    ...(code.svgUrl === undefined ? {} : { svgUrl: code.svgUrl }),
    ...(look.format === "html" || look.format === "react"
      ? { setup: setupFor(look.format, p.install) }
      : {}),
    notes,
    attribution: attributionText({ set }),
    ...(credits.length > 0 ? { credits } : {}),
    page: `${p.site}/${name.replace(":", "/")}`,
  };
}

/** Текст для модели — как ответ get_icon: имя, код, установка, лицензия, страница. */
export function pickerContextText(c: PickerChoice): string {
  return [
    `The user picked ${c.icon} — ${c.set.name}${c.style === null ? "" : `, ${c.style}`} — in the Iconavo picker for "${c.query}" and asked for ${FORMAT_LABELS[c.format]} code.`,
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
    "Reply with this code, ready to paste, and the attribution; insert it where the user needs the icon.",
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
 * Сообщение в чат от имени человека — сразу просьба о коде выбранного формата (решения владельца
 * 20 ноября 2026: по-английски; ChatGPT отправляет его сразу, Claude кладёт в поле ввода). Код в нём не
 * идёт: у Claude предел сообщения 8 000 знаков, а SVG эмодзи бывает до 21 КБ — он в контексте модели.
 * Контекст не принят — ассистент берёт код у get_icon с теми же настройками.
 */
export function pickerMessage(c: PickerChoice, delivered: boolean): string {
  const details = [
    c.set.name,
    ...(c.style === null ? [] : [STYLE_LABELS[c.style].toLowerCase()]),
    ...(c.color === undefined ? [] : [c.color.toUpperCase()]),
    ...(c.stroke === undefined ? [] : [`stroke ${c.stroke}`]),
  ].join(", ");
  const ask = `Use ${c.icon} (${details}) — give me the ${FORMAT_LABELS[c.format]} code.`;
  if (delivered) return ask;
  const args = [
    `format ${c.format}`,
    ...(c.size === DEFAULT_SETTINGS.size ? [] : [`size ${c.size}`]),
    ...(c.color === undefined ? [] : [`color ${c.color.toUpperCase()}`]),
    ...(c.stroke === undefined ? [] : [`strokeWidth ${c.stroke}`]),
  ].join(", ");
  return `${ask} Get it with get_icon (${args}).`;
}
