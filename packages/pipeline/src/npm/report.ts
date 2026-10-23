// Отчёты пакетов npm (ADR-0026): строки и таблицы для терминала и страницы
// .cache/reports/npm/index.html (подготовка: решение, версии, файлы, package.json и README) и
// verify.html (проверка после публикации). Без скриптов и без времени: одинаковый вход — одинаковая
// страница.

import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import { formatBytes } from "../sources/report.js";
import {
  NPM_NAMES_LIMIT,
  NPM_OUT_DIR,
  NPM_PLAN_FILE,
  npmPage,
} from "./config.js";
import type { NpmAction } from "./decide.js";
import type { NpmPackageReport, NpmPrepareReport } from "./prepare.js";
import {
  type NpmVerifyEntry,
  type NpmVerifyReport,
  type NpmVerifyStatus,
  npmVerifyFailed,
} from "./verify.js";

const ACTION: Record<NpmAction, string> = {
  new: "новый пакет",
  awaiting: "ждёт первой публикации",
  unchanged: "без изменений",
  major: "новый формат",
  minor: "новые имена",
  patch: "изменения",
};

const VERIFY: Record<NpmVerifyStatus, string> = {
  ok: "ок",
  awaiting: "ждёт первой публикации",
  failed: "не так",
};

const PUBLISHER = { trusted: "доверенная публикация", token: "токен" };

const shortHash = (hash: string | undefined) =>
  hash === undefined ? "—" : hash.slice(0, 12);

const sizeOf = (r: NpmPackageReport) =>
  r.files.reduce((n, f) => n + f.bytes, 0);

const actionText = (r: NpmPackageReport) =>
  r.stop.length > 0 ? "СТОП" : r.action === undefined ? "—" : ACTION[r.action];

/** Решение одной строкой: что было в npm и что будет. */
function decisionLine(r: NpmPackageReport, tag: string): string {
  switch (r.action) {
    case "new":
      return `пакета в npm нет — первая версия ${r.version}`;
    case "awaiting":
      return `пакета в npm нет — ждёт первой публикации: ручной запуск «Публикации в npm» с «первой публикацией» (версия будет ${r.version})`;
    case "unchanged":
      return `${tag} → ${r.version}: отпечаток тот же, публиковать нечего`;
    case "major":
      return `${tag} → ${r.base}: новый формат пакета — ${r.version}`;
    case "minor":
      return `${tag} → ${r.base}: новых имён ${r.added.length} — ${r.version}`;
    case "patch":
      return `${tag} → ${r.base}: новых имён нет, остальное изменилось — ${r.version}`;
    default:
      return "—";
  }
}

/** Строки одного пакета для терминала. */
export function formatPrepareReport(r: NpmPackageReport, tag: string): string {
  const lines = [`${r.id} — ${r.setName} · ${r.name}`];
  if (r.setVersion !== undefined) {
    const hidden = r.hidden > 0 ? ` (скрытых ${r.hidden})` : "";
    lines.push(
      `  Набор ${r.setVersion} · иконок ${r.icons}${hidden} · алиасов ${r.aliases} · файлов ${r.files.length} · ${formatBytes(sizeOf(r))}`,
    );
  }
  for (const s of r.stop) lines.push(`  СТОП — ${s}`);
  if (r.action !== undefined) {
    lines.push(`  ${decisionLine(r, tag)}`);
    if (r.added.length > 0) {
      const shown = r.added.slice(0, NPM_NAMES_LIMIT).join(", ");
      lines.push(
        `  Новые имена: ${shown}${r.added.length > NPM_NAMES_LIMIT ? ` … и ещё ${r.added.length - NPM_NAMES_LIMIT}` : ""}`,
      );
    }
    lines.push(
      r.written
        ? `  записано ${NPM_OUT_DIR}/${r.id}/`
        : `  ${NPM_OUT_DIR}/${r.id}/ уже такая же`,
    );
  }
  return lines.join("\n");
}

