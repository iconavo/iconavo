// Проверка поиска на живом api.iconavo.dev (ADR-0049). Отдельно от проверки раздачи: pnpm cdn check
// («Выкладка», «Сверка хостов») её не запускает, и сбой поиска не красит раздачу иконок. Её запускает
// pnpm api check — в «Edge API» после выкладки. Что проверяется:
// - точное имя: 200, JSON, CORS и защита, версия индекса, точное совпадение первым; неполная выдача
//   (pending) должна стать полной, а повтор — прийти из кэша с кэшем браузеру 5 минут;
// - русский запрос находит иконки;
// - ответы 400: без query и с неизвестным набором.
// Ключи не нужны.

import {
  type Fetched,
  type LiveGetOptions,
  liveGet,
  mismatch,
} from "../cdn/check.js";
import {
  CHECK_MAX_ATTEMPTS,
  CHECK_ORIGIN,
  CHECK_TIMEOUT_MS,
  CORS_ALLOW_ORIGIN,
  SECURITY_HEADERS,
} from "../cdn/config.js";
import type { FetchFn } from "../sources/npm.js";
import { API_HOST, API_TYPES } from "./config.js";

/** Ожидание полной выдачи после pending: Polza с сервера отвечает за 1–2 с. */
export const FULL_WAIT_ATTEMPTS = 10;
export const FULL_WAIT_STEP_MS = 1000;
export const SEARCH_CACHE_BROWSER = "public, max-age=300";
export const SEARCH_CACHE_CLIENT_ERROR = "public, max-age=300";

export interface SearchCheckTarget {
  name: string;
  path: string;
  status?: number;
  /** Время первого ответа. */
  ms?: number;
  issues: { message: string }[];
  notes: string[];
}

export interface SearchCheckReport {
  host: string;
  /** Версия индекса из ответа (X-Iconavo-Index). */
  index?: string;
  targets: SearchCheckTarget[];
  requests: number;
  ms: number;
}

export interface SearchCheckOptions {
  /** Корень API; по умолчанию живой https://api.iconavo.dev. */
  base?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  log?: (line: string) => void;
}

export const searchCheckFailed = (r: SearchCheckReport) =>
  r.targets.some((t) => t.issues.length > 0);

interface SearchBody {
  icons?: unknown;
  results?: { icon?: unknown; exact?: unknown }[];
  semantic?: unknown;
  error?: unknown;
}

function parse(res: Fetched): SearchBody | undefined {
  try {
    return JSON.parse(Buffer.from(res.body).toString("utf8")) as SearchBody;
  } catch {
    return undefined;
  }
}

const timing = (res: Fetched, name: string) =>
  new RegExp(`${name};(?:desc="([^"]*)";)?dur=(\\d+)`).exec(
    res.headers.get("server-timing") ?? "",
  );

