// Отчёт проверки живых примеров (фаза 3, шаг 10): таблица «проверка × браузер, пример и режим» для
// терминала, ниже — что не так; страница .cache/reports/starters/check.html с той же таблицей,
// архивами пакетов, ссылками и снимками и сводка check.md для страницы запуска CI. «—» — не
// проверялось или только сведения.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "../sandbox/browser.js";
import type { Verdict } from "../sandbox/verdict.js";
import {
  CHECKS,
  type CheckId,
  MODE_TITLES,
  type StarterResult,
  startersCheckFailed,
} from "./check.js";
import { STARTER_TITLES } from "./config.js";
import { CREATE_NEXT_APP, STACKBLITZ_LINKS } from "./links.js";
import type { StartersReport } from "./run.js";

const mark = (v: Verdict | undefined) =>
  v === undefined || v.ok === null ? "—" : v.ok ? "да" : "НЕТ";

const column = (r: StarterResult) =>
  `${BROWSER_TITLES[r.browser]}, ${STARTER_TITLES[r.starter]}, ${MODE_TITLES[r.mode]}`;

const tableHead = (results: StarterResult[]) => [
  "Проверка",
  ...results.map(column),
];

const tableRows = (results: StarterResult[]) =>
  CHECKS.map(([id, title]) => [
    title,
    ...results.map((r) => (r.failure ? "сбой" : mark(r.verdicts[id]))),
  ]);

/** Что не так: сбой в столбце или строки «НЕТ» с пояснением; общие строки — один раз. */
const problems = (results: StarterResult[]) => [
  ...new Set(
    results.flatMap((r) =>
      r.failure
        ? [`${column(r)}: ${r.failure}`]
        : CHECKS.filter(([id]) => r.verdicts[id]?.ok === false).map(
            ([id, title]) => `${column(r)} — ${title}: ${r.verdicts[id]?.note}`,
          ),
    ),
  ),
];

const summary = (report: StartersReport) =>
  startersCheckFailed(report.results)
    ? "Итог: есть проблемы."
    : `Итог: примеры работают во всех проверенных браузерах и режимах${report.npm ? " — пакеты из npm, живые хосты" : ""}.`;

export function formatStartersCheck(report: StartersReport): string[] {
  const lines = [
    textTable(tableHead(report.results), tableRows(report.results)),
  ];
  const list = problems(report.results);
  if (list.length > 0) lines.push("", "Не так:", ...list.map((p) => `  ${p}`));
  lines.push("", summary(report));
  return lines;
}

/** Сводка для страницы запуска CI: та же таблица в Markdown. */
export function markdownStartersCheck(report: StartersReport): string {
  const list = problems(report.results);
  return [
    `### Живые примеры (pnpm starters --check${report.npm ? " --npm" : ""})`,
    "",
    markdownTable(tableHead(report.results), tableRows(report.results)),
    "",
    ...(list.length > 0
      ? ["Не так:", "", ...list.map((p) => `- ${p}`), ""]
      : []),
    summary(report),
    "",
  ].join("\n");
}

const STYLE = `
td.ok { color: var(--ok); font-weight: 600; } td.stop { color: var(--stop); font-weight: 600; }
td .note { display: block; color: var(--muted); font-weight: normal; font-size: 12px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
figure { margin: 0; } figure img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { font-size: 13px; color: var(--muted); margin-top: 4px; }
code { background: var(--code); border-radius: 4px; padding: 0 3px; }
`;

function cell(r: StarterResult, id: CheckId): string {
  if (r.failure) return `<td class="stop">сбой</td>`;
  const v = r.verdicts[id];
  const status = v?.ok === true ? "ok" : v?.ok === false ? "stop" : "";
  return `<td class="${status}">${mark(v)}<span class="note">${esc(v?.note ?? "не проверялось")}</span></td>`;
}

export function renderStartersCheckPage(report: StartersReport): string {
  const { results } = report;
  const head = results.map((r) => `<th>${esc(column(r))}</th>`).join("");
  const rows = CHECKS.map(
    ([id, title]) =>
      `<tr><td>${esc(title)}</td>${results.map((r) => cell(r, id)).join("")}</tr>`,
  ).join("\n");
  const failures = results
    .filter((r) => r.failure)
    .map((r) => `<li>${esc(column(r))}: ${esc(r.failure ?? "")}</li>`)
    .join("");
  const packs =
    report.packs.length === 0
      ? '<p class="muted">Пакеты — из реестра npm.</p>'
      : `<table><thead><tr><th>Пакет</th><th>Файлов</th><th>Байт</th><th>SHA-256</th></tr></thead><tbody>${report.packs
          .map(
            (p) =>
              `<tr><td>${esc(`${p.name}@${p.version}`)}</td><td class="num">${p.files.length}</td><td class="num">${p.bytes}</td><td><code>${esc(p.sha256.slice(0, 16))}…</code></td></tr>`,
          )
          .join("")}</tbody></table>`;
  const links = Object.entries(STACKBLITZ_LINKS)
    .map(
      ([id, url]) =>
        `<li>${esc(STARTER_TITLES[id as keyof typeof STARTER_TITLES])}: <a href="${esc(url)}">${esc(url)}</a></li>`,
    )
    .join("");
  const shots = results
    .map(
      (r) =>
        `<h2>${esc(column(r))}</h2>${
          r.shots.length === 0
            ? '<p class="muted">Снимков нет.</p>'
            : `<div class="shots">${r.shots
                .map(
                  (s) =>
                    `<figure><img alt="${esc(s.title)}" src="data:image/png;base64,${s.png}"><figcaption>${esc(s.title)}</figcaption></figure>`,
                )
                .join("")}</div>`
        }`,
    )
    .join("\n");
  const verdict = startersCheckFailed(results)
    ? '<p class="stop">Есть проблемы — строки «НЕТ» и сбои ниже.</p>'
    : '<p class="ok">Примеры работают во всех проверенных браузерах и режимах.</p>';
  return htmlPage(
    "Живые примеры в трёх браузерах",
    STYLE,
    `<h1>Живые примеры в трёх браузерах</h1>
<p class="muted">pnpm starters --check${report.npm ? " --npm" : ""}: примеры examples/starters — HTML без сборщика, React на Vite и Next.js — в Chrome, Firefox и WebKit, движке Safari. ${
      report.npm
        ? "Пакеты — из реестра npm по lock-файлу примера, иконки — с живых хостов, скрипт тега — с jsDelivr: как у разработчика после публикации."
        : "Пакеты — архивы pnpm pack этой ветки, их ставит npm в копию примера; иконки отдаёт превью API этой ветки вместо живых хостов (у сервера Next.js — через подмену fetch, в самих примерах её нет), скрипт тега — файл из архива вместо jsDelivr."
    } «—» — не проверялось или только сведения.</p>
${verdict}
${failures ? `<ul>${failures}</ul>` : ""}
<table><thead><tr><th>Проверка</th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
<h2>Архивы пакетов</h2>
${packs}
<h2>Ссылки</h2>
<ul>${links}<li>Next.js: <code>${esc(CREATE_NEXT_APP)}</code></li></ul>
${shots}`,
  );
}
