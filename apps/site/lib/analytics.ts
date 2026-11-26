// Аналитика сайта (шаг 2 фазы 5, ADR-0043): события копятся в памяти вкладки и уходят пачкой на
// `POST /event` edge API — раз в 10 секунд, при уходе со страницы и когда вкладка уходит в фон.
// Отправка — navigator.sendBeacon с телом text/plain: без предварительного запроса CORS, и уходит даже
// при закрытии вкладки. Ни cookie, ни меток в хранилище браузера, ни идентификаторов — только что
// сделано на сайте; страну и час добавляет приём. Ничего не уходит в next dev и Storybook, с сигналом
// Global Privacy Control или Do Not Track и с чужого адреса сайта (кроме проверки сайта: ей адрес API
// задан). Событие страницы iconavo:track — как раньше: по нему проверка сайта видит метки.
//
// Поиск. Запрос — показанная выдача: текст и фильтры. Засчитывается, если с выдачей что-то сделали
// (открыли иконку, сменили страницу, скопировали или скачали) или она простояла на экране 2 секунды:
// иначе это буквы, набранные по мере ввода (решение владельца 26 ноября 2026). Закрывается новым
// запросом, уходом со страницы поиска и уходом вкладки в фон — телефоны о закрытии вкладки часто не
// сообщают. Поисковая сессия — от первого засчитанного запроса до первого копирования или скачивания:
// это «успех поиска»; перезагрузка страницы начинает новую сессию.

import {
  batchBody,
  EVENT_ORIGIN,
  EVENT_PATH,
  type EventOf,
  type Lang,
  MAX_EVENTS,
  type OpenFrom,
  type Section,
  type SiteEvent,
} from "@iconavo-ui/analytics";
import {
  normalizeText,
  QUERY_MAX_LENGTH,
  type Style,
} from "@iconavo-ui/search";
import { API } from "./api";

export type { CopyWhat } from "@iconavo-ui/analytics";

export const TRACK_EVENT = "iconavo:track";
/** Пачка уходит раз в столько. */
export const FLUSH_MS = 10_000;
/** Выдача простояла на экране столько — запрос засчитан и без действий (решение владельца). */
export const QUERY_SETTLE_MS = 2_000;
/** Секунды в событиях — не больше суток, как в списке событий. */
const MAX_SECONDS = 86_400;
/** Адрес edge API по умолчанию: другой задаёт только проверка сайта (lib/api.ts). */
const LIVE_API = "https://api.iconavo.dev";

/** Показанная выдача поиска. */
export interface SearchView {
  q: string;
  style?: Style | undefined;
  sets: readonly string[];
  licenses: readonly string[];
  page: number;
  /** Карточек на странице выдачи. */
  results: number;
  /** Выдача полная, по смыслу. */
  semantic: boolean;
}

export interface TrackerDeps {
  now(): number;
  /** Вход на сайт — время начала загрузки вкладки. */
  entry?: number;
  /** Отправить тело пачки. */
  send(body: string): void;
  /** Можно ли отправлять: нельзя — события не копятся вовсе. */
  enabled(): boolean;
  lang(): Lang;
  /** Событие страницы для проверки сайта. */
  dispatch?(event: SiteEvent): void;
  /** Отправка раз в FLUSH_MS: таймер ставится при первом событии. */
  every?(ms: number, run: () => void): void;
}

interface Query {
  key: string;
  q: string;
  style?: Style | undefined;
  sets: string[];
  licenses: string[];
  shownAt: number;
  /** Страница, с которой запрос начался: число карточек — с неё. */
  firstPage: number;
  page: number;
  pages: Set<number>;
  results: number;
  semantic: boolean;
  position?: number;
  copied: boolean;
  downloaded: boolean;
  counted: boolean;
  first: boolean;
}

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

