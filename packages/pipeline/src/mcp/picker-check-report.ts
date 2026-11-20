// Отчёт проверки сетки выбора в браузерах (шаг 11 фазы 4, ADR-0045): таблица «проверка × браузер» для
// терминала, ниже — что не так; страница .cache/reports/mcp/picker.html с той же таблицей, пояснениями и
// снимками каждого браузера и сводка picker.md для страницы запуска CI. «—» — не проверялось.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "../sandbox/browser.js";
import type { Verdict } from "../sandbox/verdict.js";
import {
  PICKER_ROW_TITLES,
  PICKER_ROWS,
  type PickerCheckResult,
  type PickerRowId,
  pickerCheckFailed,
} from "./picker-check.js";

const mark = (v: Verdict) => (v.ok === null ? "—" : v.ok ? "да" : "НЕТ");

const head = (results: PickerCheckResult[]) => [
  "Проверка",
  ...results.map((r) => BROWSER_TITLES[r.browser]),
];

const rows = (results: PickerCheckResult[]) =>
  PICKER_ROWS.map((id) => [
    PICKER_ROW_TITLES[id],
    ...results.map((r) => (r.error ? "сбой" : mark(r.rows[id]))),
  ]);

const problems = (results: PickerCheckResult[]) =>
  results.flatMap((r) => [
    ...(r.error ? [`${BROWSER_TITLES[r.browser]}: ${r.error}`] : []),
    ...PICKER_ROWS.filter((id) => r.rows[id].ok === false).map(
      (id) =>
        `${BROWSER_TITLES[r.browser]} — ${PICKER_ROW_TITLES[id]}: ${r.rows[id].note}`,
    ),
  ]);

const summary = (results: PickerCheckResult[]) =>
  pickerCheckFailed(results)
    ? "Итог: есть проблемы."
    : "Итог: сетка выбора работает во всех проверенных браузерах.";

export function formatPickerCheck(results: PickerCheckResult[]): string[] {
  const lines = [textTable(head(results), rows(results))];
  const list = problems(results);
  if (list.length > 0) lines.push("", "Не так:", ...list.map((p) => `  ${p}`));
  lines.push("", summary(results));
  return lines;
}

/** Сводка для страницы запуска CI. */
export function markdownPickerCheck(results: PickerCheckResult[]): string {
  const list = problems(results);
  return [
    "### Сетка выбора в чате (pnpm mcp picker --check)",
    "",
    markdownTable(head(results), rows(results)),
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

function cell(r: PickerCheckResult, id: PickerRowId): string {
  if (r.error) return `<td class="stop">сбой</td>`;
  const v = r.rows[id];
  const status = v.ok === true ? "ok" : v.ok === false ? "stop" : "";
  return `<td class="${status}">${mark(v)}<span class="note">${esc(v.note)}</span></td>`;
}

export function renderPickerCheckPage(
  results: PickerCheckResult[],
  subject: string,
): string {
  const list = problems(results);
  const table = `<table><thead><tr>${head(results)
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${PICKER_ROWS.map(
    (id) =>
      `<tr><td>${esc(PICKER_ROW_TITLES[id])}</td>${results.map((r) => cell(r, id)).join("")}</tr>`,
  ).join("")}</tbody></table>`;
  const shots = results
    .map(
      (r) =>
        `<h2>${esc(BROWSER_TITLES[r.browser])}</h2>${
          r.shots.length === 0
            ? `<p class="muted">Снимков нет.</p>`
            : `<div class="shots">${r.shots
                .map(
                  (s) =>
                    `<figure><img alt="${esc(s.title)}" src="data:image/png;base64,${s.png}"><figcaption>${esc(s.title)}</figcaption></figure>`,
                )
                .join("")}</div>`
        }`,
    )
    .join("");
  return htmlPage(
    "Сетка выбора в чате — проверка",
    STYLE,
    `<h1>Сетка выбора в чате — проверка в браузерах</h1>
<p class="muted">${esc(subject)}. Вид MCP Apps в рамке sandbox="allow-scripts" со строгой политикой спецификации, хост — AppBridge SDK, как у клиентов.</p>
${table}
${list.length > 0 ? `<h2>Не так</h2><ul>${list.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<p class="${pickerCheckFailed(results) ? "stop" : "ok"}">${esc(summary(results))}</p>
${shots}`,
  );
}
