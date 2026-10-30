// Отчёт сборки раздачи (ADR-0022): строки и таблица для терминала и страница
// .cache/reports/cdn/index.html — дерево папок, примеры файлов, манифест, контрольные суммы.
// Без скриптов и без времени: одинаковая сборка — одинаковая страница.

import { esc, htmlPage, svgDataUri } from "../report/html.js";
import { textTable } from "../report/table.js";
import { formatBytes } from "../sources/report.js";
import {
  CDN_HOST,
  CHECKSUMS_SUFFIX,
  MANIFEST_FILE,
  OUT_DIR,
  VERSIONS_DIR,
} from "./config.js";
import type { CdnExample, CdnReport, CdnStatus, SetCdnReport } from "./run.js";

const STATUS: Record<CdnStatus, string> = {
  written: "записано",
  unchanged: "без изменений",
  stopped: "СТОП",
};

const CHECKLIST = [
  "В дереве набора любая иконка находится по пути v/{версия}/{набор}/{имя}.json, рядом с ней — .svg; алиас (например, lucide/home) — такой же файл с полем aliases.",
  "В манифесте все пять наборов, версии совпадают с полем version в data/{набор}/info.json.",
  "Повторный запуск pnpm cdn build пишет «без изменений» у каждого набора и не трогает манифест.",
  "Пример SVG выглядит как иконка, а не как пустой квадрат; в файле нет ничего, кроме svg, viewBox и фигур.",
];

export const CDN_STYLE = `
.tile { display: inline-block; background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 6px; vertical-align: middle; margin: 4px 0; }
.file { margin: 12px 0 20px; }
.file h4 { margin: 0 0 4px; font-size: 14px; overflow-wrap: anywhere; }
.url { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; margin: 2px 0 6px; }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

const setPath = (r: SetCdnReport) =>
  `${OUT_DIR}/${VERSIONS_DIR}/${r.version}/${r.id}/`;

/** Строки одного набора для терминала. */
export function formatCdnReport(r: SetCdnReport): string {
  const lines = [`${r.id} — ${r.name}`];
  if (r.version !== undefined) {
    const hidden = r.hidden > 0 ? ` (скрытых ${r.hidden})` : "";
    lines.push(
      `  Версия ${r.version} · иконок ${r.icons}${hidden} · алиасов ${r.aliases} · файлов ${r.files} · ${formatBytes(r.bytes)}`,
    );
  }
  for (const s of r.stop) lines.push(`  СТОП — ${s}`);
  if (r.status === "written") lines.push(`  записано ${setPath(r)}`);
  if (r.status === "unchanged") {
    lines.push(`  без изменений: ${setPath(r)} уже собрана`);
  }
  return lines.join("\n");
}

/** Итоговая таблица для терминала. */
export function formatCdnTable(sets: readonly SetCdnReport[]): string {
  const head = [
    "Набор",
    "Версия",
    "Иконок",
    "Алиасов",
    "Файлов",
    "Размер",
    "Итог",
  ];
  const rows = sets.map((r) => [
    r.id,
    r.version ?? "—",
    String(r.icons),
    String(r.aliases),
    String(r.files),
    r.version === undefined ? "—" : formatBytes(r.bytes),
    STATUS[r.status],
  ]);
  return textTable(head, rows, 2);
}

/** Итоговые строки: манифест, уборка, предупреждения. */
export function formatCdnSummary(r: CdnReport): string[] {
  const stopped = r.sets.filter((s) => s.stop.length > 0).length;
  const lines: string[] = [];
  if (stopped > 0) {
    lines.push(
      `Манифест: не записан — остановлено наборов: ${stopped}; уборка устаревших версий не выполнялась`,
    );
  } else {
    if (r.catalog !== undefined) {
      lines.push(
        `Каталог для edge API: ${OUT_DIR}/${r.catalog.index} и ещё ${r.catalog.files - 1} файлов (${formatBytes(r.catalog.bytes)}) — ${r.catalog.written.length > 0 ? `записано ${r.catalog.written.length}` : "без изменений"}`,
      );
    }
    lines.push(
      `Манифест: ${OUT_DIR}/${MANIFEST_FILE} — ${r.manifestWritten ? "записан" : "без изменений"}`,
    );
    lines.push(
      r.removed.length > 0
        ? `Удалено устаревших: ${r.removed.join(", ")}`
        : "Удалено устаревших: нет",
    );
  }
  for (const w of r.warnings) lines.push(`Предупреждение: ${w}`);
  return lines;
}

function treeText(r: SetCdnReport): string {
  const lines = [
    `${OUT_DIR}/`,
    `  ${MANIFEST_FILE}`,
    `  ${VERSIONS_DIR}/`,
    `    ${r.version}/`,
    `      ${r.id}${CHECKSUMS_SUFFIX}`,
    `      ${r.id}/`,
  ];
  for (const path of r.tree) {
    lines.push(`        ${path.slice(path.lastIndexOf("/") + 1)}`);
  }
  if (r.files > r.tree.length) {
    lines.push(`        … и ещё ${r.files - r.tree.length} файлов`);
  }
  return lines.join("\n");
}

function fileBlock(title: string, ex: CdnExample, preview?: string): string {
  const img = preview
    ? `<img class="tile" src="${svgDataUri(preview)}" width="64" height="64" alt="">`
    : "";
  return `<div class="file"><h4>${esc(title)}: <code>${esc(ex.path)}</code> · ${esc(formatBytes(ex.bytes))}</h4>
