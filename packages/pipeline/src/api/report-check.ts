// Чтение базы для отчёта /analytics/query на живом адресе (шаг 3 фазы 5, ADR-0055) — часть pnpm api check.
// Ключа у проверки нет, поэтому она видит только отказ: 401 с кодом unauthorized значит, что функция
// выложена с ключом ANALYTICS_REPORT_KEY; 404 — ключа у функции нет и pnpm analytics работать не будет.
// У ответа — no-store, CORS и защита, как у любого ответа функции.

import { REPORT_PATH } from "@iconavo-ui/analytics";
import {
  addIssue,
  type LiveGetOptions,
  mismatch,
  shown,
} from "../cdn/check.js";
import { CORS_ALLOW_ORIGIN, SECURITY_HEADERS } from "../cdn/config.js";
import type { ApiTarget } from "./check.js";
import { API_HOST, API_TYPES } from "./config.js";
import { livePost } from "./event-check.js";

const errorCode = (body: Uint8Array): unknown => {
  try {
    return (
      JSON.parse(Buffer.from(body).toString("utf8")) as { error?: unknown }
    ).error;
  } catch {
    return undefined;
  }
};

export async function checkReport(o: LiveGetOptions): Promise<ApiTarget> {
  const target: ApiTarget = {
    kind: "report",
    path: "analytics/query — без ключа",
    checked: ["status"],
    issues: [],
  };
  const res = await livePost(
    `https://${API_HOST}${REPORT_PATH}`,
    JSON.stringify({ sql: "SELECT 1", params: [] }),
    { "content-type": "application/json" },
    o,
  );
  if ("error" in res) {
    addIssue(target, "status", res.error);
    return target;
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
  if (res.status !== 401) {
    addIssue(
      target,
      "status",
      res.status === 404
        ? "ответ 404: у функции нет ключа ANALYTICS_REPORT_KEY — секрет окружения GitHub api и «Edge API» с «выложить заново» (ADR-0055)"
        : `ответ ${res.status} вместо 401`,
    );
    return target;
  }
  target.checked.push("cache", "type", "body");
  addIssue(target, "cache", mismatch(res.headers, "cache-control", "no-store"));
  addIssue(
    target,
    "type",
    mismatch(res.headers, "content-type", API_TYPES.json),
  );
  const code = errorCode(res.body);
  if (code !== "unauthorized") {
    addIssue(
      target,
      "body",
      `ошибка ${shown(String(code))} вместо «unauthorized»`,
    );
  }
  return target;
}
