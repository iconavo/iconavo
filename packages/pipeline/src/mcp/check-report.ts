// Отчёт проверки MCP-сервера (шаг 10 фазы 4): таблица в терминале, check.md для сводки CI и страница
// .cache/reports/mcp/check.html — по каждому вызову инструмента запрос, текст ответа, картинка и
// данные по схеме. Страницу смотрит владелец: так видно, что получает ассистент.

import { esc, htmlPage } from "../report/html.js";
import {
  type McpCall,
  type McpCheckReport,
  type McpCheckRow,
  mcpCheckFailed,
} from "./check.js";
import { MCP_WORKER_NAME } from "./config.js";

const ok = (problems: string[]) => problems.length === 0;

const callTitle = (c: McpCall) =>
  `${c.tool} ${JSON.stringify(c.args)} — протокол ${c.era}`;

export function formatMcpCheck(r: McpCheckReport): string[] {
  const lines = [`MCP-сервер ${r.base}${r.build ? `, сборка ${r.build}` : ""}`];
  const width = Math.max(...r.rows.map((x) => x.name.length), 10);
  for (const row of r.rows) {
    lines.push(
      `  ${row.name.padEnd(width)}  ${ok(row.problems) ? "да" : `НЕТ — ${row.problems.join("; ")}`}`,
    );
  }
  lines.push("", "Вызовы:");
  for (const c of r.calls) {
    const image = c.images
      .map(
        (i) =>
          `картинка ${i.width}×${i.height}, ${Math.round(i.bytes / 1024)} КБ`,
      )
      .join(", ");
    lines.push(
      `  ${ok(c.problems) ? "да " : "НЕТ"} ${callTitle(c)} — ${c.ms} мс${image === "" ? "" : `, ${image}`}`,
    );
    for (const p of c.problems) lines.push(`      ${p}`);
  }
  lines.push(
    "",
    mcpCheckFailed(r)
      ? `Итог: есть проблемы. Функцию выкладывает workflow «MCP-сервер» (mcp.yml); домен и функция ${MCP_WORKER_NAME} — разовая настройка в панели Cloudflare (ADR-0044).`
      : "Итог: всё в порядке.",
  );
  return lines;
}

export function renderMcpCheckMarkdown(r: McpCheckReport): string {
  const rows = r.rows.map(
    (x: McpCheckRow) =>
      `| ${x.name} | ${ok(x.problems) ? "да" : `нет: ${x.problems.join("; ")}`} |`,
  );
  const calls = r.calls.map(
    (c) =>
      `| ${callTitle(c).replace(/\|/g, "\\|")} | ${c.ms} мс | ${ok(c.problems) ? "да" : `нет: ${c.problems.join("; ").replace(/\|/g, "\\|")}`} |`,
  );
  return [
    `### MCP-сервер ${r.base}${r.build ? ` — сборка ${r.build}` : ""}`,
    "",
    "| Проверка | Итог |",
    "| --- | --- |",
    ...rows,
    "",
    "| Вызов | Время | Итог |",
    "| --- | --- | --- |",
    ...calls,
    "",
    mcpCheckFailed(r) ? "**Есть проблемы.**" : "Всё в порядке.",
    "",
  ].join("\n");
}

const STYLE = `
.call { border: 1px solid var(--line); border-radius: 12px; padding: 4px 16px 16px; margin: 20px 0; }
.call img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
details summary { cursor: pointer; color: var(--muted); margin: 8px 0; }
`;

function callSection(c: McpCall): string {
  const verdict = ok(c.problems)
    ? '<span class="ok">да</span>'
    : `<span class="stop">нет</span><ul>${c.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
  const images = c.images
    .map(
      (i) =>
        `<p><img src="data:image/png;base64,${i.base64}" width="${i.width}" height="${i.height}" alt="Картинка-сетка ответа ${esc(callTitle(c))}"><span class="muted">${i.width}×${i.height} px, ${Math.round(i.bytes / 1024)} КБ</span></p>`,
    )
    .join("");
  return `<section class="call">
<h3>${esc(c.tool)} <span class="muted">протокол ${esc(c.era)} · ${c.ms} мс</span></h3>
<p>Итог: ${verdict}</p>
<h4>Что спросил ассистент</h4>
<pre>${esc(JSON.stringify(c.args, null, 2))}</pre>
${images === "" ? "" : `<h4>Картинка в ответе</h4>${images}`}
<h4>Текст ответа</h4>
<pre>${esc(c.text)}</pre>
<details><summary>Данные по схеме (structuredContent)</summary><pre>${esc(JSON.stringify(c.structured ?? null, null, 2))}</pre></details>
</section>`;
}

export function renderMcpCheckPage(r: McpCheckReport): string {
  const rows = r.rows
    .map(
      (x) =>
        `<tr><td>${esc(x.name)}</td><td>${ok(x.problems) ? '<span class="ok">да</span>' : `<span class="stop">нет</span> ${esc(x.problems.join("; "))}`}</td></tr>`,
    )
    .join("");
  const body = `<h1>Проверка MCP-сервера</h1>
<p class="muted">${esc(r.base)}${r.build ? ` · сборка ${esc(r.build)}` : ""} · клиент — официальный SDK MCP, протоколы 2025 года и 2026-07-28</p>
<p>Итог: ${mcpCheckFailed(r) ? '<span class="stop">есть проблемы</span>' : '<span class="ok">всё в порядке</span>'}</p>
<h2>Проверки</h2>
<table><thead><tr><th>Что</th><th>Итог</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Вызовы инструментов</h2>
<p class="muted">Так ответ видит ассистент: текст, картинка и данные по схеме.</p>
${r.calls.map(callSection).join("\n")}`;
  return htmlPage("Проверка MCP-сервера", STYLE, body);
}
