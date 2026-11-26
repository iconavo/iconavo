// Список событий аналитики (шаг 2 фазы 5, ADR-0043): что сайт отправляет, что пропускает приём
// `POST /event` edge API и что читает отчёт `pnpm analytics`. Правило одно на всех: событие с полем не
// из списка, с неверным значением или без обязательного поля отбрасывается целиком. Ни cookie, ни меток
// о человеке — только что сделано на сайте (ADR-0028); страну и час добавляет приём, сайт их не шлёт.

import { isValidIconName } from "@iconavo-ui/core/internal";
import { normalizeText, QUERY_MAX_LENGTH, STYLES } from "@iconavo-ui/search";

/** Адрес приёма у api.iconavo.dev. */
export const EVENT_PATH = "/event";
/** Откуда приём берёт пачки — только страницы самого сайта (заголовок Origin). */
export const EVENT_ORIGIN = "https://iconavo.dev";
/** Версия пачки: поменяется устройство — новая версия, старые вкладки получат отказ, а не путаницу. */
export const BATCH_VERSION = 1;
/** Событий в пачке — не больше: сайт отправляет раз в 10 секунд, столько не набирается. */
export const MAX_EVENTS = 50;
/** Тело пачки — не больше 16 КБ: самое длинное событие (запрос) — около 400 байт. */
export const MAX_BODY_BYTES = 16_384;
/** Лимит частоты приёма с одного адреса: 60 пачек в минуту, у вкладки — до шести. */
export const EVENT_RATE = { limit: 60, period: 60 } as const;
/** Заголовок проверочной пачки (pnpm api check): такие события в итоги и отчёт не входят. */
export const TEST_HEADER = "x-iconavo-test";

export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];

/** Разделы сайта для просмотров: только раздел, без адреса и параметров (решение владельца). */
export const SECTIONS = [
  "home",
  "search",
  "sets",
  "set",
  "icon",
  "docs",
  "changelog",
  "licenses",
  "other",
] as const;
export type Section = (typeof SECTIONS)[number];

/** Что скопировано (метки шага 5 фазы 4, ADR-0042). */
export const COPY_WHAT = [
  "tag",
  "react",
  "svg",
  "css",
  "css-span",
  "link",
  "install",
  "import",
  "script",
  "name",
  "attribution",
  "icon",
  "png",
  "data-url",
  "jsx",
  "base64",
  "page-link",
] as const;
export type CopyWhat = (typeof COPY_WHAT)[number];

export const DOWNLOAD_FORMATS = ["svg", "png", "zip", "sprite"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

/** Откуда открыта иконка: панель или страница. */
export const OPEN_FROM = [
  "search",
  "set",
  "similar",
  "bag",
  "link",
  "other",
] as const;
export type OpenFrom = (typeof OPEN_FROM)[number];

/** Где переключили стиль: фильтр поиска, чипсы набора, другие стили на странице иконки. */
export const STYLE_WHERE = ["filter", "set", "icon"] as const;

// Виды полей. Тип события выводится из этого же описания — сайт, приём и отчёт не разойдутся.

type Field =
  | { readonly kind: "text"; readonly max: number }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "int"; readonly min: number; readonly max: number }
  | { readonly kind: "bool" }
  | { readonly kind: "icon" }
  | { readonly kind: "token"; readonly pattern: RegExp; readonly max: number }
  | { readonly kind: "list"; readonly of: Field; readonly max: number };

type Spec = Field & { readonly optional?: true };

/** Текст запроса: на приёме нормализуется как у поиска (строчные, ё → е, дефисы — пробелы). */
const text = (max: number) => ({ kind: "text", max }) as const;
const oneOf = <const T extends readonly string[]>(values: T) =>
  ({ kind: "enum", values }) as const;
const int = (min: number, max: number) => ({ kind: "int", min, max }) as const;
const bool = { kind: "bool" } as const;
/** Имя иконки `набор:иконка` по ADR-0001. */
const icon = { kind: "icon" } as const;
const token = (pattern: RegExp, max: number) =>
  ({ kind: "token", pattern, max }) as const;
const list = <const F extends Field>(of: F, max: number) =>
  ({ kind: "list", of, max }) as const;
const optional = <const F extends Field>(
  field: F,
): F & { readonly optional: true } => ({ ...field, optional: true });

const SET_ID = token(/^[a-z0-9]+(-[a-z0-9]+)*$/, 64);
const LICENSE = token(/^[A-Za-z0-9.+-]+$/, 32);
/** Секунды — до суток: вкладка, открытая дольше, — не «время до первой иконки». */
const SECONDS = int(0, 86_400);

/**
 * События. `entry` у копирования и скачивания — секунды от входа на сайт, только у первого во
 * вкладке: «время до первой иконки». `position` у запроса — место первой открытой иконки в выдаче;
 * нет поля — с выдачей ничего не открыли.
 */
