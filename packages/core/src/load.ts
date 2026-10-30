// Загрузка иконок (ADR-0030): запросы копятся до конца текущей задачи (setTimeout, как у Iconify:
// туда попадают и запросы из микрозадач фреймворков) и уходят пачкой на набор; имя, которое уже
// грузится или загружено, второй раз не запрашивается. Очередь, попытки и манифесты — у этой копии
// ядра, состояния — в общем хранилище (store.ts).
//
// Попытка устроена как sendQuery у Iconify: источники по очереди — пачкой через каждый хост api,
// затем по одной иконке со статики каждого хоста cdn, у набора с setLoader — только загрузчик.
// Источник молчит ROTATE — следующий спрашивается параллельно; последний хост api молчит ROTATE_CDN —
// и первый хост статики; отказал — следующий сразу. Первый ответ с иконкой побеждает; когда иконка
// есть у всех имён, остальные запросы отменяются. «Нет» — только когда так ответили все источники:
// свой хост и наш могут хранить разное, а манифест статики живёт в кэше до 5 минут (ADR-0030).
// Вся попытка — не дольше TIMEOUT. Неудавшаяся повторяется через 1, 2 и 4 с, пока иконку кто-то
// показывает; потом — «ошибка», которую запросят снова при следующем показе. Отмена — AbortController
// с setTimeout, а не AbortSignal.timeout: тот же контроллер отменяет проигравших, а таймеры
// подчиняются поддельному времени тестов.

import type { IconavoIconSet } from "./icon.js";
import { isValidIconName } from "./name.js";
import {
  addSet,
  type IconState,
  type Loader,
  store,
  update,
  upsert,
} from "./store.js";

/** Адрес пачки — не длиннее, как у Iconify; имён — не больше, иначе edge API ответит 400. */
export const MAX_URL = 500;
export const MAX_NAMES = 100;
/** Источник молчит столько — тот же запрос уходит и на следующий (rotate у Iconify). */
export const ROTATE = 750;
/**
 * С API на статику — позже: статика просит по запросу на иконку, а новая пачка edge API собирается
 * из R2 дольше 750 мс (замер шага 6 фазы 3: P95 — 0,74 с из Европы, ADR-0030).
 */
export const ROTATE_CDN = 1500;
/** Вся попытка: дольше — её запросы отменяются, попытка не удалась. */
export const TIMEOUT = 5000;
/** Повторов неудавшейся попытки; пауза перед n-м — 2^(n−1) с: 1, 2 и 4 с. */
export const RETRIES = 3;

/** Слушатели ожидания loadIcons: у него один проход, ради него не повторяют. */
export const passive = new WeakSet<() => void>();

/** Что источники попытки сказали об именах, у которых иконки ещё нет. */
interface Report {
  /** Источник ответил, что имени у него нет. */
  missing: Set<string>;
  /** Источник не ответил об имени: сбой сети, ошибка хоста, не тот ответ. */
  failed: Set<string>;
  /** Последняя ошибка — для предупреждения «failed to load». */
  error?: unknown;
}

/** Источник имён набора: иконки — в хранилище, «нет» и частичные сбои — в отчёт; отказ — сбой всех имён. */
type Source = (
  prefix: string,
  names: string[],
  signal: AbortSignal,
  report: Report,
) => Promise<void>;

/** Наборы манифеста хоста статики. */
type Sets = Record<string, { version?: unknown }>;

/** Набор → имена, ждущие запроса до конца текущей задачи. */
let queue = new Map<string, Set<string>>();

/** Хост статики → его манифест: один запрос за жизнь страницы; не прочитался — забыть. */
const manifests = new Map<string, Promise<Sets>>();

const loading = (name: string) => store.icons.get(name) === "loading";

/** Иконку показывают: у имени есть слушатель, кроме ожидания loadIcons. */
const needed = (name: string) =>
  [...(store.listeners.get(name) ?? [])].some((l) => !passive.has(l));

/** Предупреждение в консоли — одно на текст за время жизни страницы (ADR-0031). */
export function warn(text: string, error?: unknown): void {
  if (store.warned.has(text)) return;
  store.warned.add(text);
  const message = `Iconavo: ${text}`;
  if (error === undefined) console.warn(message);
  else console.warn(message, error);
}

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

/** Статика отвечает так, что файла нет: 404, а у бакета без права на список (S3) — 403. */
const NO_FILE = [403, 404];

/**
 * JSON с хоста. Тело читается всегда: так Node освобождает соединение. Ответ «нет» (по умолчанию 404,
 * как тело ответа Iconify API на неизвестный набор) — число 404. Другой код и не JSON — сбой.
 */
async function fetchJson(
  url: string,
  signal: AbortSignal,
  none: number[] = [404],
): Promise<unknown> {
  const response = await fetch(url, { signal });
  const text = await response.text();
  if (none.includes(response.status)) return 404;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return JSON.parse(text);
}

