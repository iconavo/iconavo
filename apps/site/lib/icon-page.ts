// Страница иконки по макету Figma «Страница иконки» (редизайн, шаг 4; решения владельца 13 ноября 2026).
// Чистые части: старое имя → основное, плитки «Other styles», даты по выпускам набора, форматы
// копирования, сетка превью. Данные страницы — из каталога наборов (/collection, /changelog edge API):
// она собирается и без поиска Meilisearch, а теги и похожие приходят из /icon, когда он отвечает.

import type { IconData } from "@iconavo-ui/core/internal";
import { type Card, STYLES } from "@iconavo-ui/search";
import type { Collection, Release } from "./catalog";
import type { IconDetails, IconSetSummary } from "./icon";
import type { MockupNeighbour } from "./mockups";

/** Шагов по цепочке алиасов, после которых она считается зацикленной, — как у ядра пакета. */
const ALIAS_STEPS = 10;

/**
 * Старое имя → основное по алиасам набора (ADR-0018); не алиас — само имя; цепочка зациклена —
 * undefined. Только свои ключи объекта: имя «constructor» правилу имён подходит.
 */
export function resolveAlias(
  aliases: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  let current = name;
  for (let step = 0; step <= ALIAS_STEPS; step++) {
    if (aliases === undefined || !Object.hasOwn(aliases, current)) {
      return current;
    }
    current = aliases[current] as string;
  }
  return undefined;
}

/** Плитка «Other styles»: имя без набора и подпись. */
export interface StyleTile {
  name: string;
  label: string;
}

const dashed = (suffix: string) => (suffix === "" ? "" : `-${suffix}`);

/**
 * Плитки «Other styles» — все видимые имена карточки иконки (база и варианты, ADR-0002; алиасы
 * одинаковых вариантов — нет: их страница ведёт на основное имя). Порядок — по таблице стилей набора:
 * сначала стиль базы, затем остальные в порядке общей шкалы (ADR-0052), внутри — как в таблице;
 * без таблицы — по кодам символов. Подпись — название суффикса у автора (suffixes из /collection:
 * Outline, Rounded…), без названия — имя.
 */
export function styleTiles(
  card: Card,
  c: Pick<Collection, "suffixes" | "styles">,
): StyleTile[] {
  const names = [card.base, ...card.variants];
  const visible = new Set(names);
  const order: string[] = [];
  const own = STYLES.find((style) => c.styles?.[style]?.includes(""));
  const styles =
    own === undefined ? STYLES : [own, ...STYLES.filter((s) => s !== own)];
  for (const style of styles) {
    for (const suffix of c.styles?.[style] ?? []) {
      const name = `${card.base}${dashed(suffix)}`;
      if (visible.has(name) && !order.includes(name)) order.push(name);
    }
  }
  for (const name of names) if (!order.includes(name)) order.push(name);
  return order.map((name) => {
    const suffix =
      name === card.base
        ? ""
        : name.startsWith(`${card.base}-`)
          ? name.slice(card.base.length + 1)
          : undefined;
    const title =
      suffix !== undefined && c.suffixes !== undefined
        ? Object.hasOwn(c.suffixes, suffix)
          ? c.suffixes[suffix]
          : undefined
        : undefined;
    return { name, label: title ?? name };
  });
}

/** Даты иконки по выпускам набора; формат — у страницы (lib/format.ts). */
export interface IconDates {
  /** Выпуск, где иконка появилась, — только если позже первого выпуска набора у нас. */
  added?: string;
  /** Последний выпуск, где менялся рисунок. */
  changed?: string;
  /** Выпуск, где автор её убрал: имя осталось, иконка скрыта (ADR-0018); revision — версия у автора. */
  removed?: { date: string; version: string; revision: string };
}

const newestFirst = (a: Release, b: Release) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;

/**
 * Даты иконки (решение владельца 13 ноября 2026): «Added» — только у иконок, добавленных после
 * первого выпуска набора у нас (в первом выпуске списка добавленных нет), «Last changed» — если рисунок
 * менялся, «Removed» — выпуск, где иконку скрыли, если её потом не вернули. Переименование ведёт по
 * истории старого имени. Лента /changelog хранит последние 100 выпусков всех наборов: выпавших дат нет —
 * неверных не бывает.
 */
