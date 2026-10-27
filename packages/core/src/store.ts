// Хранилище ядра (ADR-0029, ADR-0030): состояние каждой иконки по полному имени «набор:иконка»,
// слушатели, настройки configure и загрузчики setLoader. В браузере все копии ядра на странице делят
// этот объект под ключом Symbol.for с версией формата: иначе тег регистрирует первая копия, а
// configure и addIcons второй ни на что не влияют. Очередь запросов у каждой копии своя (load.ts):
// общего состояния «загружается» хватает, чтобы копии не запрашивали одно имя дважды, а устройство
// очереди может меняться без смены формата. На сервере у каждого модуля своё: память сервера общая
// для всех запросов (ADR-0033). Поля Store только добавляются; убрать или изменить поле — новая
// версия в ключе.

import { type IconavoIconSet, type IconData, iconData } from "./icon.js";
import { isValidIconName, isValidNamePart } from "./name.js";

/** Состояние имени: данные загруженной иконки или что с ней. */
export type IconState = IconData | "loading" | "missing" | "error";

/** Свой источник набора (setLoader): имена без повторов → IconifyJSON или null. */
export type Loader = (names: string[]) => Promise<IconavoIconSet | null>;

export interface Settings {
  api: string[];
  cdn: string[];
  placeholder: "skeleton" | "spinner" | "none";
  dev?: boolean;
}

export interface Store {
  settings: Settings;
  icons: Map<string, IconState>;
  listeners: Map<string, Set<() => void>>;
  loaders: Map<string, Loader>;
  /** Тексты предупреждений, уже показанных на странице: одно на текст (ADR-0031). */
  warned: Set<string>;
  /**
   * Счётчик отрисовок с ID внутри рисунка (render.ts): у каждой копии иконки свои ID. Поля нет, пока
   * не было ни одной такой отрисовки.
   */
  ids?: number;
}

/**
 * Хосты по умолчанию (ADR-0030): пачки — через edge API, по одной иконке — со статики. Список попадает
 * в CSP сайтов (connect-src), поэтому добавить в него адрес — сломать сайты со строгой CSP.
 */
export const DEFAULT_API = ["https://api.iconavo.dev"];
export const DEFAULT_CDN = [
  "https://cdn.iconavo.dev",
  "https://cdn2.iconavo.dev",
  "https://iconavo.b-cdn.net",
];

const KEY = Symbol.for("iconavo.core.1");

const create = (): Store => ({
  settings: {
    api: [...DEFAULT_API],
    cdn: [...DEFAULT_CDN],
    placeholder: "skeleton",
  },
  icons: new Map(),
  listeners: new Map(),
  loaders: new Map(),
  warned: new Set(),
});

const shared = globalThis as unknown as Record<symbol, Store | undefined>;
const browser = typeof document === "object";
if (browser) shared[KEY] ??= create();

export const store: Store = (browser && shared[KEY]) || create();

/** Значение по ключу; нет — создаётся и кладётся. */
export function upsert<K, V>(
  map: Map<K, V>,
  key: K,
  make: () => NoInfer<V>,
): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

/**
 * Состояние имени для адаптеров — без побочных эффектов, тот же объект при повторе (подходит для
 * useSyncExternalStore). Имя, которое ещё не просили, — «загружается»: запрос после подписки не
 * меняет картинку. Неверное имя — «нет», его не запрашивают.
 */
export const getIcon = (name: string): IconState =>
  isValidIconName(name) ? (store.icons.get(name) ?? "loading") : "missing";

/** Подписка на смену состояния имени; возвращает отписку. Сама ничего не запрашивает. */
export function subscribeIcon(name: string, listener: () => void): () => void {
  const own = upsert(store.listeners, name, () => new Set());
  own.add(listener);
  return () => {
    own.delete(listener);
    if (own.size === 0 && store.listeners.get(name) === own) {
      store.listeners.delete(name);
    }
  };
}

/**
 * Новые состояния имён: сначала записываются все, потом сигнал слушателям каждого имени — слушатель
 * видит пачку целиком. Отписка во время сигнала остальным не мешает.
 */
export function update(changes: Map<string, IconState>): void {
  for (const [name, state] of changes) store.icons.set(name, state);
  for (const name of changes.keys()) {
    for (const listener of [...(store.listeners.get(name) ?? [])]) listener();
  }
}

function resolve(data: IconavoIconSet, name: string): IconData | null {
  try {
    const icon = iconData(data, name);
    return typeof icon?.body === "string" ? icon : null;
  } catch {
    return null;
  }
}

/**
 * Иконки набора в хранилище — каждое имя разрешается сразу, по цепочке алиасов внутри этих данных,
 * как у Iconify. replace (addIcons) заменяет загруженные иконки; ответ хоста и загрузчика заполняет
 * только незагруженные. Имя, которое не разрешилось (петля алиасов, алиас в никуда), и not_found —
 * «нет»; «нет» загруженную иконку не заменяет никогда.
 */
export function addSet(
  prefix: string,
  data: IconavoIconSet,
  replace: boolean,
): void {
  const changes = new Map<string, IconState>();
  const put = (name: string, state: IconState) => {
    const full = `${prefix}:${name}`;
    const loaded = typeof store.icons.get(full) === "object";
    if (
      isValidNamePart(name) &&
      (!loaded || (replace && typeof state === "object"))
    ) {
      changes.set(full, state);
    }
  };
  for (const name of [
    ...Object.keys(data.icons),
    ...Object.keys(data.aliases ?? {}),
  ]) {
    put(name, resolve(data, name) ?? "missing");
  }
  for (const name of data.not_found ?? []) {
    if (!changes.has(`${prefix}:${name}`)) put(name, "missing");
  }
  update(changes);
}