export function createTracker(deps: TrackerDeps) {
  const entry = deps.entry ?? deps.now();
  let iconDone = false;
  let session: { startedAt: number; queries: number } | undefined;
  let current: Query | undefined;
  const queue: SiteEvent[] = [];
  let timer = false;
  let views = 0;
  let source: OpenFrom | undefined;

  const push = (event: SiteEvent) => {
    if (!deps.enabled()) return;
    queue.push(event);
    if (!timer && deps.every) {
      timer = true;
      deps.every(FLUSH_MS, flush);
    }
  };

  /** Запрос засчитан: первый в сессии её начинает. */
  const count = (q: Query) => {
    if (q.counted) return;
    q.counted = true;
    if (session === undefined) {
      session = { startedAt: q.shownAt, queries: 1 };
      q.first = true;
    } else {
      session.queries += 1;
    }
  };

  /** Запрос закончен: засчитанный уходит событием, буквы набора — нет. */
  const finish = () => {
    const q = current;
    if (q === undefined) return;
    current = undefined;
    if (!q.counted && deps.now() - q.shownAt >= QUERY_SETTLE_MS) count(q);
    if (!q.counted) return;
    const event: EventOf<"query"> = {
      name: "query",
      q: q.q,
      results: q.results,
      semantic: q.semantic,
      pages: q.pages.size,
      first: q.first,
      copied: q.copied,
      downloaded: q.downloaded,
    };
    if (q.style !== undefined) event.style = q.style;
    if (q.sets.length > 0) event.sets = q.sets;
    if (q.licenses.length > 0) event.licenses = q.licenses;
    if (q.position !== undefined) event.position = q.position;
    push(event);
  };

  function flush() {
    if (queue.length === 0) return;
    const lang = deps.lang();
    while (queue.length > 0) {
      deps.send(batchBody(lang, queue.splice(0, MAX_EVENTS)));
    }
  }

  return {
    /** Копирование, скачивание и другие метки: первое во вкладке — со временем от входа на сайт. */
    track(event: SiteEvent) {
      deps.dispatch?.(event);
      if (event.name !== "copy" && event.name !== "download") {
        push(event);
        return;
      }
      let marked: SiteEvent = event;
      if (!iconDone) {
        iconDone = true;
        const s = seconds(deps.now() - entry);
        if (s <= MAX_SECONDS) marked = { ...event, entry: s };
      }
      if (current !== undefined) {
        if (event.name === "copy") current.copied = true;
        else current.downloaded = true;
        count(current);
      }
      if (session !== undefined) {
        push({
          name: "success",
          queries: session.queries,
          seconds: Math.min(
            MAX_SECONDS,
            seconds(deps.now() - session.startedAt),
          ),
        });
        session = undefined;
      }
      push(marked);
    },

    /** Выдача показана: новый текст или фильтры — прежний запрос закончен; другая страница — действие. */
    searchShown(view: SearchView) {
      const q = normalizeText(view.q).slice(0, QUERY_MAX_LENGTH);
      if (q === "") {
        finish();
        return;
      }
      const sets = [...view.sets];
      const licenses = [...view.licenses];
      const key = JSON.stringify([q, view.style ?? "", sets, licenses]);
      if (current !== undefined && current.key !== key) finish();
      if (current === undefined) {
        current = {
          key,
          q,
          style: view.style,
          sets,
          licenses,
          shownAt: deps.now(),
          firstPage: view.page,
          page: view.page,
          pages: new Set([view.page]),
          results: view.results,
          semantic: view.semantic,
          copied: false,
          downloaded: false,
          counted: false,
          first: false,
        };
        return;
      }
      if (view.page !== current.page) {
        current.page = view.page;
        current.pages.add(view.page);
        count(current);
      }
      if (view.page === current.firstPage) current.results = view.results;
      current.semantic = view.semantic;
    },

    /** Выдачи больше нет: ушли со страницы поиска или стёрли запрос. */
    searchLeft: finish,

    /** Открыта иконка из выдачи: место — первое у запроса. */
    resultOpened(icon: string, position: number) {
      if (current !== undefined) {
        current.position ??= position;
        count(current);
      }
      push({ name: "open", from: "search", icon });
    },

    iconOpened(icon: string, from: OpenFrom) {
      push({ name: "open", from, icon });
    },

    /** Откуда откроется следующая страница иконки — ссылка «похожие» и другие места внутри сайта. */
    markSource(from: OpenFrom) {
      source = from;
    },

    /** Страница иконки: по отмеченной ссылке, иначе первая во вкладке — прямая ссылка, другая — «other». */
    iconPageOpened(icon: string) {
      const from = source ?? (views <= 1 ? "link" : "other");
      source = undefined;
      push({ name: "open", from, icon });
    },

    styleChanged(style: Style, where: EventOf<"style">["where"]) {
      push({ name: "style", style, where });
    },

    pageViewed(section: Section) {
      views += 1;
      push({ name: "page", section });
    },

    /** Вкладка уходит в фон или закрывается: запрос закрыт, пачка — сейчас. */
    hidden() {
      finish();
      flush();
    },

    flush,
  };
}