/** Итоговая таблица подготовки. */
export function formatPrepareTable(r: NpmPrepareReport): string {
  const head = [
    "Пакет",
    "Набор",
    "Решение",
    `В npm (${r.tag})`,
    "Версия",
    "Файлов",
    "Размер",
  ];
  const rows = r.packages.map((p) => [
    p.name,
    p.setVersion ?? "—",
    actionText(p),
    p.base ?? "—",
    p.version ?? "—",
    String(p.files.length),
    p.files.length === 0 ? "—" : formatBytes(sizeOf(p)),
  ]);
  return textTable(head, rows, 3);
}

/** Итоговые строки: план, что выйдет, что ждёт первой публикации. */
export function formatPrepareSummary(r: NpmPrepareReport): string[] {
  const stopped = r.packages.filter((p) => p.stop.length > 0).length;
  if (stopped > 0) {
    return [
      `План: не записан — остановлено пакетов: ${stopped}; CI ничего не опубликует`,
    ];
  }
  const lines = [
    `План: ${NPM_OUT_DIR}/${NPM_PLAN_FILE} — ${r.planWritten ? "записан" : "без изменений"}`,
  ];
  const publish = r.packages.filter(
    (p) =>
      p.action === "new" ||
      p.action === "major" ||
      p.action === "minor" ||
      p.action === "patch",
  );
  lines.push(
    publish.length > 0
      ? `К публикации под тегом ${r.tag}: ${publish.map((p) => `${p.name}@${p.version}`).join(", ")}`
      : "К публикации: ничего",
  );
  const awaiting = r.packages.filter((p) => p.action === "awaiting");
  if (awaiting.length > 0) {
    lines.push(
      `Ждут первой публикации: ${awaiting.map((p) => p.name).join(", ")} — ручной запуск «Публикации в npm» с «первой публикацией» (ADR-0026)`,
    );
  }
  if (r.removed.length > 0) {
    lines.push(`Убрано лишнее из ${NPM_OUT_DIR}/: ${r.removed.join(", ")}`);
  }
  return lines;
}

const CHECKLIST = [
  "У каждого пакета решение такое, как ждёте: «ждёт первой публикации» до первого выпуска, «без изменений», если data/ не менялась.",
  "Таблица файлов: icons.json, info.json, metadata.json, LICENSE, README.md, index.js, index.d.ts и package.json — и ничего лишнего (search.json в пакет не идёт).",
  "README читается: установка с тегом, пример, автор и лицензия набора.",
  "В package.json — лицензия автора набора, адрес репозитория iconavo/iconavo и publishConfig с тегом.",
];

const STYLE = `
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

function prepareSection(r: NpmPackageReport, tag: string): string {
  const parts = [
    `<h2>${esc(r.name)} <span class="muted">${esc(r.setName)}</span></h2>`,
  ];
  for (const s of r.stop) parts.push(`<p class="stop">СТОП — ${esc(s)}</p>`);
  if (r.action === undefined) return parts.join("\n");
  parts.push(
    `<p>Набор <code>${esc(r.setVersion ?? "—")}</code> · иконок ${r.icons}${r.hidden > 0 ? `, скрытых ${r.hidden}` : ""} · алиасов ${r.aliases} · отпечаток <code>${esc(shortHash(r.fingerprint))}</code></p>`,
    `<p class="${r.stop.length > 0 ? "stop" : "ok"}">${esc(decisionLine(r, tag))}</p>`,
    `<p><a href="${esc(npmPage(r.name))}">${esc(npmPage(r.name))}</a></p>`,
  );
  if (r.added.length > 0) {
    const shown = r.added.slice(0, NPM_NAMES_LIMIT);
    parts.push(
      `<h3>Новые имена</h3><p>${shown.map((n) => `<code>${esc(n)}</code>`).join(", ")}${r.added.length > shown.length ? ` … и ещё ${r.added.length - shown.length}` : ""}</p>`,
    );
  }
  const rows = r.files
    .map(
      (f) =>
        `<tr><td><code>${esc(f.path)}</code></td><td class="num">${esc(formatBytes(f.bytes))}</td></tr>`,
    )
    .join("");
  parts.push(
    `<h3>Файлы пакета</h3><table><tr><th>Файл</th><th class="num">Размер</th></tr>${rows}</table>`,
  );
  if (r.packageJson !== undefined) {
    parts.push(`<h3>package.json</h3><pre>${esc(r.packageJson)}</pre>`);
  }
  if (r.readme !== undefined) {
    parts.push(`<h3>README.md</h3><pre>${esc(r.readme)}</pre>`);
  }
  return parts.join("\n");
}

/** Страница .cache/reports/npm/index.html. */
export function renderPreparePage(r: NpmPrepareReport): string {
  const intro = `<h1>Пакеты npm: подготовка</h1>
