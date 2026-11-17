// Проверка сведений об иконке /icon на живом api.iconavo.dev (шаг 4 фазы 4, ADR-0041). Как и поиск —
// отдельно от раздачи: pnpm cdn check её не запускает. Запускает pnpm api check — в «Edge API» после
// выкладки. Что проверяется:
// - lucide:house: 200, JSON, CORS и защита, версия набора, индекса и отпечаток содержимого, карточка
//   и стиль, толщина линии, описания ru/en, теги, похожие; повтор — из кэша, браузеру 5 минут;
// - старое имя lucide:alert-circle → основное имя Lucide, у него — авторство Feather (ADR-0017), у набора —
//   тоже (указание авторства на весь набор). Какое имя основное, не закреплено: Lucide переименовывает
//   иконки, а старое имя остаётся алиасом (ADR-0018) — в 1.69.0 circle-alert стала
//   circle-exclamation-point;
// - варианты ph:house-bold — по стилям шкалы в порядке таблицы набора, без толщины линии;
// - оттенки кожи Fluent и цветной набор; скрытая иконка — пометка hidden;
// - ответы 400 и 404 с кодами.
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

export const ICON_CACHE_BROWSER = "public, max-age=300";
export const ICON_CACHE_CLIENT_ERROR = "public, max-age=300";

/** Заголовки, которые браузер сайта должен видеть у ответа /icon. */
export const ICON_EXPOSED = [
  "X-Iconavo-Content",
  "X-Iconavo-Index",
  "X-Iconavo-Version",
];

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;

export interface IconCheckTarget {
  name: string;
  path: string;
  status?: number;
  ms?: number;
  issues: { message: string }[];
  notes: string[];
}

export interface IconCheckReport {
  host: string;
  targets: IconCheckTarget[];
  requests: number;
  ms: number;
}

export interface IconCheckOptions {
  /** Корень API; по умолчанию живой https://api.iconavo.dev. */
  base?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  log?: (line: string) => void;
}

export const iconCheckFailed = (r: IconCheckReport) =>
  r.targets.some((t) => t.issues.length > 0);

/** Тело ответа /icon — только то, что смотрит проверка. */
interface IconBody {
  icon?: unknown;
  alias?: unknown;
  hidden?: unknown;
  set?: { prefix?: unknown; palette?: unknown; credits?: { name?: unknown }[] };
  card?: unknown;
  style?: unknown;
  variants?: { style?: unknown; icons?: unknown }[];
  tones?: unknown;
  strokes?: unknown;
  description?: { en?: unknown; ru?: unknown } | null;
  tags?: unknown;
  credits?: { name?: unknown }[];
  similar?: unknown;
  error?: unknown;
}

function parse(res: Fetched): IconBody | undefined {
  try {
    return JSON.parse(Buffer.from(res.body).toString("utf8")) as IconBody;
  } catch {
    return undefined;
  }
}

const isNames = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((n) => typeof n === "string" && NAME.test(n));

