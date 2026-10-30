// Отчёты выпуска (ADR-0051): таблица в терминале, Markdown для сводки запуска CI и страница
// .cache/reports/release/{prepare,verify}.html. Без отметок времени: одинаковый вход — тот же файл.

import { npmPage } from "../npm/config.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { scriptUrl } from "./config.js";
import { type ReleasePrepareReport, releaseStop } from "./prepare.js";
import {
  type ReleaseVerifyReport,
  releaseVerifyFailed,
  type VerifyStatus,
} from "./verify.js";

const ACTIONS: Record<string, string> = {
  new: "первая публикация",
  awaiting: "ждёт первой публикации",
  release: "новая версия",
  published: "уже в npm",
};

const kb = (bytes: number | undefined) =>
  bytes === undefined
    ? "—"
    : `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;

const prepareRows = (r: ReleasePrepareReport) =>
  r.packages.map((p) => [
    p.name,
    p.version,
    p.action ? (ACTIONS[p.action] ?? p.action) : "—",
    p.publish ? "да" : "нет",
    p.base ?? "—",
    String(p.files.length),
    kb(p.bytes),
    p.problems.length > 0 ? "СТОП" : "ок",
  ]);

const PREPARE_HEAD = [
  "Пакет",
  "Версия",
  "Что",
  "Публиковать",
  "Сейчас под тегом",
  "Файлов",
  "Архив",
  "Итог",
];

/** Итог подготовки в терминале: проверки, пакеты, что дальше. */
export function formatReleasePrepare(r: ReleasePrepareReport): string[] {
  const out: string[] = [];
  for (const c of r.checks) {
    out.push(`${c.problems.length > 0 ? "СТОП" : "ок  "}  ${c.title}`);
    for (const p of c.problems) out.push(`      — ${p}`);
    for (const n of c.notes) out.push(`      ${n}`);
  }
  if (r.unreleased) return out;
  if (r.script) {
    out.push(
      `Скрипт тега: ${r.script.bytes} Б, в gzip ${r.script.gzipBytes} Б, свежая сборка ${r.script.integrity}`,
    );
  }
  out.push("");
  out.push(textTable(PREPARE_HEAD, prepareRows(r)));
  for (const p of r.packages) {
    for (const problem of p.problems) out.push(`СТОП ${p.name}: ${problem}`);
    for (const note of p.notes) out.push(`${p.name}: ${note}`);
  }
  out.push("");
  out.push(`Итог: ${prepareVerdict(r)}`);
  return out;
}

/** Итог подготовки одной фразой: что будет дальше. */
export function prepareVerdict(r: ReleasePrepareReport): string {
  if (releaseStop(r)) return "СТОП — план не записан, публиковать нечего.";
  if (r.unreleased) return "пакеты ещё не выпускались — выпускать нечего.";
  if (r.planned) {
    return `план записан — к публикации ${r.packages
      .filter((p) => p.publish)
      .map((p) => `${p.name}@${p.version}`)
      .join(", ")}.`;
  }
  if (r.packages.some((p) => p.action === "awaiting")) {
    return "пакеты ждут первой публикации: ручной запуск «Выпуска пакетов» с «Первой публикацией» и временным токеном (ADR-0051).";
  }
  return `всё в порядке, публиковать нечего: ${r.version} уже в npm.`;
}

/** Та же таблица в Markdown — для сводки запуска CI. */
export function markdownReleasePrepare(r: ReleasePrepareReport): string {
  const lines = [`### Подготовка выпуска ${r.version}`, ""];
  for (const c of r.checks) {
    lines.push(`- ${c.problems.length > 0 ? "**СТОП**" : "ок"} — ${c.title}`);
    for (const p of c.problems) lines.push(`  - ${p}`);
  }
  if (!r.unreleased) {
    lines.push("", markdownTable(PREPARE_HEAD, prepareRows(r)));
    for (const p of r.packages) {
      for (const problem of p.problems)
        lines.push(`- **СТОП** ${p.name}: ${problem}`);
      for (const note of p.notes) lines.push(`- ${p.name}: ${note}`);
    }
  }
  lines.push("", `**Итог:** ${prepareVerdict(r)}`);
  return `${lines.join("\n")}\n`;
}

const STYLE = `.svg { width: 96px; height: 96px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
code { overflow-wrap: anywhere; }`;

const listOf = (items: string[], cls = "") =>
  items.length === 0
    ? ""
    : `<ul>${items.map((i) => `<li${cls ? ` class="${cls}"` : ""}>${esc(i)}</li>`).join("")}</ul>`;

/** Страница подготовки. */
export function renderReleasePreparePage(r: ReleasePrepareReport): string {
  const checks = r.checks
    .map(
      (c) =>
        `<h3><span class="${c.problems.length > 0 ? "stop" : "ok"}">${c.problems.length > 0 ? "СТОП" : "ок"}</span> ${esc(c.title)}</h3>${listOf(c.problems, "stop")}${listOf(c.notes)}`,
    )
    .join("\n");
  const rows = r.unreleased
    ? ""
    : `<h2>Пакеты</h2><table><thead><tr>${PREPARE_HEAD.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${prepareRows(
        r,
      )
        .map(
          (row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>${r.packages
        .map(
          (p) =>
            `<h3>${esc(p.name)}@${esc(p.version)}</h3>${listOf(p.problems, "stop")}${listOf(p.notes)}<p class="muted">Файлы архива: ${esc(p.files.join(", "))}</p>`,
        )
        .join("")}`;
  const script = r.script
    ? `<h2>Скрипт тега</h2><p>Адрес: <code>${esc(scriptUrl(r.version))}</code></p><ul><li>свежая сборка: <code>${esc(r.script.integrity)}</code>, ${r.script.bytes} Б, в gzip ${r.script.gzipBytes} Б</li><li>в README: <code>${esc(r.script.readme ?? "—")}</code></li>${r.script.published ? `<li>в опубликованном архиве: <code>${esc(r.script.published)}</code></li>` : ""}</ul>`
    : "";
  const verdict = `<p class="${releaseStop(r) ? "stop" : "ok"}">Итог: ${esc(prepareVerdict(r))}</p>`;
  return htmlPage(
    `Выпуск ${r.version}: подготовка`,
    STYLE,
    `<h1>Выпуск ${esc(r.version)}: подготовка</h1>
<p class="muted">pnpm release prepare${r.first ? " --first" : ""} (ADR-0051): поля пакетов, журнал, адрес и хэш скрипта, архивы pnpm pack и реестр npm — только чтение. Тег — ${esc(r.tag)}.${r.commit ? ` Коммит ${esc(r.commit)}.` : ""}</p>
${verdict}
<h2>Проверки</h2>
${checks}
${script}
${rows}`,
  );
}