/** IconifyJSON набора; «нет» — null, то есть «нет» для всех имён запроса. Чужой набор — сбой. */
async function fetchSet(
  url: string,
  prefix: string,
  signal: AbortSignal,
  none?: number[],
): Promise<IconavoIconSet | null> {
  const data = await fetchJson(url, signal, none);
  if (data === 404) return null;
  if (!isSet(data, prefix)) throw new Error("Not an icon set");
  return data;
}

/** Ответ источника на имена: иконки — в хранилище; запрошенные, которых в нём нет, — «нет» этого источника. */
function answer(
  prefix: string,
  names: string[],
  data: IconavoIconSet | null,
  report: Report,
): void {
  if (data) addSet(prefix, data, false, report.missing);
  for (const name of names) {
    if (loading(`${prefix}:${name}`)) report.missing.add(name);
  }
}

/** Версия набора в манифесте своей статики — часть адреса: буквы, цифры, «.», «_» и «-». */
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][\w.-]{0,63}$/.test(value);

/**
 * Манифест хоста статики. Запрос общий для всех попыток этой копии ядра, поэтому у него свой
 * контроллер и свой таймер: попытка, которая закончилась, не отменит его остальным.
 */
function manifest(host: string): Promise<Sets> {
  let sets = manifests.get(host);
  if (!sets) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const own = fetchJson(`${host}/manifest.json`, controller.signal)
      .finally(() => clearTimeout(timer))
      .then((data) => {
        const value = (data as { sets?: unknown } | null)?.sets;
        if (typeof value !== "object" || value === null) {
          throw new Error("Not a manifest");
        }
        return value as Sets;
      });
    own.catch(() => {
      if (manifests.get(host) === own) manifests.delete(host);
    });
    manifests.set(host, own);
    sets = own;
  }
  return sets;
}

/** Пачка с хоста API: IconifyJSON с not_found, неизвестный набор — 404. */
const fromApi =
  (host: string): Source =>
  async (prefix, names, signal, report) =>
    answer(
      prefix,
      names,
      await fetchSet(
        `${host}/${prefix}.json?icons=${names.join(",")}`,
        prefix,
        signal,
      ),
      report,
    );

/**
 * Статика: версия набора — из манифеста хоста, затем файл на имя. Набора нет в манифесте — «нет».
 * Каждый файл пишет свой ответ сразу; не пришедший — сбой этого имени, оно остаётся открытым для
 * следующего хоста. Не пришёл ни один — отказ хоста: следующий спрашивается сразу.
 */
const fromCdn =
  (host: string): Source =>
  async (prefix, names, signal, report) => {
    const sets = await manifest(host);
    if (signal.aborted) return;
    if (!Object.hasOwn(sets, prefix)) {
      answer(prefix, names, null, report);
      return;
    }
    const version = sets[prefix]?.version;
    if (!isVersion(version)) throw new Error("Not a manifest");
    let failed = 0;
    await Promise.all(
      names.map((name) =>
        fetchSet(
          `${host}/v/${version}/${prefix}/${name}.json`,
          prefix,
          signal,
          NO_FILE,
        )
          .then((data) => answer(prefix, [name], data, report))
          .catch((e: unknown) => {
            failed++;
            report.failed.add(name);
            report.error = e;
          }),
      ),
    );
    if (failed === names.length) throw report.error;
  };

/**
 * Свой источник набора (setLoader): ответ — как у хоста, null — «нет» для всех имён. Набор без icons
 * («ничего не нашлось», только not_found) — тоже ответ; не набор или чужой префикс — сбой.
 */
const fromLoader =
  (loader: Loader): Source =>
  async (prefix, names, _signal, report) => {
    const data: unknown = await loader(names);
    if (data === null) return answer(prefix, names, null, report);
    const set = data as Partial<IconavoIconSet>;
    if (
      typeof data !== "object" ||
      set.prefix !== prefix ||
      (set.icons !== undefined &&
        (typeof set.icons !== "object" || set.icons === null))
    ) {
      throw new Error("Not an icon set");
    }
    answer(prefix, names, { ...set, prefix, icons: set.icons ?? {} }, report);
  };

/**
 * Имена, которые всё ещё грузятся: ждут повтора, если повторы не кончились и иконку показывают, иначе
 * — «ошибка» с предупреждением и причиной. Загруженные и «нет» выпадают.
 */
function keep(
  prefix: string,
  names: string[],
  retry: boolean,
  error: unknown,
): string[] {
  const changes = new Map<string, IconState>();
  const out = names.filter((name) => {
    const full = `${prefix}:${name}`;
    if (!loading(full)) return false;
    if (retry && needed(full)) return true;
    changes.set(full, "error");
    warn(`icon "${full}" failed to load`, error);
    return false;
  });
  update(changes);
  return out;
}

/** Конец неудавшейся попытки: повтор через 1, 2 или 4 с; перед ним иконка проверяется ещё раз. */
function fail(
  prefix: string,
  names: string[],
  tries: number,
  error: unknown,
): void {
  const again = keep(prefix, names, tries < RETRIES, error);
  if (again.length > 0) {
    setTimeout(
      () => send(prefix, keep(prefix, again, true, error), tries + 1),
      1000 << tries,
    );
  }
}