<p class="url">https://${CDN_HOST}/${esc(ex.path)}</p>
${img}<pre>${esc(ex.text)}</pre></div>`;
}

function setSection(r: SetCdnReport): string {
  const parts = [`<h2>${esc(r.id)} — ${esc(r.name)}</h2>`];
  for (const s of r.stop) parts.push(`<p class="stop">СТОП — ${esc(s)}</p>`);
  if (r.version === undefined) return parts.join("\n");
  const hidden = r.hidden > 0 ? `, скрытых ${r.hidden}` : "";
  parts.push(
    `<p>Версия <code>${esc(r.version)}</code> · иконок ${r.icons}${hidden} · алиасов ${r.aliases} · файлов ${r.files} · ${esc(formatBytes(r.bytes))} · <span class="${r.status === "stopped" ? "stop" : "ok"}">${esc(STATUS[r.status])}</span></p>`,
  );
  parts.push(`<h3>Дерево папок</h3><pre>${esc(treeText(r))}</pre>`);
  const examples: string[] = [];
  if (r.examples.icon) {
    examples.push(fileBlock("Иконка", r.examples.icon.json));
    examples.push(
      fileBlock("Её SVG", r.examples.icon.svg, r.examples.icon.svg.text),
    );
  }
  if (r.examples.alias) examples.push(fileBlock("Алиас", r.examples.alias));
  if (examples.length > 0) {
    parts.push(`<h3>Примеры файлов</h3>${examples.join("\n")}`);
  }
  const rows = r.checksums
    .map(
      ([path, hash]) =>
        `<tr><td><code>${esc(path)}</code></td><td><code>${esc(hash)}</code></td></tr>`,
    )
    .join("");
  parts.push(
    `<h3>Контрольные суммы</h3><p><code>${esc(`${VERSIONS_DIR}/${r.version}/${r.id}${CHECKSUMS_SUFFIX}`)}</code> — SHA-256 каждого файла версии, пути относительно <code>${VERSIONS_DIR}/${esc(r.version)}/</code>.</p>
<table><tr><th>Файл</th><th>SHA-256</th></tr>${rows}</table>
<p class="muted">Показаны первые ${r.checksums.length} из ${r.files} файлов.</p>`,
  );
  return parts.join("\n");
}

/** Страница .cache/reports/cdn/index.html. */
export function renderCdnPage(report: CdnReport): string {
  const intro = `<h1>Раздача: папка ${OUT_DIR}/</h1>
<p class="muted">Фаза 2, шаг 1 — ADR-0004, ADR-0006, ADR-0022.</p>
<p>Из <code>data/</code> собрана папка статики: на каждую иконку и каждый алиас — файл <code>.json</code> в формате IconifyJSON и готовый <code>.svg</code>; рядом с папкой набора — контрольные суммы всех его файлов; в корне — манифест текущих версий. Путь файла превращается в адрес: <code>${OUT_DIR}/${VERSIONS_DIR}/{версия}/{набор}/{имя}.svg</code> → <code>https://${CDN_HOST}/${VERSIONS_DIR}/{версия}/{набор}/{имя}.svg</code>. Содержимое по такому адресу не меняется никогда: новая версия набора — новая папка, а манифест говорит, какая версия сейчас текущая.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
  const rows = report.sets
    .map(
      (r) =>
        `<tr><td>${esc(r.id)}</td><td><code>${esc(r.version ?? "—")}</code></td><td class="num">${r.icons}</td><td class="num">${r.aliases}</td><td class="num">${r.files}</td><td class="num">${r.version === undefined ? "—" : esc(formatBytes(r.bytes))}</td><td class="${r.status === "stopped" ? "stop" : "ok"}">${esc(STATUS[r.status])}</td></tr>`,
    )
    .join("");
  const summary = `<h2>Сводка</h2>
<table><tr><th>Набор</th><th>Версия</th><th class="num">Иконок</th><th class="num">Алиасов</th><th class="num">Файлов</th><th class="num">Размер</th><th>Итог</th></tr>${rows}</table>
${formatCdnSummary(report)
  .map((line) => `<p>${esc(line)}</p>`)
  .join("\n")}`;
  const manifest =
    report.manifest === undefined
      ? `<h2>Манифест</h2>\n<p class="stop">Не записан: сборка остановлена.</p>`
      : `<h2>Манифест</h2>\n<p><code>${OUT_DIR}/${MANIFEST_FILE}</code> → <code>https://${CDN_HOST}/${MANIFEST_FILE}</code> — ${report.manifestWritten ? "записан" : "без изменений"}.</p>\n<pre>${esc(report.manifest)}</pre>`;
  const catalog =
    report.catalog === undefined
      ? ""
      : `<h2>Каталог для edge API</h2>
<p>Сведения о наборах, категории, скрытые имена, алиасы и выпуски — для адресов <code>/collections</code>, <code>/collection</code> и <code>/changelog</code> edge API (шаг 2 фазы 4). Оглавление <code>${OUT_DIR}/${esc(report.catalog.index)}</code> → <code>https://${CDN_HOST}/${esc(report.catalog.index)}</code>; его отпечаток — поле <code>catalog</code> манифеста. Имя каждого файла — отпечаток содержимого, файлы не перезаписываются. Только на ${CDN_HOST}: их читает только edge API.</p>
<p>Файлов ${report.catalog.files} · ${esc(formatBytes(report.catalog.bytes))} · ${report.catalog.written.length > 0 ? `записано ${report.catalog.written.length}` : "без изменений"}.</p>`;
  const sets = report.sets.map(setSection).join("\n");
  return htmlPage(
    "Раздача",
    CDN_STYLE,
    [intro, summary, manifest, catalog, sets].join("\n"),
  );
}