const STATUS: Record<VerifyStatus, string> = {
  ok: "ок",
  failed: "СТОП",
  skipped: "—",
};

const verifyRows = (r: ReleaseVerifyReport) =>
  r.packages.map((p) => [
    p.name,
    p.version,
    p.tagged ?? "—",
    p.latest ?? "—",
    p.publisher === "trusted"
      ? "доверенная"
      : p.publisher === "token"
        ? "токен"
        : "—",
    p.provenance?.workflow ?? "—",
    STATUS[p.status],
  ]);

const VERIFY_HEAD = [
  "Пакет",
  "Версия",
  "Под тегом",
  "latest",
  "Публикация",
  "Provenance",
  "Итог",
];

export function formatReleaseVerify(r: ReleaseVerifyReport): string[] {
  const out = [textTable(VERIFY_HEAD, verifyRows(r)), ""];
  for (const p of r.packages) {
    for (const problem of p.problems) out.push(`СТОП ${p.name}: ${problem}`);
    for (const note of p.notes) out.push(`${p.name}: ${note}`);
  }
  for (const [title, part] of [
    ["jsDelivr", r.jsdelivr],
    ["Чистый проект", r.clean],
  ] as const) {
    out.push(`${STATUS[part.status]}  ${title}`);
    for (const p of part.problems) out.push(`      — ${p}`);
    for (const n of part.notes) out.push(`      ${n}`);
  }
  out.push("");
  out.push(
    releaseVerifyFailed(r)
      ? "Итог: СТОП — выпуск в npm не такой, как задуман."
      : `Итог: ${r.version} в npm, на jsDelivr и ставится в чистый проект.`,
  );
  return out;
}

export function markdownReleaseVerify(r: ReleaseVerifyReport): string {
  const lines = [
    `### Проверка выпуска ${r.version}`,
    "",
    markdownTable(VERIFY_HEAD, verifyRows(r)),
    "",
  ];
  for (const p of r.packages) {
    for (const problem of p.problems)
      lines.push(`- **СТОП** ${p.name}: ${problem}`);
  }
  for (const [title, part] of [
    ["jsDelivr", r.jsdelivr],
    ["Чистый проект", r.clean],
  ] as const) {
    lines.push(
      `- ${part.status === "failed" ? "**СТОП**" : STATUS[part.status]} — ${title}`,
    );
    for (const p of part.problems) lines.push(`  - ${p}`);
    for (const n of part.notes) lines.push(`  - ${n}`);
  }
  return `${lines.join("\n")}\n`;
}

/** SVG из renderToString — картинкой: без xmlns браузер не покажет его в <img>. */
const svgImage = (svg: string) =>
  svgDataUri(
    svg.includes("xmlns=")
      ? svg
      : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'),
  );

export function renderReleaseVerifyPage(r: ReleaseVerifyReport): string {
  const parts = (
    [
      [
        "jsDelivr",
        r.jsdelivr,
        `<p>Адрес: <code>${esc(r.jsdelivr.url)}</code></p>`,
      ],
      [
        "Чистый проект",
        r.clean,
        r.clean.svg
          ? `<p>Иконка, которую нарисовал пакет из npm (renderToString):</p><img class="svg" alt="" src="${svgImage(r.clean.svg)}"><pre>${esc(r.clean.svg)}</pre>`
          : "",
      ],
    ] as const
  )
    .map(
      ([title, part, extra]) =>
        `<h2><span class="${part.status === "failed" ? "stop" : "ok"}">${STATUS[part.status]}</span> ${esc(title)}</h2>${extra}${listOf(part.problems, "stop")}${listOf(part.notes)}`,
    )
    .join("\n");
  return htmlPage(
    `Выпуск ${r.version}: проверка`,
    STYLE,
    `<h1>Выпуск ${esc(r.version)}: проверка</h1>
<p class="muted">pnpm release verify (ADR-0051): версия под тегом ${esc(r.tag)}, архив, provenance, доверенная публикация, jsDelivr и чистый проект.</p>
<p class="${releaseVerifyFailed(r) ? "stop" : "ok"}">${releaseVerifyFailed(r) ? "СТОП — выпуск в npm не такой, как задуман." : "Выпуск в npm, на jsDelivr и ставится в чистый проект."}</p>
<h2>Пакеты</h2>
<table><thead><tr>${VERIFY_HEAD.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${verifyRows(
      r,
    )
      .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>
${r.packages
  .map(
    (p) =>
      `<h3><a href="${esc(npmPage(p.name))}">${esc(p.name)}</a></h3>${listOf(p.problems, "stop")}${listOf(p.notes)}`,
  )
  .join("")}
${parts}`,
  );
}