/** «Нет» окончательно: так ответили все источники попытки. Предупреждение — одно на имя. */
function gone(prefix: string, names: string[]): void {
  update(new Map(names.map((name) => [`${prefix}:${name}`, "missing"])));
  for (const name of names) warn(`icon "${prefix}:${name}" not found`);
}

/**
 * Одна попытка для куска имён. Открытые имена — те, что в хранилище всё ещё «загружается»: иконка от
 * источника, addIcons и другая копия ядра сами сокращают список, а «нет» одного источника — нет:
 * имя спрашивается у следующих. Конец — у всех имён есть иконка, источники кончились или прошло
 * TIMEOUT: тогда запросы отменяются. Источники кончились — имена, о которых все ответили «нет»
 * (и никто не отказал), — «нет»; остальные открытые — в повтор. firstCdn — номер первого источника
 * статики: до него ждут ROTATE_CDN, а не ROTATE.
 */
function attempt(
  prefix: string,
  names: string[],
  sources: Source[],
  tries: number,
  firstCdn: number,
): void {
  const controller = new AbortController();
  const { signal } = controller;
  let next = 0;
  let running = 0;
  const report: Report = { missing: new Set(), failed: new Set() };
  let rotate: ReturnType<typeof setTimeout> | undefined;
  const open = () => names.filter((name) => loading(`${prefix}:${name}`));
  const finish = (exhausted: boolean) => {
    clearTimeout(rotate);
    clearTimeout(deadline);
    controller.abort();
    const rest = open();
    const missing = exhausted
      ? rest.filter((n) => report.missing.has(n) && !report.failed.has(n))
      : [];
    gone(prefix, missing);
    fail(
      prefix,
      rest.filter((n) => !missing.includes(n)),
      tries,
      report.error,
    );
  };
  const step = (hedge?: boolean): void => {
    if (signal.aborted) return;
    const rest = open();
    if (rest.length === 0 || (running === 0 && next === sources.length)) {
      finish(true);
      return;
    }
    // Источник ещё может ответить: ждать его или порога ROTATE (до статики — ROTATE_CDN).
    if ((running > 0 && !hedge) || next === sources.length) return;
    const source = sources[next++] as Source;
    clearTimeout(rotate);
    if (next < sources.length) {
      rotate = setTimeout(step, next === firstCdn ? ROTATE_CDN : ROTATE, true);
    }
    running++;
    let failed = false;
    source(prefix, rest, signal, report)
      .catch((e: unknown) => {
        // Отказ источника — сбой всех его имён; следующий источник — сразу, без порога.
        failed = true;
        report.error = e;
        for (const name of rest) report.failed.add(name);
      })
      .then(() => {
        running--;
        step(failed);
      });
  };
  const deadline = setTimeout(() => {
    report.error ??= new Error(`No answer in ${TIMEOUT / 1000} s`);
    finish(false);
  }, TIMEOUT);
  step();
}

/**
 * Запрос имён набора — из очереди и из повторов. Источники — по настройкам на этот момент; куски — по
 * самому длинному хосту api, чтобы и на запасном адрес остался в пределах MAX_URL; загрузчику — все
 * имена одним вызовом. Источников нет — «ошибка» сразу: ждать нечего.
 */
function send(prefix: string, names: string[], tries: number): void {
  if (names.length === 0) return;
  const loader = store.loaders.get(prefix);
  const { api, cdn } = store.settings;
  const sources = loader
    ? [fromLoader(loader)]
    : [...api.map(fromApi), ...cdn.map(fromCdn)];
  if (sources.length === 0) {
    keep(prefix, names, false, new Error("No hosts"));
    return;
  }
  const longest = api.reduce((a, b) => (b.length > a.length ? b : a), "");
  const chunks = loader
    ? [names]
    : batches(`${longest}/${prefix}.json?icons=`, names);
  for (const chunk of chunks) {
    attempt(
      prefix,
      chunk,
      sources,
      tries,
      loader ? sources.length : api.length,
    );
  }
}

function flush(): void {
  const waiting = queue;
  queue = new Map();
  for (const [prefix, set] of waiting) {
    // addIcons мог загрузить имя, пока оно ждало в очереди.
    const names = [...set].filter((name) => loading(`${prefix}:${name}`));
    send(prefix, names.sort(), 0);
  }
}

/**
 * Запросить иконку, если её ещё не просили или прошлая попытка не удалась («ошибка» — повтор при
 * следующем показе). Загруженное, «нет» и то, что уже грузится, в сеть не идёт; неверное имя — одно
 * предупреждение.
 */
export function loadIcon(name: string): void {
  if (!isValidIconName(name)) {
    warn(`invalid icon name "${String(name)}"`);
    return;
  }
  const state = store.icons.get(name);
  if (state !== undefined && state !== "error") return;
  const [prefix, icon] = name.split(":") as [string, string];
  update(new Map([[name, "loading"]]));
  if (queue.size === 0) setTimeout(flush);
  upsert(queue, prefix, () => new Set()).add(icon);
}
