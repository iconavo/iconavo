// Отчёт проверки сайта (фаза 3, шаг 10): таблица «проверка × браузер» для терминала, ниже — что не так;
// страница .cache/reports/site/check.html со снимками и сводка check.md для страницы запуска CI.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "../sandbox/browser.js";
import type { Verdict } from "../sandbox/verdict.js";
import {
  CHECKS,
  type CheckId,
  type SiteResult,
  siteCheckFailed,
} from "./check.js";

const mark = (v: Verdict | undefined) =>
  v === undefined || v.ok === null ? "—" : v.ok ? "да" : "НЕТ";

const tableHead = (results: SiteResult[]) => [
  "Проверка",
  ...results.map((r) => BROWSER_TITLES[r.browser]),
];

const tableRows = (results: SiteResult[]) =>
  CHECKS.map(([id, title]) => [
    title,
    ...results.map((r) => (r.failure ? "сбой" : mark(r.verdicts[id]))),
  ]);

const problems = (results: SiteResult[]) => [
  ...new Set(
    results.flatMap((r) =>
      r.failure
        ? [`${BROWSER_TITLES[r.browser]}: ${r.failure}`]
        : CHECKS.filter(([id]) => r.verdicts[id]?.ok === false).map(
            ([id, title]) =>
              `${BROWSER_TITLES[r.browser]} — ${title}: ${r.verdicts[id]?.note}`,
          ),
    ),
  ),
];

const summary = (results: SiteResult[]) =>
  siteCheckFailed(results)
    ? "Итог: есть проблемы."
    : "Итог: сайт работает во всех проверенных браузерах.";

export function formatSiteCheck(results: SiteResult[]): string[] {
  const lines = [textTable(tableHead(results), tableRows(results))];
  const list = problems(results);
  if (list.length > 0) lines.push("", "Не так:", ...list.map((p) => `  ${p}`));
  lines.push("", summary(results));
  return lines;
}

export function markdownSiteCheck(results: SiteResult[]): string {
  const list = problems(results);
  return [
    "### Сайт (pnpm site --check)",
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

function cell(r: SiteResult, id: CheckId): string {
  if (r.failure) return `<td class="stop">сбой</td>`;
  const v = r.verdicts[id];
  const status = v?.ok === true ? "ok" : v?.ok === false ? "stop" : "";
  return `<td class="${status}">${mark(v)}<span class="note">${esc(v?.note ?? "не проверялось")}</span></td>`;
}

export function renderSiteCheckPage(results: SiteResult[]): string {
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
  const verdict = siteCheckFailed(results)
    ? '<p class="stop">Есть проблемы — строки «НЕТ» и сбои ниже.</p>'
    : '<p class="ok">Сайт работает во всех проверенных браузерах.</p>';
  return htmlPage(
    "Сайт в трёх браузерах",
    STYLE,
    `<h1>Сайт в трёх браузерах</h1>
<p class="muted">pnpm site --check: продакшен-сборка apps/site (next build, next start) на этом компьютере; иконки сайта отдаёт превью API этой ветки. Сначала обход всех страниц по HTTP — коды, заголовки, языки, ссылки, разделы README, — затем каждая страница в Chrome, Firefox и WebKit, движке Safari, и меню темы. Доступность проверяет axe-core по правилам WCAG 2.2 A и AA в светлой и тёмной теме. «—» — не проверялось или только сведения.</p>
${verdict}
${failures ? `<ul>${failures}</ul>` : ""}
<table><thead><tr><th>Проверка</th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
${shots}`,
  );
}