<p class="muted">Фаза 2, шаг 5 — ADR-0005, ADR-0026.</p>
<p>Из <code>data/</code> собраны пакеты <code>@iconavo-ui/icons-{набор}</code> в папке <code>${NPM_OUT_DIR}/</code>, и для каждого решено, какая версия выйдет под тегом <code>${esc(r.tag)}</code>. Сама подготовка ничего не публикует: план <code>${NPM_OUT_DIR}/${NPM_PLAN_FILE}</code> выполняет workflow «Публикация в npm» из <code>main</code>.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
  const rows = r.packages
    .map(
      (p) =>
        `<tr><td>${esc(p.name)}</td><td><code>${esc(p.setVersion ?? "—")}</code></td><td>${esc(p.base ?? "—")}</td><td>${esc(p.version ?? "—")}</td><td class="${p.stop.length > 0 ? "stop" : "ok"}">${esc(actionText(p))}</td><td class="num">${p.files.length}</td><td class="num">${p.files.length === 0 ? "—" : esc(formatBytes(sizeOf(p)))}</td></tr>`,
    )
    .join("");
  const summary = `<h2>Сводка</h2>
<table><tr><th>Пакет</th><th>Версия набора</th><th>В npm (${esc(r.tag)})</th><th>Версия</th><th>Решение</th><th class="num">Файлов</th><th class="num">Размер</th></tr>${rows}</table>
${formatPrepareSummary(r)
  .map((line) => `<p>${esc(line)}</p>`)
  .join("\n")}`;
  const sections = r.packages.map((p) => prepareSection(p, r.tag)).join("\n");
  return htmlPage("Пакеты npm", STYLE, [intro, summary, sections].join("\n"));
}

const provenanceText = (e: NpmVerifyEntry) => {
  const p = e.provenance;
  if (p === undefined) return "—";
  const repo = p.repository?.replace("https://github.com/", "") ?? "—";
  const workflow = p.workflow?.split("/").at(-1) ?? "—";
  const ref = p.ref?.replace("refs/heads/", "") ?? "—";
  return `${repo}, ${workflow}, ${ref}`;
};

/** Строки одного пакета проверки для терминала. */
export function formatNpmVerifyEntry(e: NpmVerifyEntry, tag: string): string {
  const lines = [`${e.id} — ${e.name}`];
  if (e.version !== undefined) {
    lines.push(
      `  ${tag} → ${e.version} · отпечаток ${e.published === e.fingerprint ? "совпал" : "другой"}${e.files === undefined ? "" : ` · сверено файлов ${e.files}`} · provenance: ${provenanceText(e)} · ${e.publisher === undefined ? "—" : PUBLISHER[e.publisher]}`,
    );
  }
  for (const p of e.problems) lines.push(`  не так — ${p}`);
  for (const n of e.notes) lines.push(`  ${n}`);
  return lines.join("\n");
}

