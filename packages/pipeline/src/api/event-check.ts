// Приём событий /event на живом адресе (шаг 2 фазы 5, ADR-0043) — часть pnpm api check: проверочная
// пачка — 204 без тела, пачка не по списку — 400 с кодом invalid_events, чужая страница — 403 с кодом
// forbidden_origin; у всех — no-store, CORS и защита, как у любого ответа функции. Пачки помечены
// заголовком x-iconavo-test: в итоги и отчёт они не входят, а их число в отчёте pnpm analytics
// подтверждает, что запись в базу работает. «Принято» функция отвечает только после записи — 204
// проверяет всю дорогу до базы D1.

import {
  batchBody,
  EVENT_ORIGIN,
  EVENT_PATH,
  TEST_HEADER,
} from "@iconavo-ui/analytics";
import {
  addIssue,
  type Fetched,
  type LiveGetOptions,
  mismatch,
  shown,
} from "../cdn/check.js";
import { CORS_ALLOW_ORIGIN, SECURITY_HEADERS } from "../cdn/config.js";
import { retryable, retryDelay } from "../embed/client.js";
import type { ApiCheckKind, ApiTarget } from "./check.js";
import { API_HOST, API_TYPES } from "./config.js";

/** Чужая страница — для проверки отказа по Origin. */
export const FOREIGN_ORIGIN = "https://example.com";

interface EventProbe {
  kind: ApiCheckKind;
  /** Строка таблицы. */
  path: string;
  body: string;
  origin: string;
  status: number;
  /** Код ошибки в теле; нет — ответ 204 без тела. */
  code?: string;
}

const PROBE_EVENT = { name: "page", section: "other" } as const;

export const EVENT_PROBES: readonly EventProbe[] = [
  {
    kind: "event",
    path: "event — проверочная пачка",
    body: batchBody("en", [PROBE_EVENT]),
    origin: EVENT_ORIGIN,
    status: 204,
  },
  {
    kind: "event-invalid",
    path: "event — пачка не по списку",
    body: batchBody("en", [
      { name: "page", section: "nowhere" } as unknown as typeof PROBE_EVENT,
    ]),
    origin: EVENT_ORIGIN,
    status: 400,
    code: "invalid_events",
  },
  {
    kind: "event-origin",
    path: "event — чужая страница",
    body: batchBody("en", [PROBE_EVENT]),
    origin: FOREIGN_ORIGIN,
    status: 403,
    code: "forbidden_origin",
  },
];

/** POST с повторами, как GET проверки: временный отказ после последней попытки — обычный ответ. */
export async function livePost(
  url: string,
  body: string,
  headers: Record<string, string>,
  o: LiveGetOptions,
): Promise<Fetched | { error: string }> {
  for (let attempt = 1; ; attempt++) {
    let wait: number | undefined;
    try {
      o.onRequest();
      const res = await o.fetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!retryable(res.status) || attempt >= o.maxAttempts) {
        return { status: res.status, headers: res.headers, body: bytes };
      }
      wait = retryDelay(res.headers.get("retry-after"), attempt);
    } catch (e) {
      const name = (e as Error).name;
      const reason =
        name === "TimeoutError" || name === "AbortError"
          ? `нет ответа за ${Math.round(o.timeoutMs / 1000)} с`
          : `сбой сети: ${(e as Error).message}`;
      if (attempt >= o.maxAttempts) {
        return {
          error: `${reason} — не получилось за ${o.maxAttempts} попыток`,
        };
      }
    }
    await o.sleep(wait ?? retryDelay(null, attempt));
  }
}

const errorCode = (body: Uint8Array): unknown => {
  try {
    return (
      JSON.parse(Buffer.from(body).toString("utf8")) as { error?: unknown }
    ).error;
  } catch {
    return undefined;
  }
};

/** Три пачки по очереди — строка таблицы на каждую. */
export async function checkEvents(o: LiveGetOptions): Promise<ApiTarget[]> {
  const targets: ApiTarget[] = [];
  for (const probe of EVENT_PROBES) {
    const target: ApiTarget = {
      kind: probe.kind,
      path: probe.path,
      checked: ["status"],
      issues: [],
    };
    targets.push(target);
    const res = await livePost(
      `https://${API_HOST}${EVENT_PATH}`,
      probe.body,
      {
        origin: probe.origin,
        "content-type": "text/plain;charset=UTF-8",
        [TEST_HEADER]: "1",
      },
      o,
    );
    if ("error" in res) {
      addIssue(target, "status", res.error);
      continue;
    }
    target.status = res.status;
    target.checked.push("cors", "security");
    addIssue(
      target,
      "cors",
      mismatch(res.headers, "access-control-allow-origin", CORS_ALLOW_ORIGIN),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      addIssue(target, "security", mismatch(res.headers, name, value));
    }
    if (res.status !== probe.status) {
      const code = errorCode(res.body);
      addIssue(
        target,
        "status",
        `ответ ${res.status} вместо ${probe.status}${typeof code === "string" ? ` (${code})` : ""}${
          code === "analytics_unavailable"
            ? " — база D1 не привязана к функции или не ответила (ADR-0043)"
            : ""
        }`,
      );
      continue;
    }
    target.checked.push("cache", "body");
    addIssue(
      target,
      "cache",
      mismatch(res.headers, "cache-control", "no-store"),
    );
    if (probe.code === undefined) {
      if (res.body.length > 0)
        addIssue(target, "body", "у ответа 204 есть тело");
      continue;
    }
    target.checked.push("type");
    addIssue(
      target,
      "type",
      mismatch(res.headers, "content-type", API_TYPES.json),
    );
    const code = errorCode(res.body);
    if (code !== probe.code) {
      addIssue(
        target,
        "body",
        `ошибка ${shown(String(code))} вместо «${probe.code}»`,
      );
    }
  }
  return targets;
}
