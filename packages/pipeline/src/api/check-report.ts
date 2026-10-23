// Отчёт проверки edge API (ADR-0024) для терминала: та же таблица «адрес × проверки», что у
// статики, список «не так» с подсказкой, где поправить, время первого ответа каждого адреса и итог.

import { CHECK_GROUPS, type CheckGroup } from "../cdn/check.js";
import { CHECK_GROUP_TITLES, targetsTable } from "../cdn/check-report.js";
import { formatMs } from "../embed/report.js";
import { type ApiCheckReport, apiCheckFailed } from "./check.js";
import { WORKER_NAME } from "./config.js";

/** Где поправить проблему группы: почти всё ставит сама функция. */
export const API_HINTS: Record<CheckGroup, string> = {
  status: `функцию выкладывает workflow «Edge API» (pnpm api build, ADR-0024); «нет ответа» — сбой сети, функция не выложена или к ней не привязан домен: Workers & Pages → ${WORKER_NAME} → Settings → Domains & Routes`,
  https:
    "переход на https — Always Use HTTPS зоны iconavo.dev в Cloudflare (ADR-0023)",
  type: "Content-Type ставит сама функция (apps/api/src/config.ts)",
  cache: "Cache-Control ставит сама функция (apps/api/src/config.ts, ADR-0023)",
  edge: "версию набора функция берёт из manifest.json в R2 раз в минуту; не та сборка — «Edge API» ещё не выложил её; повтор не из кэша — Cache API дата-центра (ADR-0023); Server не cloudflare — запрос прошёл мимо Cloudflare",
  cors: "CORS ставит сама функция (apps/api/src/config.ts)",
  security:
    "nosniff, CORP и у SVG CSP ставит сама функция (apps/api/src/config.ts)",
  encoding:
    "сжатие br и gzip ответов функции делает Cloudflare — проверьте Compression Rules зоны iconavo.dev",
  body: "ответ функции не сходится со статикой той же версии — ошибка в apps/api или в файлах раздачи (pnpm cdn build)",
};

const LEGEND =
  "HTTPS — переход с http:// на https://, Тип — Content-Type, Кэш — Cache-Control, CDN — версия набора и сборка функции (X-Iconavo-Version, X-Iconavo-Build), повтор из кэша (X-Cache) и Server, Защита — nosniff, CORP и у SVG CSP, Файл — сверка со статикой той же версии.";

export function formatApiCheckTable(r: ApiCheckReport): string {
  return targetsTable(r.targets);
}

/** Строки после таблицы: расшифровка, что не так и где поправить, время ответов, итог. */
export function formatApiCheckSummary(r: ApiCheckReport): string[] {
  const lines = [LEGEND];
  const issues = r.targets.flatMap((t) =>
    t.issues.map((i) => ({ path: t.path, ...i })),
  );
  if (issues.length > 0) {
    lines.push("", "Не так:");
    for (const i of issues) {
      lines.push(`  ${i.path} — ${CHECK_GROUP_TITLES[i.group]}: ${i.message}`);
    }
    lines.push("", "Где поправить:");
    for (const g of CHECK_GROUPS.filter((g) =>
      issues.some((i) => i.group === g),
    )) {
      lines.push(`  ${CHECK_GROUP_TITLES[g]} — ${API_HINTS[g]}`);
    }
  }
  if (r.stop.length > 0) lines.push("");
  for (const s of r.stop) lines.push(`СТОП — ${s}`);
  const timed = r.targets.filter((t) => t.ms !== undefined);
  if (timed.length > 0) {
    lines.push(
      "",
      `Время первого ответа: ${timed.map((t) => `${t.path} — ${formatMs(t.ms as number)}`).join("; ")}.`,
    );
  }
  const version = r.version === undefined ? "" : `, версия ${r.version}`;
  const build = r.build === undefined ? "" : `, сборка ${r.build}`;
  lines.push(
    "",
    `Хост https://${r.host}, образец ${r.set}${version}${build}; ожидание версии ${formatMs(r.waitedMs)}; запросов ${r.requests} за ${formatMs(r.ms)}.`,
    apiCheckFailed(r)
      ? `Итог: не так — проблем ${issues.length + r.stop.length}.`
      : "Итог: ок — edge API отвечает как в ADR-0024 и сходится со статикой.",
  );
  return lines;
}
