// Каталог наборов для сайта (шаг 2 фазы 4, ADR-0037): данные — адреса edge API /collections, /collection
// и /changelog (ADR-0024). Сайт показывает ровно то, что уже выложено на раздачу. Ответ не по формату или
// API не ответил — ошибка сборки страницы, как у иконок сайта: иначе вышли бы пустые страницы, а при
// пересборке из кэша остаётся прежняя. Тот же разбор берёт браузер — сетка набора догружает список имён
// сама. Чистые части проверяют тесты без сети.
//
// Кэш страниц и сброс по наборам (шаг 4 фазы 4, ADR-0039): на сервере у каждого запроса — метка кэша
// страниц Vercel. Метку выбирает страница, а не адрес: страница набора и страницы его иконок —
// set-{набор}, общие страницы (главная, /sets, /licenses, /changelog, поиск) — catalog, даже когда
// спрашивают про отдельный набор: иначе у главной было бы по метке на набор, а Vercel и Next.js хранят
// не больше 128 меток на ответ. Выпуск набора сбрасывает set-{набор} и catalog.

import {
  type Card,
  groupCards,
  isStyle,
  STYLES,
  type Style,
} from "@iconavo-ui/search";
import { cache } from "react";
import { API, fetchApi } from "./api";

/** Метка общих страниц: их данные — весь каталог (ADR-0039). */
export const CATALOG_TAG = "catalog";

/** Метка страницы набора и страниц его иконок (ADR-0039). */
export const setTag = (prefix: string) => `set-${prefix}`;

/**
 * Метка запросов общей раскладки — левой панели с наборами и числами иконок (редизайн, ADR-0039). Её
 * носит каждая страница, поэтому сброс по наборам её не трогает: иначе выпуск любого набора сбрасывал бы
 * все страницы иконок. Числа в панели обновляет выкладка сайта (решение владельца 17 ноября 2026).
 */
export const SHELL_TAG = "shell";

/** Лицензия в сведениях о наборе — как у Iconify. */
export interface SetLicense {
  title: string;
  spdx: string;
  url?: string;
}

/** Сведения о наборе — IconifyInfo из /collections. */
export interface SetInfo {
  name: string;
  total: number;
  /** Версия у автора: версия npm или 7 знаков коммита. */
  version: string;
  author: { name: string; url?: string };
  license: SetLicense;
  samples?: string[];
  height: number | number[];
  palette: boolean;
}

/**
 * Сведения о наборе для панели иконки: название, автор, лицензия без текста, цветной ли набор. Их
 * отдаёт панели сама страница — они у неё с сервера, и раздел «автор и лицензия» рисуется вместе с
 * панелью, а не после ответа /collections (18 ноября 2026).
 */
export interface PanelSet {
  name: string;
  author: { name: string; url?: string };
  license: SetLicense;
  palette: boolean;
}

/** Только то, что нужно панели: полный текст лицензии (килобайты) в браузер не едет. */
export const panelSet = (info: SetInfo): PanelSet => ({
  name: info.name,
  author:
    info.author.url === undefined
      ? { name: info.author.name }
      : { name: info.author.name, url: info.author.url },
  license: {
    title: info.license.title,
    spdx: info.license.spdx,
    ...(info.license.url === undefined ? {} : { url: info.license.url }),
  },
  palette: info.palette,
});

/** Лицензия полностью — дополнение Iconavo в /collection?info=true (ADR-0017). */
export interface FullLicense extends SetLicense {
  text: string;
  notice?: string;
  source: string;
  revision: string;
}

/** Имена набора из /collection — как у Iconify. */
export interface Collection {
  prefix: string;
  title: string;
  total: number;
  categories?: Record<string, string[]>;
  uncategorized?: string[];
  hidden?: string[];
  aliases?: Record<string, string>;
  suffixes?: Record<string, string>;
  /** Стиль общей шкалы → суффиксы вариантов без дефиса (ADR-0052) — дополнение Iconavo. */
  styles?: Record<string, string[]>;
}

/**
 * Набор для страницы: имена, сведения с полной лицензией, версия данных (X-Iconavo-Version) и отпечаток
 * содержимого (X-Iconavo-Content): по нему pnpm site --refresh видит, что страницу пора сбросить.
 */
export interface SetData extends Collection {
  info: SetInfo & { license: FullLicense };
  version: string;
  content: string;
}