/** Итоговая таблица проверки. */
export function formatNpmVerifyTable(r: NpmVerifyReport): string {
  const head = [
    "Пакет",
    "Итог",
    `Версия (${r.tag})`,
    "Отпечаток",
    "Provenance",
    "Кем",
    "Файлов",
  ];
  const rows = r.packages.map((e) => [
    e.name,
    VERIFY[e.status],
    e.version ?? "—",
    e.version === undefined
      ? "—"
      : e.published === e.fingerprint
        ? "совпал"
        : "другой",
    provenanceText(e),
    e.publisher === undefined ? "—" : PUBLISHER[e.publisher],
    e.files === undefined ? "—" : String(e.files),
  ]);
  return textTable(head, rows, 6);
}

/** Итог проверки одной строкой. */
export function formatNpmVerdict(r: NpmVerifyReport): string {
  const failed = r.packages.filter((e) => e.status === "failed");
  const awaiting = r.packages.filter((e) => e.status === "awaiting");
  if (failed.length > 0) {
    return `Итог: не так — ${failed.map((e) => e.name).join(", ")}`;
  }
  return awaiting.length > 0
    ? `Итог: ок; ждут первой публикации: ${awaiting.map((e) => e.name).join(", ")}`
    : "Итог: ок — в npm ровно эти пакеты";
}

function verifySection(e: NpmVerifyEntry, tag: string): string {
  const parts = [
    `<h2>${esc(e.name)} <span class="${e.status === "failed" ? "stop" : "ok"}">${esc(VERIFY[e.status])}</span></h2>`,
  ];
  if (e.version !== undefined) {
    const p = e.provenance;
    const rows: [string, string][] = [
      [`Версия под тегом ${tag}`, esc(e.version)],
      ["latest", esc(e.latest ?? "—")],
      [
        "Отпечаток",
        `${esc(shortHash(e.published))} ${e.published === e.fingerprint ? "— как у сборки" : `— у сборки ${esc(shortHash(e.fingerprint))}`}`,
      ],
      ["Сверено файлов", e.files === undefined ? "—" : String(e.files)],
      ["Provenance", esc(provenanceText(e))],
      [
        "Коммит",
        p?.commit === undefined ? "—" : `<code>${esc(p.commit)}</code>`,
      ],
      [
        "Запуск CI",
        p?.run === undefined
          ? "—"
          : `<a href="${esc(p.run)}">${esc(p.run)}</a>`,
      ],
      [
        "Кем выложено",
        e.publisher === undefined ? "—" : PUBLISHER[e.publisher],
      ],
    ];
    parts.push(
      `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`,
    );
  }
  for (const pr of e.problems)
    parts.push(`<p class="stop">Не так — ${esc(pr)}</p>`);
  for (const n of e.notes) parts.push(`<p class="muted">${esc(n)}</p>`);
  parts.push(
    `<p><a href="${esc(npmPage(e.name))}">${esc(npmPage(e.name))}</a></p>`,
  );
  return parts.join("\n");
}

/** Страница .cache/reports/npm/verify.html. */
export function renderNpmVerifyPage(r: NpmVerifyReport): string {
  const intro = `<h1>Пакеты npm: проверка</h1>
<p class="muted">Фаза 2, шаг 5 — ADR-0026.</p>
<p>Пакеты собраны заново из <code>data/</code> и сверены с реестром npm: под тегом <code>${esc(r.tag)}</code> — версия с тем же отпечатком, архив побайтно тот же, есть подпись provenance из <code>iconavo/iconavo</code>, workflow <code>publish.yml</code> и ветки <code>main</code>, выложено доверенной публикацией.</p>
<p class="${npmVerifyFailed(r) ? "stop" : "ok"}">${esc(formatNpmVerdict(r))}</p>`;
  const sections = r.packages.map((e) => verifySection(e, r.tag)).join("\n");
  return htmlPage("Пакеты npm: проверка", STYLE, [intro, sections].join("\n"));
}