export type Tracker = ReturnType<typeof createTracker>;

const SET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SECTION_PATHS: Readonly<Record<string, Section>> = {
  "": "home",
  search: "search",
  sets: "sets",
  docs: "docs",
  changelog: "changelog",
  licenses: "licenses",
};

/** Раздел по адресу страницы — без самого адреса и параметров (решение владельца 26 ноября 2026). */
export function sectionOf(path: string): Section {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts[0] === "ru") parts.shift();
  const [first = "", second, third] = parts;
  if (parts.length <= 1 && Object.hasOwn(SECTION_PATHS, first)) {
    return SECTION_PATHS[first] as Section;
  }
  if (first === "docs") return "docs";
  if (third === undefined && SET_ID.test(first)) {
    if (second === undefined) return "set";
    if (SET_ID.test(second)) return "icon";
  }
  return "other";
}

/** Браузер не против: нет Global Privacy Control и Do Not Track (решение владельца 26 ноября 2026). */
export function privacyAllows(nav: {
  globalPrivacyControl?: unknown;
  doNotTrack?: unknown;
}): boolean {
  return nav.globalPrivacyControl !== true && nav.doNotTrack !== "1";
}

function browserEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  if (typeof navigator.sendBeacon !== "function") return false;
  if (
    !privacyAllows(navigator as Navigator & { globalPrivacyControl?: unknown })
  ) {
    return false;
  }
  return API !== LIVE_API || window.location.origin === EVENT_ORIGIN;
}

function sendBody(body: string) {
  const url = `${API}${EVENT_PATH}`;
  try {
    if (navigator.sendBeacon(url, body)) return;
  } catch {
    // ниже — запасной путь
  }
  fetch(url, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(
    () => {},
  );
}

const tracker = createTracker({
  now: () => Date.now(),
  ...(typeof performance === "undefined"
    ? {}
    : { entry: performance.timeOrigin }),
  send: sendBody,
  enabled: browserEnabled,
  lang: () => (document.documentElement.lang === "ru" ? "ru" : "en"),
  dispatch: (event) => {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent(TRACK_EVENT, { detail: event }));
  },
  every: (ms, run) => {
    setInterval(run, ms);
  },
});

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") tracker.hidden();
  });
  window.addEventListener("pagehide", () => tracker.hidden());
}

export const track = (event: SiteEvent): void => tracker.track(event);
export const searchShown = (view: SearchView): void =>
  tracker.searchShown(view);
export const searchLeft = (): void => tracker.searchLeft();
export const resultOpened = (icon: string, position: number): void =>
  tracker.resultOpened(icon, position);
export const iconOpened = (icon: string, from: OpenFrom): void =>
  tracker.iconOpened(icon, from);
export const markOpenSource = (from: OpenFrom): void =>
  tracker.markSource(from);
export const iconPageOpened = (icon: string): void =>
  tracker.iconPageOpened(icon);
export const styleChanged = (
  style: Style,
  where: EventOf<"style">["where"],
): void => tracker.styleChanged(style, where);
export const pageViewed = (section: Section): void =>
  tracker.pageViewed(section);