/** Выпуск набора из /changelog (ADR-0018). */
export interface Release {
  prefix: string;
  version: string;
  previous?: string;
  date: string;
  revision: string;
  total: number;
  added?: string[];
  changed?: string[];
  restored?: string[];
  hidden?: string[];
  renamed?: Record<string, string>;
  aliases?: Record<string, string>;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const isStringMap = (value: unknown): value is Record<string, string> =>
  isObject(value) && Object.values(value).every((v) => typeof v === "string");

function stop(what: string): never {
  throw new Error(
    `СТОП: каталог наборов — ${what}. Edge API отвечает не так, как ждёт сайт (ADR-0024)`,
  );
}

/** Сведения о наборе; не тот формат — ошибка с именем набора. */
export function parseInfo(id: string, value: unknown): SetInfo {
  if (
    !isObject(value) ||
    typeof value.name !== "string" ||
    typeof value.total !== "number" ||
    typeof value.version !== "string" ||
    typeof value.palette !== "boolean" ||
    !isObject(value.author) ||
    typeof value.author.name !== "string" ||
    !isObject(value.license) ||
    typeof value.license.title !== "string" ||
    typeof value.license.spdx !== "string" ||
    (value.samples !== undefined && !isStrings(value.samples))
  ) {
    stop(`сведения о наборе «${id}» не по формату IconifyInfo`);
  }
  return value as unknown as SetInfo;
}

/** Ответ /collections: набор → сведения. */
export function parseSets(value: unknown): Record<string, SetInfo> {
  if (!isObject(value)) stop("/collections не объект");
  const out: Record<string, SetInfo> = {};
  for (const [id, info] of Object.entries(value)) out[id] = parseInfo(id, info);
  return out;
}

/** Ответ /collection: имена по категориям, скрытые, алиасы, суффиксы. */
export function parseCollection(value: unknown): Collection {
  if (
    !isObject(value) ||
    typeof value.prefix !== "string" ||
    typeof value.title !== "string" ||
    typeof value.total !== "number" ||
    (value.uncategorized !== undefined && !isStrings(value.uncategorized)) ||
    (value.hidden !== undefined && !isStrings(value.hidden)) ||
    (value.aliases !== undefined && !isStringMap(value.aliases)) ||
    (value.suffixes !== undefined && !isStringMap(value.suffixes)) ||
    (value.styles !== undefined &&
      (!isObject(value.styles) ||
        !Object.values(value.styles).every(isStrings))) ||
    (value.categories !== undefined &&
      (!isObject(value.categories) ||
        !Object.values(value.categories).every(isStrings)))
  ) {
    stop("/collection не по формату Iconify");
  }
  return value as unknown as Collection;
}

/** Ответ /changelog: выпуски, свежие сверху. */
export function parseReleases(value: unknown): Release[] {
  if (!isObject(value) || !Array.isArray(value.releases)) {
    stop("/changelog без releases");
  }
  for (const r of value.releases) {
    if (
      !isObject(r) ||
      typeof r.prefix !== "string" ||
      typeof r.version !== "string" ||
      typeof r.date !== "string" ||
      typeof r.revision !== "string" ||
      typeof r.total !== "number"
    ) {
      stop("выпуск в /changelog не по формату");
    }
  }
  return value.releases as Release[];
}

/** Ответ адреса API: тело, версия набора и отпечаток содержимого из заголовков. */
interface Got {
  data: unknown;
  version: string;
  content: string;
}

const onServer = typeof window === "undefined";

/** JSON адреса API; 404 — undefined, другой сбой — ошибка (после одного повтора, fetchApi). */
async function load(path: string, tag: string): Promise<Got | undefined> {
  let response: Response;
  try {
    // Без cache: ответ не ложится в кэш запросов Next.js — тот пережил бы выкладки; метка достаётся
    // странице, и сброс по ней пересоберёт её из свежих данных (ADR-0039).
    response = await fetchApi(
      `${API}${path}`,
      onServer ? { next: { tags: [tag] } } : undefined,
    );
  } catch (e) {
    stop(`${API}${path} не ответил: ${(e as Error).message}`);
  }
  if (response.status === 404) return undefined;
  if (!response.ok) stop(`${API}${path} ответил ${response.status}`);
  let data: unknown;
  try {
    data = await response.json();
  } catch (e) {
    // Битый ответ — остановка с адресом, а не голая SyntaxError (ревизия фазы 5, С-37).
    stop(`${API}${path}: ответ не JSON — ${(e as Error).message}`);
  }
  return {
    data,
    version: response.headers.get("x-iconavo-version") ?? "",
    content: response.headers.get("x-iconavo-content") ?? "",
  };
}

/**
 * На сервере — один запрос на сборку страницы (React cache): память процесса держала бы старые данные
 * после выпуска, пока функция Vercel тёплая, и пересобранная страница вышла бы прежней.
 */
const perRender = cache(load);

/** В браузере — память вкладки: сетка не скачивает список имён дважды. */
const memo = new Map<string, Promise<Got | undefined>>();

function getJson(path: string, tag: string): Promise<Got | undefined> {
  if (onServer) return perRender(path, tag);
  const known = memo.get(path);
  if (known !== undefined) return known;
  const promise = load(path, tag).catch((e: Error) => {
    // Сбой не запоминается: браузер повторит запрос при следующем переходе.
    memo.delete(path);
    throw e;
  });
  memo.set(path, promise);
  return promise;
}

/**
 * Все наборы каталога. Метка — по странице: страница иконки берёт отсюда только названия наборов похожих
 * иконок и передаёт setTag своего набора.
 */
export async function getSets(
  tag: string = CATALOG_TAG,
): Promise<Record<string, SetInfo>> {
  const got = await getJson("/collections", tag);
  if (got === undefined) stop("/collections — 404");
  return parseSets(got.data);
}

/**
 * Набор с именами и полной лицензией; нет такого набора — undefined. Метка — по странице: общие
 * страницы передают CATALOG_TAG.
 */
export async function getSet(
  prefix: string,
  tag: string = setTag(prefix),
): Promise<SetData | undefined> {
  const got = await getJson(
    `/collection?prefix=${encodeURIComponent(prefix)}&info=true`,
    tag,
  );
  if (got === undefined) return undefined;
  const collection = parseCollection(got.data);
  const info = parseInfo(prefix, (got.data as Json).info);
  const license = info.license as Partial<FullLicense>;
  if (
    typeof license.text !== "string" ||
    typeof license.source !== "string" ||
    typeof license.revision !== "string"
  ) {
    stop(`у набора «${prefix}» нет полного текста лицензии`);
  }
  return {
    ...collection,
    info: info as SetInfo & { license: FullLicense },
    version: got.version,
    content: got.content,
  };
}

/**
 * Имена набора без сведений — их догружает браузер для сетки (≈ 75 КБ у Material Symbols в br). Метка —
 * по странице, как у getSet: общие страницы (главная) передают CATALOG_TAG.
 */
export async function getNames(
  prefix: string,
  tag: string = setTag(prefix),
): Promise<Collection> {
  const got = await getJson(
    `/collection?prefix=${encodeURIComponent(prefix)}`,
    tag,
  );
  if (got === undefined) stop(`набора «${prefix}» нет`);
  return parseCollection(got.data);
}

/**
 * Выпуски всех наборов, свежие сверху; с prefix — только этого набора. Метка — по странице: страница
 * набора берёт отсюда только свой последний выпуск, страница иконки — даты иконки, обе передают setTag.
 */
export async function getReleases(
  tag: string = CATALOG_TAG,
  prefix?: string,
): Promise<Release[]> {
  const got = await getJson(
    prefix === undefined
      ? "/changelog"
      : `/changelog?prefix=${encodeURIComponent(prefix)}`,
    tag,
  );
  if (got === undefined) stop("/changelog — 404");
  return parseReleases(got.data);
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Иконок на странице сетки — около 96, как в поиске (ADR-0040), но всегда целыми рядами (решение
 * владельца 13 ноября 2026): сколько колонок, знает только браузер (lib/grid-columns.ts), и страница —
 * столько полных рядов, сколько ближе всего к 96 (pageSizeFor). Пока колонки не посчитаны (серверный HTML
 * и гидратация) — ровно 96. Другое число выбирают в настройках сетки (ADR-0054).
 */
export const PAGE_SIZE = 96;

/**
 * Иконок на странице при columns колонках: целые ряды, ближе всего к target — числу из настроек сетки
 * (48, 96, 144 или 192, lib/grid-settings.ts; ADR-0054), по умолчанию PAGE_SIZE.
 */
export function pageSizeFor(
  columns: number,
  target: number = PAGE_SIZE,
): number {
  const cols = Math.max(1, Math.floor(columns));
  return cols * Math.max(1, Math.round(target / cols));
}

/** Наибольшее число на странице из настроек сетки (PER_PAGE_CHOICES в lib/grid-settings.ts, ADR-0054). */
export const PER_PAGE_MAX = 192;

/** Наибольшая страница целыми рядами при любой ширине до 32 колонок. */
const firstPageAt = (target: number) =>
  Math.max(...Array.from({ length: 32 }, (_, i) => pageSizeFor(i + 1, target)));

/**
 * Сколько первых карточек набора сервер отдаёт браузеру — имена: первой страницы хватает при любой ширине
 * и любом числе на странице из настроек, и браузер дополняет ряд без запроса к API. Раньше — только под
 * 96, и при 144 и 192 первая страница мигала скелетонами (ревизия фазы 5, С-31).
 */
export const FIRST_PAGE_MAX = firstPageAt(PER_PAGE_MAX);

/**
 * Рисунки из серверного HTML — для первой страницы при 96 на странице (PAGE_SIZE): у остальных карточек
 * первой страницы их догружает ядро браузера одной пачкой, а HTML страницы не растёт вдвое.
 */
export const FIRST_ICONS_MAX = firstPageAt(PAGE_SIZE);

/**
 * Наборы в витрине: популярность ещё не измерить (аналитика — шаг 7), поэтому порядок задан списком;
 * новые наборы — после них, по алфавиту.
 */
export const FEATURED = [
  "lucide",
  "tabler",
  "material-symbols",
  "ph",
  "fluent-emoji-flat",
];

/** Наборы в порядке витрины. */
export function orderSets(ids: readonly string[]): string[] {
  const rank = (id: string) => {
    const i = FEATURED.indexOf(id);
    return i === -1 ? FEATURED.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || order(a, b));
}

/**
 * Группы наборов главной и боковой панели — по макету (Figma «Iconavo — Макеты»: Material, UI 24px,
 * UI 16px / 32px, Brands, Emoji). У нас пока три: набора нет в списке — цветной идёт в эмодзи,
 * остальные — в UI 24px.
 */
export const SET_GROUPS = [
  { id: "material", sets: ["material-symbols"] },
  { id: "ui-24", sets: ["lucide", "tabler", "ph"] },
  { id: "emoji", sets: ["fluent-emoji-flat"] },
] as const;

export type SetGroupId = (typeof SET_GROUPS)[number]["id"];

/** Наборы по группам, внутри — в порядке витрины; пустых групп нет. */
export function groupSets(
  sets: Record<string, Pick<SetInfo, "palette">>,
): { id: SetGroupId; ids: string[] }[] {
  const groupOf = (id: string): SetGroupId =>
    SET_GROUPS.find((g) => (g.sets as readonly string[]).includes(id))?.id ??
    (sets[id]?.palette ? "emoji" : "ui-24");
  const ids = orderSets(Object.keys(sets));
  return SET_GROUPS.map((g) => ({
    id: g.id,
    ids: ids.filter((id) => groupOf(id) === g.id),
  })).filter((g) => g.ids.length > 0);
}

/** Знакомые имена для витрины карточки, если своих шести мало: их ищут по набору по порядку. */
const SHOWCASE_EXTRAS = [
  "star",
  "heart",
  "bell",
  "camera",
  "settings",
  "user",
  "mail",
  "search",
  "red-heart",
  "fire",
  "rocket",
  "sparkles",
  "light-bulb",
];

/**
 * Витрина карточки набора — 3 × 3 по макету: шесть иконок витрины автора набора (info.samples) и
 * знакомые имена из набора, затем первые его имена.
 */
export function showcase(
  samples: readonly string[],
  c: Collection,
  size = 9,
): string[] {
  const names = visibleNames(c);
  const have = new Set(names);
  const picked = [...new Set(samples)].filter((n) => have.has(n));
  for (const name of [...SHOWCASE_EXTRAS, ...names]) {
    if (picked.length >= size) break;
    if (have.has(name) && !picked.includes(name)) picked.push(name);
  }
  return picked.slice(0, size);
}

/** Видимые имена набора: категории и uncategorized, без повторов, по кодам символов, как у Iconify. */
export function visibleNames(c: Collection): string[] {
  return [
    ...new Set([
      ...(c.uncategorized ?? []),
      ...Object.values(c.categories ?? {}).flat(),
    ]),
  ].sort(order);
}

/** Категория для адреса: строчные буквы и цифры через дефис — «Animals & Nature» → animals-nature. */
export function categorySlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export interface Category {
  title: string;
  slug: string;
  names: string[];
}

/**
 * Категории автора по алфавиту; одинаковый адрес у двух категорий — у второй номер, и номер не совпадает с
 * адресом другой категории («Arrows 1» и вторая «Arrows»; ревизия фазы 5, С-36).
 */
export function categoriesOf(c: Collection): Category[] {
  const entries = Object.entries(c.categories ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  );
  const taken = new Set(
    entries.map(([title]) => categorySlug(title) || "category"),
  );
  const used = new Set<string>();
  return entries.map(([title, names]) => {
    const base = categorySlug(title) || "category";
    let slug = base;
    for (let n = 1; used.has(slug) || (slug !== base && taken.has(slug)); n++) {
      slug = `${base}-${n}`;
    }
    used.add(slug);
    return { title, slug, names: [...new Set(names)].sort(order) };
  });
}

/** Суффикс из /collection — без дефиса, как у Iconify; правилу карточек он нужен с дефисом. */
const dashed = (suffix: string) => (suffix === "" ? "" : `-${suffix}`);

/** Стили набора в порядке общей шкалы (ADR-0052). */
export function setStyles(c: Collection): Style[] {
  return STYLES.filter((style) => (c.styles?.[style]?.length ?? 0) > 0);
}

export interface SetCards {
  /** Карточки по кодам символов имени базовой иконки. */
  cards: Card[];
  /** Видимое имя или алиас → карточка. */
  cardOf: Map<string, string>;
}

/**
 * Карточки набора (шаг 3 фазы 4, ADR-0052): база, варианты, оттенки кожи и главное имя каждого стиля —
 * тем же правилом, что у индекса поиска (groupCards общего модуля).
 */
export function setCards(c: Collection): SetCards {
  const styles: Partial<Record<Style, string[]>> = {};
  for (const [style, list] of Object.entries(c.styles ?? {})) {
    if (isStyle(style)) styles[style] = list.map(dashed);
  }
  return groupCards({
    names: visibleNames(c),
    aliases: Object.entries(c.aliases ?? {}),
    suffixes: Object.keys(c.suffixes ?? {}).map(dashed),
    styles,
  });
}

/** Карточки категории: её имена → их карточки, без повторов, в порядке карточек набора. */
export function categoryCards(names: readonly string[], set: SetCards): Card[] {
  const bases = new Set(names.map((n) => set.cardOf.get(n) ?? n));
  return set.cards.filter((card) => bases.has(card.base));
}

/** Карточки в стиле: только те, у которых он есть; без стиля — все. */
export const cardsInStyle = (cards: readonly Card[], style?: Style) =>
  style === undefined ? [...cards] : cards.filter((c) => c.styles[style]);

/** Имя карточки для показа: главное имя стиля, без стиля — база. */
export const shownName = (card: Card, style?: Style) =>
  (style === undefined ? undefined : card.styles[style]) ?? card.base;

/** Текст поиска по набору как имя иконки: строчные, пробелы и дефисы — один дефис, края без дефисов. */
export const nameQuery = (q: string) =>
  q
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Поиск по набору на его странице (редизайн по макету Figma, шаг 2): карточки, у которых имя базы или
 * любого варианта содержит текст запроса. Без смысла и тегов — по именам, прямо в браузере: Meilisearch
 * для этого не нужен. Пустой запрос — все карточки.
 */
export function filterCards(cards: readonly Card[], q: string): Card[] {
  const needle = nameQuery(q);
  if (needle === "") return [...cards];
  return cards.filter(
    (card) =>
      card.base.includes(needle) ||
      card.variants.some((name) => name.includes(needle)),
  );
}

/** Страниц в списке имён при size на странице. */
export const pageCount = (total: number, size = PAGE_SIZE) =>
  Math.max(1, Math.ceil(total / size));

/** Элементы страницы page (с 1) при size на странице: имена или карточки. */
export const pageOf = <T>(
  items: readonly T[],
  page: number,
  size = PAGE_SIZE,
): T[] => items.slice((page - 1) * size, page * size);

/** Номера для навигации: первая, соседние с текущей и последняя; между ними — пропуск «gap». */
export function pageItems(page: number, pages: number): (number | "gap")[] {
  const keep = [
    ...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1)),
  ]
    .filter((p) => p <= pages)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (const p of keep) {
    const last = out.at(-1);
    if (typeof last === "number" && p - last > 1) out.push("gap");
    out.push(p);
  }
  return out;
}

/** Номер страницы из адреса: целое от 1 до pages, иначе 1. */
export function pageParam(value: string | null, pages: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= pages ? n : 1;
}

/** Версия источника для людей: версия npm как есть, коммит git — 7 знаков. */
export const revisionLabel = (revision: string) =>
  /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;

/** Сколько изменений каждого вида в выпуске. */
export function releaseCounts(r: Release) {
  return {
    added: r.added?.length ?? 0,
    changed: r.changed?.length ?? 0,
    restored: r.restored?.length ?? 0,
    hidden: r.hidden?.length ?? 0,
    renamed: Object.keys(r.renamed ?? {}).length,
    aliases: Object.keys(r.aliases ?? {}).length,
  };
}