export function iconDates(
  prefix: string,
  name: string,
  releases: readonly Release[],
): IconDates {
  const own = releases.filter((r) => r.prefix === prefix).sort(newestFirst);
  const out: IconDates = {};
  let current = name;
  let restored = false;
  for (const r of own) {
    if (r.restored?.includes(current)) restored = true;
    if (!restored && out.removed === undefined && r.hidden?.includes(current)) {
      out.removed = { date: r.date, version: r.version, revision: r.revision };
    }
    if (out.changed === undefined && r.changed?.includes(current)) {
      out.changed = r.date;
    }
    if (r.added?.includes(current)) {
      out.added = r.date;
      break;
    }
    const old = Object.entries(r.renamed ?? {}).find(
      ([, to]) => to === current,
    )?.[0];
    if (old !== undefined) current = old;
  }
  return out;
}

/** Форматы «Copy as» по макету: SVG, JSX, Data URL, Base64 и картинка PNG. */
export const COPY_FORMATS = [
  "svg",
  "jsx",
  "data-url",
  "base64",
  "png",
] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

/** Имя атрибута для JSX: через дефис и двоеточие — camelCase, class — className; data- и aria- — как есть. */
function jsxAttribute(name: string): string {
  if (name === "class") return "className";
  if (/^(data|aria)-/.test(name)) return name;
  return name.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * SVG → JSX для React: только имена атрибутов (stroke-width → strokeWidth). Атрибутов style в рисунках
 * нет — санитайзер конвейера их не пропускает (ADR-0013).
 */
export function svgToJsx(svg: string): string {
  return svg.replace(/<[^>]+>/g, (tag) =>
    tag.replace(
      /(\s)([a-zA-Z][\w:-]*)(?==)/g,
      (_, space: string, attr: string) => `${space}${jsxAttribute(attr)}`,
    ),
  );
}

/** SVG картинкой data: в base64 — для src и CSS; байты UTF-8. */
export function svgBase64(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** PNG в меню Download: выбранный размер, вдвое и вчетверо больше (решение владельца 13 ноября 2026). */
export const PNG_SCALES = [1, 2, 4] as const;

/** Размеры в ряду «Sizes» под превью — как в макете. */
export const PREVIEW_SIZES = [20, 24, 32, 48] as const;

/** Тегов до «+N» — как в макете. */
export const TAGS_SHOWN = 8;

/**
 * Линии сетки превью — путь SVG в единицах иконки: каждая единица холста — клетка (24 × 24 у сетки 24).
 * Рисуется поверх того же холста, что иконка, и тянется вместе с ней.
 */
export function gridPath(width: number, height: number): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const lines: string[] = [];
  for (let x = 0; x <= w; x++) lines.push(`M${x} 0V${h}`);
  for (let y = 0; y <= h; y++) lines.push(`M0 ${y}H${w}`);
  return lines.join("");
}

/**
 * Всё, что страница иконки передаёт из сервера в браузер. Строки — готовые, на языке страницы: браузер
 * с другой версией данных Intl не разойдётся с серверным HTML.
 */
export interface IconPageData {
  /** Полное имя `набор:иконка`. */
  icon: string;
  /** Карточка иконки — её база (ADR-0002); у скрытой — null. */
  card: string | null;
  hidden: boolean;
  set: IconSetSummary;
  /** Рисунок — для копирования, файлов и кода без сети. */
  data: IconData;
  /** Толщина линии меняет рисунок (hasStrokeWidth ядра, ADR-0041). */
  strokes: boolean;
  categories: { title: string; slug: string }[];
  /** Плитки «Other styles» или оттенков кожи — полные имена; одна плитка — блока нет. */
  tiles: { kind: "styles" | "tones"; items: StyleTile[] };
  dates: { added?: string; changed?: string; removed?: string };
  /** Выпуск у автора, где иконку убрали, — для предупреждения. */
  removedIn?: string;
  /** Сведения /icon, если поиск ответил при сборке страницы; нет — их спросит браузер. */
  details?: IconDetails;
  /** Подпись иконки в «In context» и соседи из витрины набора. */
  label: string;
  neighbours: MockupNeighbour[];
  /** Названия наборов — для карточек похожих иконок. */
  setNames: Record<string, string>;
}

/** Фон превью: как тема сайта, тёмный, светлый или прозрачный (шахматка). */
export const PREVIEW_BGS = ["auto", "dark", "light", "transparent"] as const;
export type PreviewBg = (typeof PREVIEW_BGS)[number];

/** Сетка превью: включена или выключена. */
export const PREVIEW_GRIDS = ["on", "off"] as const;
export type PreviewGrid = (typeof PREVIEW_GRIDS)[number];
