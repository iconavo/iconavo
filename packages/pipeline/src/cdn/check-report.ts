// Отчёт проверки раздачи (ADR-0023) для терминала: таблица «адрес × проверки», список «не так» с
// подсказкой, где поправить, и итог. Страницы нет: смотреть глазами нечего.

import { formatMs } from "../embed/report.js";
import { textTable } from "../report/table.js";
import {
  CHECK_GROUPS,
  type CheckGroup,
  type CheckReport,
  checkFailed,
  type TargetReport,
} from "./check.js";
import { CF_CACHE_RULE, CF_HEADERS_RULE, CF_SVG_RULE } from "./config.js";

/** Заголовки колонок таблицы. */
export const CHECK_GROUP_TITLES: Record<CheckGroup, string> = {
  status: "Ответ",
  type: "Тип",
  cache: "Кэш",
  edge: "CDN",
  cors: "CORS",
  security: "Защита",
  encoding: "Сжатие",
  body: "Файл",
};

/** Где поправить проблему группы. */
export const CHECK_HINTS: Record<CheckGroup, string> = {
  status:
    "файлы раздачи выкладывает «Выкладка» (pnpm cdn upload, ADR-0022); «нет ответа» — сбой сети или хоста",
  type: "Content-Type хранится у объекта R2 и задаётся выгрузкой (ADR-0022)",
  cache: `Cache-Control хранится у объекта R2 и задаётся выгрузкой (ADR-0022); если у объекта он верный, его переписал Cloudflare — в правиле кэша «${CF_CACHE_RULE}» Browser TTL должен быть «Respect origin»`,
  edge: `правило кэша Cloudflare «${CF_CACHE_RULE}»: всё на хосте, кроме /manifest.json (ADR-0023)`,
  cors: `правило заголовков Cloudflare «${CF_HEADERS_RULE}» (ADR-0023)`,
  security: `правила заголовков Cloudflare «${CF_HEADERS_RULE}» и, для SVG, «${CF_SVG_RULE}» (ADR-0023)`,
  encoding:
    "сжатие br и gzip Cloudflare включает сам — проверьте Compression Rules зоны iconavo.dev",
  body: "файл на CDN не тот, что описан: пересоберите и выложите раздачу (pnpm cdn build, «Выкладка»)",
};

const LEGEND =
  "Тип — Content-Type, Кэш — Cache-Control, CDN — кэш на серверах Cloudflare (cf-cache-status), Защита — nosniff, CORP и у SVG CSP, Файл — схема или контрольная сумма.";

/** Ячейка группы: код ответа или «ок», «не так»; не проверялась — «—». */
function cell(t: TargetReport, group: CheckGroup): string {
  if (!t.checked.includes(group)) return "—";
  if (t.issues.some((i) => i.group === group)) {
    return group === "status" && t.status === undefined ? "нет" : "не так";
  }
  return group === "status" ? String(t.status) : "ок";
}

/** Таблица «адрес × проверки». */
export function formatCheckTable(r: CheckReport): string {
  const head = [
    "Адрес",
    ...CHECK_GROUPS.map((g) => CHECK_GROUP_TITLES[g]),
    "Итог",
  ];
  const rows = r.targets.map((t) => [
    t.path,
    ...CHECK_GROUPS.map((g) => cell(t, g)),
    t.issues.length === 0 ? "ок" : "не так",
  ]);
  return textTable(head, rows, head.length);
}

/** Строки после таблицы: расшифровка колонок, что не так и где поправить, итог. */
export function formatCheckSummary(r: CheckReport): string[] {
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
      lines.push(`  ${CHECK_GROUP_TITLES[g]} — ${CHECK_HINTS[g]}`);
    }
  }
  if (r.stop.length > 0) lines.push("");
  for (const s of r.stop) lines.push(`СТОП — ${s}`);
  const version = r.version === undefined ? "" : `, версия ${r.version}`;
  lines.push(
    "",
    `Хост https://${r.host}, образец ${r.set}:${r.icon}${version}; запросов ${r.requests} за ${formatMs(r.ms)}.`,
    checkFailed(r)
      ? `Итог: не так — проблем ${issues.length + r.stop.length}.`
      : "Итог: ок — заголовки раздачи как в ADR-0023.",
  );
  return lines;
}
