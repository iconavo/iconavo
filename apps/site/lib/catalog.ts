// Каталог наборов для сайта (шаг 2 фазы 4, ADR-0037): данные — адреса edge API /collections, /collection
// и /changelog (ADR-0024), при сборке. Сайт показывает ровно то, что уже выложено на раздачу: после
// каждой «Выкладки» он пересобирается (ADR-0039). Ответ не по формату или API не ответил — ошибка сборки,
// как у иконок сайта: иначе вышли бы пустые страницы. Тот же разбор берёт браузер — сетка набора
// догружает список имён сама. Чистые части проверяют тесты без сети.

import { API } from "./api";

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
}

/** Набор для страницы: имена, сведения с полной лицензией и версия данных (X-Iconavo-Version). */
export interface SetData extends Collection {
  info: SetInfo & { license: FullLicense };
  version: string;
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

/** Ответы API за прогон сборки: один набор не скачивается трижды. */
const memo = new Map<string, Promise<{ data: unknown; version: string }>>();

/** JSON адреса API; 404 — undefined, другой сбой — ошибка сборки. */
function getJson(
  path: string,
): Promise<{ data: unknown; version: string } | undefined> {
  const known = memo.get(path);
  if (known !== undefined) return known;
  const promise = (async () => {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`);
    } catch (e) {
      stop(`${API}${path} не ответил: ${(e as Error).message}`);
    }
    if (response.status === 404) return undefined;
    if (!response.ok) stop(`${API}${path} ответил ${response.status}`);
    return {
      data: await response.json(),
      version: response.headers.get("x-iconavo-version") ?? "",
    };
  })().catch((e: Error) => {
    // Сбой не запоминается: браузер повторит запрос при следующем переходе.
    memo.delete(path);
    throw e;
  });
  memo.set(path, promise as Promise<{ data: unknown; version: string }>);
  return promise;
}

/** Все наборы каталога. */
export async function getSets(): Promise<Record<string, SetInfo>> {
  const got = await getJson("/collections");
  if (got === undefined) stop("/collections — 404");
  return parseSets(got.data);
}

/** Набор с именами и полной лицензией; нет такого набора — undefined. */
export async function getSet(prefix: string): Promise<SetData | undefined> {
  const got = await getJson(
    `/collection?prefix=${encodeURIComponent(prefix)}&info=true`,
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
  };
}

/** Имена набора без сведений — их догружает браузер для сетки (≈ 75 КБ у Material Symbols в br). */
export async function getNames(prefix: string): Promise<Collection> {
  const got = await getJson(`/collection?prefix=${encodeURIComponent(prefix)}`);
  if (got === undefined) stop(`набора «${prefix}» нет`);
  return parseCollection(got.data);
}

/** Выпуски всех наборов, свежие сверху. */
export async function getReleases(): Promise<Release[]> {
  const got = await getJson("/changelog");
  if (got === undefined) stop("/changelog — 404");
  return parseReleases(got.data);
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Иконок на странице сетки — как в поиске (ADR-0040). */
export const PAGE_SIZE = 96;

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

/** Категории автора по алфавиту; одинаковый адрес у двух категорий — у второй номер. */
export function categoriesOf(c: Collection): Category[] {
  const seen = new Map<string, number>();
  return Object.entries(c.categories ?? {})
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([title, names]) => {
      const base = categorySlug(title) || "category";
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return {
        title,
        slug: count === 0 ? base : `${base}-${count}`,
        names: [...new Set(names)].sort(order),
      };
    });
}

/** Страниц в списке имён. */
export const pageCount = (total: number) =>
  Math.max(1, Math.ceil(total / PAGE_SIZE));

/** Имена страницы page (с 1). */
export const pageOf = (names: readonly string[], page: number) =>
  names.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