export async function checkSearch(
  options: SearchCheckOptions = {},
): Promise<SearchCheckReport> {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const base = options.base ?? `https://${API_HOST}`;
  const started = now();
  let requests = 0;
  const live: LiveGetOptions = {
    fetch: fetchFn,
    sleep,
    timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? CHECK_MAX_ATTEMPTS,
    onRequest: () => {
      requests++;
    },
  };
  const get = (path: string) =>
    liveGet(`${base}/${path}`, { origin: CHECK_ORIGIN }, live);
  const report: SearchCheckReport = {
    host: base.replace(/^https?:\/\//, ""),
    targets: [],
    requests: 0,
    ms: 0,
  };
  const done = (target: SearchCheckTarget) => {
    report.targets.push(target);
    options.log?.(
      `${target.path} — ${target.issues.length === 0 ? "ок" : "не так"}`,
    );
  };
  const issue = (target: SearchCheckTarget, message: string | undefined) => {
    if (message !== undefined) target.issues.push({ message });
  };
  /** CORS и защита — у любого ответа функции, включая ошибки. */
  const corsAndSecurity = (target: SearchCheckTarget, res: Fetched) => {
    issue(
      target,
      mismatch(res.headers, "access-control-allow-origin", CORS_ALLOW_ORIGIN),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      issue(target, mismatch(res.headers, name, value));
    }
  };

  /** Ответ 200 поиска: заголовки, тело, версия индекса. */
  async function check200(
    name: string,
    path: string,
    expect: (body: SearchBody, target: SearchCheckTarget) => void,
  ) {
    const target: SearchCheckTarget = { name, path, issues: [], notes: [] };
    const t0 = now();
    let res = await get(path);
    target.ms = now() - t0;
    if ("error" in res) {
      issue(target, res.error);
      return done(target);
    }
    target.status = res.status;
    if (res.status !== 200) {
      issue(target, `ответ ${res.status} вместо 200`);
      return done(target);
    }
    issue(target, mismatch(res.headers, "content-type", API_TYPES.json));
    corsAndSecurity(target, res);
    const index = res.headers.get("x-iconavo-index");
    if (index === null || !/^[0-9a-f]{8}$/.test(index)) {
      issue(
        target,
        `X-Iconavo-Index: ${index === null ? "нет" : `«${index}»`} — версии индекса нет: робот «Поисковый индекс» ещё не загрузил индекс`,
      );
    } else {
      report.index = index;
    }
    let body = parse(res);
    if (!body) {
      issue(target, "ответ не JSON");
      return done(target);
    }
    const vector = timing(res, "vector");
    if (vector) target.notes.push(`вектор: ${vector[1] ?? "?"}`);
    // Неполная выдача должна стать полной: вектор и полный ответ досчитываются в фоне.
    for (
      let attempt = 1;
      body?.semantic === "pending" && attempt <= FULL_WAIT_ATTEMPTS;
      attempt++
    ) {
      await sleep(FULL_WAIT_STEP_MS);
      const next = await get(path);
      if ("error" in next || next.status !== 200) break;
      res = next;
      body = parse(next);
      if (body?.semantic === "full") {
        target.notes.push(`полная выдача через ${attempt} с`);
      }
    }
    if (!body) {
      issue(target, "ответ не JSON");
      return done(target);
    }
    if (body.semantic === "text") {
      issue(
        target,
        "semantic: text — модель векторов недоступна, выдача только по словам",
      );
    } else if (body.semantic !== "full") {
      issue(
        target,
        `semantic: ${String(body.semantic)} — полной выдачи нет и через ${FULL_WAIT_ATTEMPTS} с`,
      );
    }
    expect(body, target);
    if (body.semantic === "full") {
      // Полная выдача — в кэше дата-центра; браузеру — 5 минут.
      const again = await get(path);
      if (!("error" in again)) {
        issue(target, mismatch(again.headers, "x-cache", "HIT"));
        issue(
          target,
          mismatch(again.headers, "cache-control", SEARCH_CACHE_BROWSER),
        );
      }
    }
    done(target);
  }

  /** Ответ 400 с кодом ошибки. */
  async function check400(name: string, path: string, code: string) {
    const target: SearchCheckTarget = { name, path, issues: [], notes: [] };
    const t0 = now();
    const res = await get(path);
    target.ms = now() - t0;
    if ("error" in res) {
      issue(target, res.error);
      return done(target);
    }
    target.status = res.status;
    if (res.status !== 400) issue(target, `ответ ${res.status} вместо 400`);
    issue(
      target,
      mismatch(res.headers, "cache-control", SEARCH_CACHE_CLIENT_ERROR),
    );
    corsAndSecurity(target, res);
    const body = parse(res);
    if (body?.error !== code) {
      issue(target, `код ошибки ${String(body?.error)} вместо ${code}`);
    }
    done(target);
  }

  await check200("Точное имя", "search?query=house&limit=8", (body, t) => {
    const first = body.results?.[0];
    if (first?.exact !== true) {
      issue(t, "первая карточка — не точное совпадение имени");
    }
    if (!Array.isArray(body.icons) || !body.icons.includes("lucide:house")) {
      issue(t, "в выдаче нет lucide:house");
    }
  });
  await check200(
    "По-русски",
    `search?query=${encodeURIComponent("мусорное ведро")}&limit=8`,
    (body, t) => {
      if (!Array.isArray(body.icons) || body.icons.length === 0) {
        issue(t, "пустая выдача");
      }
    },
  );
  await check400("Без query", "search", "query_required");
  await check400(
    "Неизвестный набор",
    "search?query=house&prefix=iconavo-missing",
    "invalid_prefix",
  );
  report.requests = requests;
  report.ms = now() - started;
  return report;
}

/** Строки проверки для терминала. */
export function formatSearchCheck(r: SearchCheckReport): string[] {
  const lines = [
    `Поиск https://${r.host}/search — версия индекса ${r.index ?? "—"}, запросов ${r.requests}`,
  ];
  for (const t of r.targets) {
    const head = `  ${t.issues.length === 0 ? "ок" : "не так"}  ${t.name}: ${t.status ?? "—"}${t.ms === undefined ? "" : `, ${Math.round(t.ms)} мс`}${t.notes.length > 0 ? ` (${t.notes.join("; ")})` : ""}`;
    lines.push(head);
    for (const i of t.issues) lines.push(`        — ${i.message}`);
  }
  lines.push(
    searchCheckFailed(r)
      ? "Итог поиска: есть проблемы."
      : "Итог поиска: всё в порядке.",
  );
  return lines;
}