export async function checkIcon(
  options: IconCheckOptions = {},
): Promise<IconCheckReport> {
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
  const report: IconCheckReport = {
    host: base.replace(/^https?:\/\//, ""),
    targets: [],
    requests: 0,
    ms: 0,
  };
  const done = (target: IconCheckTarget) => {
    report.targets.push(target);
    options.log?.(
      `${target.path} — ${target.issues.length === 0 ? "ок" : "не так"}`,
    );
  };
  const issue = (target: IconCheckTarget, message: string | undefined) => {
    if (message !== undefined) target.issues.push({ message });
  };
  const corsAndSecurity = (target: IconCheckTarget, res: Fetched) => {
    issue(
      target,
      mismatch(res.headers, "access-control-allow-origin", CORS_ALLOW_ORIGIN),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      issue(target, mismatch(res.headers, name, value));
    }
  };

  /** Ответ 200: заголовки, тело; expect — что должно быть в теле. */
  async function check200(
    name: string,
    path: string,
    expect: (body: IconBody, target: IconCheckTarget) => void,
    cached = false,
  ) {
    const target: IconCheckTarget = { name, path, issues: [], notes: [] };
    const t0 = now();
    const res = await get(path);
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
    issue(target, mismatch(res.headers, "cache-control", ICON_CACHE_BROWSER));
    corsAndSecurity(target, res);
    const exposed = (res.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    for (const header of ICON_EXPOSED) {
      if (!exposed.includes(header.toLowerCase())) {
        issue(
          target,
          `${header} не открыт браузеру: нет в Access-Control-Expose-Headers`,
        );
      }
    }
    const version = res.headers.get("x-iconavo-version");
    if (version === null || !/^[0-9a-f]{8}$/.test(version)) {
      issue(target, `X-Iconavo-Version: ${version ?? "нет"}`);
    }
    const index = res.headers.get("x-iconavo-index");
    if (index === null || !/^[0-9a-f]{8}$/.test(index)) {
      issue(
        target,
        `X-Iconavo-Index: ${index ?? "нет"} — версии индекса нет: робот «Поисковый индекс» ещё не загрузил индекс`,
      );
    }
    const content = res.headers.get("x-iconavo-content");
    if (content === null || !/^[0-9a-f]{12}$/.test(content)) {
      issue(
        target,
        `X-Iconavo-Content: ${content ?? "нет"} — в оглавлении каталога нет отпечатка содержимого: «Выкладка» после шага 4 фазы 4 ещё не прошла`,
      );
    }
    const body = parse(res);
    if (!body) {
      issue(target, "ответ не JSON");
      return done(target);
    }
    expect(body, target);
    if (cached) {
      // Готовый ответ — в кэше дата-центра; браузеру — 5 минут.
      const again = await get(path);
      if (!("error" in again)) {
        issue(target, mismatch(again.headers, "x-cache", "HIT"));
        issue(
          target,
          mismatch(again.headers, "cache-control", ICON_CACHE_BROWSER),
        );
      }
    }
    done(target);
  }

  /** Ответ с ошибкой: код, кэш и код ошибки в теле. */
  async function checkError(
    name: string,
    path: string,
    status: number,
    code: string,
  ) {
    const target: IconCheckTarget = { name, path, issues: [], notes: [] };
    const t0 = now();
    const res = await get(path);
    target.ms = now() - t0;
    if ("error" in res) {
      issue(target, res.error);
      return done(target);
    }
    target.status = res.status;
    if (res.status !== status) {
      issue(target, `ответ ${res.status} вместо ${status}`);
    }
    issue(
      target,
      mismatch(res.headers, "cache-control", ICON_CACHE_CLIENT_ERROR),
    );
    corsAndSecurity(target, res);
    const body = parse(res);
    if (body?.error !== code) {
      issue(target, `код ошибки ${String(body?.error)} вместо ${code}`);
    }
    done(target);
  }

  await check200(
    "Иконка",
    "icon?icon=lucide:house",
    (body, t) => {
      if (body.icon !== "lucide:house") issue(t, `icon: ${String(body.icon)}`);
      if (body.set?.prefix !== "lucide") issue(t, "набор — не lucide");
      if (body.card !== "lucide:house") issue(t, `card: ${String(body.card)}`);
      if (body.style !== "outline") issue(t, `style: ${String(body.style)}`);
      if (body.strokes !== true) issue(t, "strokes — не true: у Lucide линии");
      const description = body.description;
      if (
        typeof description?.en !== "string" ||
        typeof description?.ru !== "string"
      ) {
        issue(
          t,
          "нет описаний ru/en — робот «Поисковый индекс» ещё не отправил документы с about",
        );
      }
      if (!Array.isArray(body.tags) || body.tags.length === 0) {
        issue(t, "нет тегов");
      }
      if (!isNames(body.similar) || body.similar.length === 0) {
        issue(t, "нет похожих иконок");
      } else {
        t.notes.push(`похожие: ${body.similar.slice(0, 3).join(", ")}…`);
      }
    },
    true,
  );
  await check200(
    "Старое имя и Feather",
    "icon?icon=lucide:alert-circle",
    (body, t) => {
      if (
        typeof body.icon !== "string" ||
        !NAME.test(body.icon) ||
        !body.icon.startsWith("lucide:") ||
        body.icon === "lucide:alert-circle"
      ) {
        issue(
          t,
          `icon: ${String(body.icon)} — алиас не привёл к основному имени Lucide`,
        );
      } else {
        t.notes.push(`основное имя: ${body.icon}`);
      }
      if (body.alias !== "lucide:alert-circle") {
        issue(t, `alias: ${String(body.alias)}`);
      }
      if (!(body.credits ?? []).some((c) => c.name === "Feather")) {
        issue(t, "нет авторства Feather (credits)");
      }
      if (!(body.set?.credits ?? []).some((c) => c.name === "Feather")) {
        issue(
          t,
          "у набора нет Feather (set.credits) — указание авторства на весь набор",
        );
      }
    },
  );
  await check200(
    "Варианты по таблице",
    "icon?icon=ph:house-bold",
    (body, t) => {
      const groups = (body.variants ?? []).map(
        (v) =>
          `${String(v.style)}: ${isNames(v.icons) ? v.icons.join(" ") : "?"}`,
      );
      const expected = [
        "outline: ph:house-thin ph:house-light ph:house ph:house-bold",
        "filled: ph:house-fill",
        "duotone: ph:house-duotone",
      ];
      if (groups.join(" | ") !== expected.join(" | ")) {
        issue(t, `варианты: ${groups.join(" | ")}`);
      }
      if (body.style !== "outline") issue(t, `style: ${String(body.style)}`);
      if (body.strokes !== false) {
        issue(t, "strokes — не false: у Phosphor линий нет");
      }
    },
  );
  await check200(
    "Оттенки кожи",
    "icon?icon=fluent-emoji-flat:waving-hand",
    (body, t) => {
      if (!isNames(body.tones) || body.tones.length !== 5) {
        issue(t, "оттенков кожи не пять");
      }
      if (body.set?.palette !== true) issue(t, "набор не отмечен цветным");
      if (body.style !== "color") issue(t, `style: ${String(body.style)}`);
    },
  );
  await check200("Скрытая", "icon?icon=lucide:circle-parking", (body, t) => {
    if (body.hidden !== true) issue(t, "нет пометки hidden");
    if (body.card !== null) issue(t, `card: ${String(body.card)}`);
  });
  await checkError("Без icon", "icon", 400, "icon_required");
  await checkError("Имя без набора", "icon?icon=house", 400, "invalid_icon");
  await checkError(
    "Нет такой иконки",
    "icon?icon=lucide:iconavo-missing",
    404,
    "icon_not_found",
  );
  report.requests = requests;
  report.ms = now() - started;
  return report;
}

/** Строки проверки для терминала. */
export function formatIconCheck(r: IconCheckReport): string[] {
  const lines = [
    `Сведения об иконке https://${r.host}/icon — запросов ${r.requests}`,
  ];
  for (const t of r.targets) {
    lines.push(
      `  ${t.issues.length === 0 ? "ок" : "не так"}  ${t.name}: ${t.status ?? "—"}${t.ms === undefined ? "" : `, ${Math.round(t.ms)} мс`}${t.notes.length > 0 ? ` (${t.notes.join("; ")})` : ""}`,
    );
    for (const i of t.issues) lines.push(`        — ${i.message}`);
  }
  lines.push(
    iconCheckFailed(r)
      ? "Итог сведений об иконке: есть проблемы."
      : "Итог сведений об иконке: всё в порядке.",
  );
  return lines;
}