export const EVENTS = {
  page: { section: oneOf(SECTIONS) },
  query: {
    q: text(QUERY_MAX_LENGTH),
    results: int(0, 1_000_000),
    semantic: bool,
    style: optional(oneOf(STYLES)),
    sets: optional(list(SET_ID, 25)),
    licenses: optional(list(LICENSE, 10)),
    pages: int(1, 1000),
    first: bool,
    position: optional(int(1, 1000)),
    copied: bool,
    downloaded: bool,
  },
  success: { queries: int(1, 1000), seconds: SECONDS },
  copy: {
    what: oneOf(COPY_WHAT),
    icon: optional(icon),
    format: optional(token(/^[A-Za-z]+$/, 16)),
    size: optional(int(1, 4096)),
    entry: optional(SECONDS),
  },
  download: {
    format: oneOf(DOWNLOAD_FORMATS),
    icon: optional(icon),
    size: optional(int(1, 4096)),
    count: optional(int(1, 500)),
    entry: optional(SECONDS),
  },
  open: { from: oneOf(OPEN_FROM), icon },
  style: { style: oneOf(STYLES), where: oneOf(STYLE_WHERE) },
} as const satisfies Record<string, Record<string, Spec>>;

export type EventName = keyof typeof EVENTS;
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

type ValueOf<F> = F extends { kind: "enum"; values: readonly (infer V)[] }
  ? V
  : F extends { kind: "int" }
    ? number
    : F extends { kind: "bool" }
      ? boolean
      : F extends { kind: "list"; of: infer O }
        ? ValueOf<O>[]
        : string;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type FieldsOf<S> = Simplify<
  {
    -readonly [K in keyof S as S[K] extends { optional: true }
      ? never
      : K]: ValueOf<S[K]>;
  } & {
    -readonly [K in keyof S as S[K] extends { optional: true }
      ? K
      : never]?: ValueOf<S[K]>;
  }
>;

export type EventOf<N extends EventName> = Simplify<
  { name: N } & FieldsOf<(typeof EVENTS)[N]>
>;

/** Событие сайта — одно из списка, с полями своего вида. */
export type SiteEvent = { [N in EventName]: EventOf<N> }[EventName];

const INVALID = Symbol("invalid");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fieldValue(field: Field, value: unknown): unknown {
  switch (field.kind) {
    case "text": {
      if (typeof value !== "string" || value.length > field.max) return INVALID;
      const normalized = normalizeText(value).slice(0, field.max);
      return normalized === "" ? INVALID : normalized;
    }
    case "enum":
      return typeof value === "string" && field.values.includes(value)
        ? value
        : INVALID;
    case "int":
      return Number.isInteger(value) &&
        (value as number) >= field.min &&
        (value as number) <= field.max
        ? value
        : INVALID;
    case "bool":
      return typeof value === "boolean" ? value : INVALID;
    case "icon":
      return typeof value === "string" &&
        value.length <= 128 &&
        isValidIconName(value)
        ? value
        : INVALID;
    case "token":
      return typeof value === "string" &&
        value.length > 0 &&
        value.length <= field.max &&
        field.pattern.test(value)
        ? value
        : INVALID;
    case "list": {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > field.max
      ) {
        return INVALID;
      }
      const out: unknown[] = [];
      for (const item of value) {
        const v = fieldValue(field.of, item);
        if (v === INVALID) return INVALID;
        out.push(v);
      }
      return out;
    }
  }
}

export type Checked =
  | { ok: true; event: SiteEvent }
  | { ok: false; reason: string };

/**
 * Событие по списку. Причина отказа — для отчёта: `event:name` (имени нет в списке), `event:shape`
 * (не объект), `event:{имя}:extra` (лишнее поле) или `event:{имя}:{поле}` (неверное значение).
 */
export function checkEvent(raw: unknown): Checked {
  if (!isRecord(raw)) return { ok: false, reason: "event:shape" };
  const name = raw.name;
  if (typeof name !== "string" || !Object.hasOwn(EVENTS, name)) {
    return { ok: false, reason: "event:name" };
  }
  const spec: Readonly<Record<string, Spec>> = EVENTS[name as EventName];
  for (const key of Object.keys(raw)) {
    if (key !== "name" && !Object.hasOwn(spec, key)) {
      return { ok: false, reason: `event:${name}:extra` };
    }
  }
  const event: Record<string, unknown> = { name };
  for (const [key, field] of Object.entries(spec)) {
    const given = raw[key];
    if (given === undefined) {
      if (field.optional) continue;
      return { ok: false, reason: `event:${name}:${key}` };
    }
    const value = fieldValue(field, given);
    if (value === INVALID) return { ok: false, reason: `event:${name}:${key}` };
    event[key] = value;
  }
  return { ok: true, event: event as SiteEvent };
}

export type ParsedBatch =
  | { ok: true; lang: Lang; events: SiteEvent[]; rejected: string[] }
  | { ok: false };

const BATCH_KEYS = new Set(["v", "lang", "events"]);

/** Пачка `{ v, lang, events }`: устройство неверное — отказ целиком, неверные события — по одному. */
export function parseBatch(raw: unknown): ParsedBatch {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !BATCH_KEYS.has(key)) ||
    raw.v !== BATCH_VERSION ||
    typeof raw.lang !== "string" ||
    !(LANGS as readonly string[]).includes(raw.lang) ||
    !Array.isArray(raw.events) ||
    raw.events.length === 0 ||
    raw.events.length > MAX_EVENTS
  ) {
    return { ok: false };
  }
  const events: SiteEvent[] = [];
  const rejected: string[] = [];
  for (const item of raw.events) {
    const checked = checkEvent(item);
    if (checked.ok) events.push(checked.event);
    else rejected.push(checked.reason);
  }
  return { ok: true, lang: raw.lang as Lang, events, rejected };
}

/** Тело пачки, как его отправляет сайт. */
export const batchBody = (lang: Lang, events: readonly SiteEvent[]): string =>
  JSON.stringify({ v: BATCH_VERSION, lang, events });
