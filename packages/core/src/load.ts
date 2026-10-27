// Загрузка иконок (ADR-0030): запросы копятся до конца текущей задачи (setTimeout, как у Iconify:
// туда попадают и запросы из микрозадач фреймворков) и уходят пачкой на набор; имя, которое уже
// грузится или загружено, второй раз не запрашивается. Очередь — у этой копии ядра, состояния — в
// общем хранилище (store.ts). Шаг 2 фазы 3 — один хост: первый из списка api. Повторы, порог 750 мс,
// общий таймаут 5 с и статика — шаг 3.

import type { IconavoIconSet } from "./icon.js";
import { isValidIconName } from "./name.js";
import { addSet, type IconState, store, update, upsert } from "./store.js";

/** Адрес пачки — не длиннее, как у Iconify; имён — не больше, иначе edge API ответит 400. */
export const MAX_URL = 500;
export const MAX_NAMES = 100;

/** Набор → имена, ждущие запроса до конца текущей задачи. */
let queue = new Map<string, Set<string>>();

/** Куски имён (по кодам символов) для адресов base + «a,b,c»: каждый в пределах MAX_URL и MAX_NAMES. */
export function batches(base: string, names: string[]): string[][] {
  const out: string[][] = [];
  let chunk: string[] = [];
  let length = base.length - 1;
  for (const name of names) {
    if (
      chunk.length > 0 &&
      (length + 1 + name.length > MAX_URL || chunk.length === MAX_NAMES)
    ) {
      out.push(chunk);
      chunk = [];
      length = base.length - 1;
    }
    chunk.push(name);
    length += 1 + name.length;
  }
  if (chunk.length > 0) out.push(chunk);
  return out;
}

const isSet = (data: unknown, prefix: string): data is IconavoIconSet =>
  typeof data === "object" &&
  data !== null &&
  (data as IconavoIconSet).prefix === prefix &&
  typeof (data as IconavoIconSet).icons === "object" &&
  (data as IconavoIconSet).icons !== null;

/**
 * Пачка с хоста API. Тело читается всегда: так Node освобождает соединение. Неизвестный набор — 404
 * или ответ 200 с телом 404, как у Iconify API: null, то есть «нет» для всех имён. Другой код, не
 * JSON, чужой набор — ошибка.
 */
async function fetchBatch(
  url: string,
  prefix: string,
): Promise<IconavoIconSet | null> {
  const response = await fetch(url);
  const text = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: unknown = JSON.parse(text);
  if (data === 404) return null;
  if (!isSet(data, prefix)) throw new Error("Not an icon set");
  return data;
}

/**
 * Ответ на имена одного запроса: данные — в хранилище; имена, которые всё ещё грузятся, — «нет»,
 * если ответ пришёл (not_found или их нет в ответе), и «ошибка», если запрос не удался.
 */
async function settle(
  prefix: string,
  names: string[],
  get: () => Promise<IconavoIconSet | null>,
): Promise<void> {
  let failed = false;
  try {
    const data = await get();
    if (data) addSet(prefix, data, false);
  } catch {
    failed = true;
  }
  const changes = new Map<string, IconState>();
  for (const name of names) {
    const full = `${prefix}:${name}`;
    if (store.icons.get(full) === "loading") {
      changes.set(full, failed ? "error" : "missing");
    }
  }
  update(changes);
}

function flush(): void {
  const waiting = queue;
  queue = new Map();
  for (const [prefix, set] of waiting) {
    // addIcons мог загрузить имя, пока оно ждало в очереди.
    const names = [...set]
      .filter((name) => store.icons.get(`${prefix}:${name}`) === "loading")
      .sort();
    if (names.length === 0) continue;
    const loader = store.loaders.get(prefix);
    const host = store.settings.api[0];
    if (loader) {
      void settle(prefix, names, () => loader(names));
    } else if (host === undefined) {
      void settle(prefix, names, () => Promise.reject(new Error("No host")));
    } else {
      const base = `${host}/${prefix}.json?icons=`;
      for (const chunk of batches(base, names)) {
        void settle(prefix, chunk, () =>
          fetchBatch(base + chunk.join(","), prefix),
        );
      }
    }
  }
}

/**
 * Запросить иконку, если её ещё не просили или прошлая попытка не удалась («ошибка» — повтор при
 * следующем показе). Загруженное, «нет» и то, что уже грузится, в сеть не идёт.
 */
export function loadIcon(name: string): void {
  if (!isValidIconName(name)) return;
  const state = store.icons.get(name);
  if (state !== undefined && state !== "error") return;
  const [prefix, icon] = name.split(":") as [string, string];
  update(new Map([[name, "loading"]]));
  if (queue.size === 0) setTimeout(flush);
  upsert(queue, prefix, () => new Set()).add(icon);
}
