// Отчёт проверки тега в браузерах (фаза 3, шаг 5): таблица «проверка × браузер» для терминала, ниже —
// что не так, страница .cache/reports/sandbox/check.html с той же таблицей, пояснениями и снимками
// каждого браузера и сводка check.md для страницы запуска CI. «—» — не проверялось или только
// сведения: дерево доступности, по которому проверяется подпись, Playwright даёт только у Chrome.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "./browser.js";
import {
  type BrowserResult,
  CHECKS,
  sandboxCheckFailed,
  type Verdict,
} from "./check.js";

const mark = (v: Verdict | undefined) =>
  v === undefined || v.ok === null ? "—" : v.ok ? "да" : "НЕТ";

const tableHead = (results: BrowserResult[]) => [
  "Проверка",
  ...results.map((r) => BROWSER_TITLES[r.browser]),
];

const tableRows = (results: BrowserResult[]) =>
  CHECKS.map(([id, title]) => [
    title,
    ...results.map((r) => (r.failure ? "сбой" : mark(r.verdicts[id]))),
  ]);

/** Что не так: сбой браузера или строки «НЕТ» с пояснением. */
const problems = (results: BrowserResult[]) =>
  results.flatMap((r) =>
    r.failure
      ? [`${BROWSER_TITLES[r.browser]}: ${r.failure}`]
      : CHECKS.filter(([id]) => r.verdicts[id]?.ok === false).map(
          ([id, title]) =>
            `${BROWSER_TITLES[r.browser]} — ${title}: ${r.verdicts[id]?.note}`,
        ),
  );

const summary = (results: BrowserResult[]) =>
  sandboxCheckFailed(results)
    ? "Итог: есть проблемы."
    : "Итог: тег работает во всех проверенных браузерах.";

export function formatSandboxCheck(results: BrowserResult[]): string[] {
  const lines = [textTable(tableHead(results), tableRows(results))];
  const list = problems(results);
  if (list.length > 0) lines.push("", "Не так:", ...list.map((p) => `  ${p}`));
  lines.push("", summary(results));
  return lines;
}

/** Сводка для страницы запуска CI: та же таблица в Markdown. */
export function markdownSandboxCheck(results: BrowserResult[]): string {
  const list = problems(results);
  return [
    "### Тег в браузере (pnpm sandbox --check)",
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

function cell(r: BrowserResult, id: (typeof CHECKS)[number][0]): string {
  if (r.failure) return `<td class="stop">сбой</td>`;
  const v = r.verdicts[id];
  const status = v?.ok === true ? "ok" : v?.ok === false ? "stop" : "";
  return `<td class="${status}">${mark(v)}<span class="note">${esc(v?.note ?? "не проверялось")}</span></td>`;
}

export function renderSandboxCheckPage(results: BrowserResult[]): string {
  const head = results
    .map((r) => `<th>${esc(BROWSER_TITLES[r.browser])}</th>`)
    .join("");
  const rows = CHECKS.map(
    ([id, title]) =>
      `<tr><td>${esc(title)}</td>${results.map((r) => cell(r, id)).join("")}</tr>`,
  ).join("\n");
  const failures = results
    .filter((r) => r.failure)
    .map(
      (r) =>
        `<li>${esc(BROWSER_TITLES[r.browser])}: ${esc(r.failure ?? "")}</li>`,
    )
    .join("");
  const shots = results
    .map(
      (r) =>
        `<h2>${esc(BROWSER_TITLES[r.browser])}</h2>${
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
  const verdict = sandboxCheckFailed(results)
    ? '<p class="stop">Есть проблемы — строки «НЕТ» и сбои ниже.</p>'
    : '<p class="ok">Тег работает во всех проверенных браузерах.</p>';
  return htmlPage(
    "Песочница: тег в трёх браузерах",
    STYLE,
    `<h1>Песочница: тег в трёх браузерах</h1>
<p class="muted">pnpm sandbox --check: страницы «Тег» и «5000 иконок» в Chrome, Firefox и WebKit — движке Safari (вне Mac, по документации Playwright, у него отличаются видео, графика и сеть). Сеть не нужна: API и статика — превью на этом компьютере. «—» — не проверялось или только сведения.</p>
${verdict}
${failures ? `<ul>${failures}</ul>` : ""}
<table><thead><tr><th>Проверка</th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
${shots}`,
  );
}
