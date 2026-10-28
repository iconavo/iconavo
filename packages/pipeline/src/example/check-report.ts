// Отчёт проверки примера на Next.js (фаза 3, шаг 7): таблица «проверка × браузер и режим» для терминала,
// ниже — что не так, страница .cache/reports/example/check.html с той же таблицей, пояснениями и
// снимками и сводка check.md для страницы запуска CI. «—» — не проверялось или только сведения.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "../sandbox/browser.js";
import type { Verdict } from "../sandbox/verdict.js";
import {
  CHECKS,
  type CheckId,
  type ExampleResult,
  exampleCheckFailed,
  MODE_TITLES,
} from "./check.js";

const mark = (v: Verdict | undefined) =>
  v === undefined || v.ok === null ? "—" : v.ok ? "да" : "НЕТ";

const column = (r: ExampleResult) =>
  `${BROWSER_TITLES[r.browser]}, ${MODE_TITLES[r.mode]}`;

const tableHead = (results: ExampleResult[]) => [
  "Проверка",
  ...results.map(column),
];

const tableRows = (results: ExampleResult[]) =>
  CHECKS.map(([id, title]) => [
    title,
    ...results.map((r) => (r.failure ? "сбой" : mark(r.verdicts[id]))),
  ]);

/** Что не так: сбой браузера в режиме или строки «НЕТ» с пояснением. */
const problems = (results: ExampleResult[]) =>
  results.flatMap((r) =>
    r.failure
      ? [`${column(r)}: ${r.failure}`]
      : CHECKS.filter(([id]) => r.verdicts[id]?.ok === false).map(
          ([id, title]) => `${column(r)} — ${title}: ${r.verdicts[id]?.note}`,
        ),
  );

const summary = (results: ExampleResult[]) =>
  exampleCheckFailed(results)
    ? "Итог: есть проблемы."
    : "Итог: пример работает во всех проверенных браузерах и режимах.";

export function formatExampleCheck(results: ExampleResult[]): string[] {
  const lines = [textTable(tableHead(results), tableRows(results))];
  const list = problems(results);
  if (list.length > 0) lines.push("", "Не так:", ...list.map((p) => `  ${p}`));
  lines.push("", summary(results));
  return lines;
}

/** Сводка для страницы запуска CI: та же таблица в Markdown. */
export function markdownExampleCheck(results: ExampleResult[]): string {
  const list = problems(results);
  return [
    "### React и пример на Next.js (pnpm example --check)",
    "",
    markdownTable(tableHead(results), tableRows(results)),
    "",
    ...(list.length > 0
      ? ["Не так:", "", ...list.map((p) => `- ${p}`), ""]
      : []),
    summary(results),
    "",
  ].join("\n");
}

const STYLE = `
td.ok { color: var(--ok); font-weight: 600; } td.stop { color: var(--stop); font-weight: 600; }
td .note { display: block; color: var(--muted); font-weight: normal; font-size: 12px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
figure { margin: 0; } figure img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { font-size: 13px; color: var(--muted); margin-top: 4px; }
`;

function cell(r: ExampleResult, id: CheckId): string {
  if (r.failure) return `<td class="stop">сбой</td>`;
  const v = r.verdicts[id];
  const status = v?.ok === true ? "ok" : v?.ok === false ? "stop" : "";
  return `<td class="${status}">${mark(v)}<span class="note">${esc(v?.note ?? "не проверялось")}</span></td>`;
}

export function renderExampleCheckPage(results: ExampleResult[]): string {
  const head = results.map((r) => `<th>${esc(column(r))}</th>`).join("");
  const rows = CHECKS.map(
    ([id, title]) =>
      `<tr><td>${esc(title)}</td>${results.map((r) => cell(r, id)).join("")}</tr>`,
  ).join("\n");
  const failures = results
    .filter((r) => r.failure)
    .map((r) => `<li>${esc(column(r))}: ${esc(r.failure ?? "")}</li>`)
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
  const verdict = exampleCheckFailed(results)
    ? '<p class="stop">Есть проблемы — строки «НЕТ» и сбои ниже.</p>'
    : '<p class="ok">Пример работает во всех проверенных браузерах и режимах.</p>';
  return htmlPage(
    "Пример на Next.js: React в трёх браузерах",
    STYLE,
    `<h1>Пример на Next.js: React в трёх браузерах</h1>
<p class="muted">pnpm example --check: пример examples/next в режиме разработки (next dev) и в продакшен-сборке (next build и next start), в Chrome, Firefox и WebKit — движке Safari. Иконки «с сервера» передаёт IconavoProvider, остальные браузер загружает сам; ответы API задержаны, чтобы было видно, что место держит резерв. Сеть не нужна: API и статика — превью на этом компьютере. «—» — не проверялось или только сведения.</p>
${verdict}
${failures ? `<ul>${failures}</ul>` : ""}
<table><thead><tr><th>Проверка</th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
${shots}`,
  );
}
