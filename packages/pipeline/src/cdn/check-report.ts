// Отчёт проверки раздачи (ADR-0023, ADR-0025) для терминала: на каждый хост таблица «адрес ×
// проверки», список «не так» с подсказкой, где поправить, — правила Cloudflare или правила зоны CDN
// Bunny, — и итог; в конце — хосты между собой. Страницы нет: смотреть глазами нечего.

import { formatMs } from "../embed/report.js";
import { textTable } from "../report/table.js";
import {
  CHECK_GROUPS,
  type CheckGroup,
  type CheckReport,
  checkFailed,
  type TargetReport,
} from "./check.js";
import {
  BUNNY_CACHE_RULE,
  BUNNY_HEADERS_RULE,
  BUNNY_JSON_TYPE_RULE,
  BUNNY_MANIFEST_RULE,
  BUNNY_SVG_RULE,
  BUNNY_SVG_TYPE_RULE,
  type CdnProvider,
  CF_CACHE_RULE,
  CF_HEADERS_RULE,
  CF_SVG_RULE,
} from "./config.js";

/** Заголовки колонок таблицы. */
export const CHECK_GROUP_TITLES: Record<CheckGroup, string> = {
  status: "Ответ",
  https: "HTTPS",
  type: "Тип",
  cache: "Кэш",
  edge: "CDN",
  cors: "CORS",
  security: "Защита",
  encoding: "Сжатие",
  body: "Файл",
};

/** Где поправить проблему группы — у каждого провайдера свои правила. */
export const CHECK_HINTS: Record<CdnProvider, Record<CheckGroup, string>> = {
  cloudflare: {
    status:
      "файлы раздачи выкладывает «Выкладка» (pnpm cdn upload, ADR-0022); «нет ответа» — сбой сети или хоста",
    https:
      "переход на https — настройка зоны iconavo.dev в Cloudflare: SSL/TLS → Edge Certificates → Always Use HTTPS (ADR-0023)",
    type: "Content-Type хранится у объекта R2 и задаётся выгрузкой (ADR-0022)",
    cache: `Cache-Control хранится у объекта R2 и задаётся выгрузкой (ADR-0022); если у объекта он верный, его переписал Cloudflare — в правиле кэша «${CF_CACHE_RULE}» Browser TTL должен быть «Respect origin»`,
    edge: `правило кэша Cloudflare «${CF_CACHE_RULE}»: всё на хосте, кроме /manifest.json (ADR-0023); Server не cloudflare — запрос прошёл мимо Cloudflare`,
    cors: `правило заголовков Cloudflare «${CF_HEADERS_RULE}» (ADR-0023)`,
    security: `правила заголовков Cloudflare «${CF_HEADERS_RULE}» и, для SVG, «${CF_SVG_RULE}» (ADR-0023)`,
    encoding:
      "сжатие br и gzip Cloudflare включает сам — проверьте Compression Rules зоны iconavo.dev",
    body: "файл на CDN не тот, что описан: пересоберите и выложите раздачу (pnpm cdn build, «Выкладка»)",
  },
  bunny: {
    status:
      "файлы раздачи выкладывает «Выкладка» (pnpm cdn upload, ADR-0025); «нет ответа» — сбой сети или хоста, а у нового хоста — запись cdn2 в DNS Cloudflare или сертификат зоны CDN Bunny",
    https:
      "переход на https — Force SSL у адреса cdn2.iconavo.dev: зона CDN Bunny → General → Hostnames (ADR-0025)",
    type: `Bunny отдаёт тип по расширению, без charset: Content-Type с charset ставят правила зоны CDN Bunny «${BUNNY_JSON_TYPE_RULE}» и «${BUNNY_SVG_TYPE_RULE}» (ADR-0025)`,
    cache: `Cache-Control ставят правила зоны CDN Bunny «${BUNNY_CACHE_RULE}» и «${BUNNY_MANIFEST_RULE}» (ADR-0025)`,
    edge: `правила зоны CDN Bunny «${BUNNY_CACHE_RULE}» (файлы версий — в кэш CDN) и «${BUNNY_MANIFEST_RULE}» (манифест — мимо кэша), Smart Cache выключен (ADR-0025); Server не BunnyCDN — запись cdn2 в DNS Cloudflare должна быть «DNS only» (серое облако)`,
    cors: `правило зоны CDN Bunny «${BUNNY_HEADERS_RULE}»; встроенный CORS зоны выключен, иначе заголовок двоится (ADR-0025)`,
    security: `правила зоны CDN Bunny «${BUNNY_HEADERS_RULE}» и, для SVG, «${BUNNY_SVG_RULE}» (ADR-0025)`,
    encoding:
      "сжатие br и gzip Bunny делает сам — проверьте настройки сжатия зоны CDN",
    body: "файл на CDN не тот, что описан: пересоберите и выложите раздачу (pnpm cdn build, «Выкладка»)",
  },
};

const LEGENDS: Record<CdnProvider, string> = {
  cloudflare:
    "HTTPS — переход с http:// на https://, Тип — Content-Type, Кэш — Cache-Control, CDN — кэш на серверах Cloudflare (cf-cache-status) и Server, Защита — nosniff, CORP и у SVG CSP, Файл — схема или контрольная сумма.",
  bunny:
    "HTTPS — переход с http:// на https://, Тип — Content-Type, Кэш — Cache-Control, CDN — кэш на серверах Bunny (CDN-Cache) и Server, Защита — nosniff, CORP и у SVG CSP, Файл — схема или контрольная сумма.",
};

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

/** Строки после таблицы: расшифровка колонок, что не так и где поправить, итог хоста. */
export function formatCheckSummary(r: CheckReport): string[] {
  const lines = [LEGENDS[r.provider]];
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
      lines.push(`  ${CHECK_GROUP_TITLES[g]} — ${CHECK_HINTS[r.provider][g]}`);
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

/** Итог по всем хостам: расхождения хостов между собой и где не так. */
export function formatCheckTotal(
  reports: readonly CheckReport[],
  cross: readonly string[],
): string[] {
  const lines: string[] = [];
  if (cross.length > 0) {
    lines.push("Хосты между собой — не так:");
    for (const c of cross) lines.push(`  ${c}`);
    lines.push(
      "  Если идёт «Выкладка», повторите проверку после неё; иначе запустите «Выкладку» — она допишет второй хост.",
      "",
    );
  }
  const failed = reports.filter(checkFailed).map((r) => r.host);
  const hosts = reports.map((r) => r.host).join(" и ");
  lines.push(
    failed.length === 0 && cross.length === 0
      ? `Итог по хостам: ок — ${hosts}, манифесты совпадают.`
      : `Итог по хостам: не так — ${[...failed, ...(cross.length > 0 ? ["манифесты различаются"] : [])].join(", ")}.`,
  );
  return lines;
}
