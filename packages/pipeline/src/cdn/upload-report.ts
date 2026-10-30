// Отчёт выгрузки и сверки хостов (ADR-0022, ADR-0025): строки и таблицы для терминала и страница
// .cache/reports/cdn/upload.html (или verify.html) — по разделу на хост: сводка, манифест «в
// хранилище → локальный», причины «СТОП», ссылки на выложенные файлы для проверки глазами; у хоста с
// каталогом наборов — ещё его строка. Это журнал прогона со временем, а не детерминированная страница
// сборки.

import { formatMs } from "../embed/report.js";
import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import { formatBytes } from "../sources/report.js";
import { catalogIndexKey } from "./catalog.js";
import {
  CHECKSUMS_SUFFIX,
  MANIFEST_FILE,
  OUT_DIR,
  VERSIONS_DIR,
} from "./config.js";
import { CDN_STYLE } from "./report.js";
import {
  CATALOG_LABEL,
  type HostUploadReport,
  type ManifestStatus,
  type SetUploadReport,
  type UploadReport,
  type UploadStatus,
  verifyFailed,
} from "./upload.js";

export const UPLOAD_STATUS: Record<UploadStatus, string> = {
  uploaded: "выгружено",
  unchanged: "без изменений",
  planned: "будет выгружено",
  stopped: "СТОП",
};

export const MANIFEST_STATUS: Record<ManifestStatus, string> = {
  written: "записан",
  unchanged: "без изменений",
  planned: "будет записан",
  skipped: "не записан",
};

const manifestUrl = (host: string) => `https://${host}/${MANIFEST_FILE}`;

const checklist = (hosts: readonly HostUploadReport[]) => [
  `В браузере открываются ${hosts.map((h) => manifestUrl(h.host)).join(" и ")}, и версии в них те же, что в ${OUT_DIR}/${MANIFEST_FILE} (у манифеста кэш 5 минут: сразу после записи можно увидеть прежний).`,
  "Ссылки на файлы иконок ниже открываются на каждом хосте: .json — текст IconifyJSON, .svg — рисунок иконки.",
  "В DevTools (F12 → Network) у файла иконки заголовки content-type: image/svg+xml и cache-control: public, max-age=31536000, immutable; у манифеста — max-age=300. CORS, защиту, сжатие и кэш на CDN обоих хостов проверяет pnpm cdn check (ADR-0023, ADR-0025).",
  "Повторный pnpm cdn upload пишет «без изменений» у каждого набора и у манифеста на обоих хостах; pnpm cdn verify — «совпадают».",
];

/** Заголовок раздела хоста. */
export function formatHostTitle(h: HostUploadReport): string {
  return `Хост https://${h.host} — ${h.storage}`;
}

/** Строки хоста: наборы и каталог, если хост его хранит. */
export const hostRows = (h: HostUploadReport): SetUploadReport[] =>
  h.catalog === undefined ? h.sets : [...h.sets, h.catalog];

/** Строки одного набора или каталога для терминала. */
export function formatUploadReport(r: SetUploadReport): string {
  const lines = [r.id];
  if (r.files > 0) {
    const what = r.id === CATALOG_LABEL ? "Оглавление" : "Версия";
    lines.push(
      `  ${what} ${r.version} · файлов ${r.files} (${formatBytes(r.bytes)}) · в хранилище было ${r.present} · недоставало ${r.missing}`,
    );
  }
  if (r.status === "uploaded") {
    lines.push(
      `  выгружено ${r.uploaded} (${formatBytes(r.uploadedBytes)}) за ${formatMs(r.ms)}, сверка сошлась`,
    );
  }
  if (r.status === "planned")
    lines.push(`  будет выгружено ${r.missing} файлов`);
  if (r.status === "unchanged") {
    lines.push("  без изменений: все файлы версии уже в хранилище");
  }
  for (const s of r.stop) lines.push(`  СТОП — ${s}`);
  return lines.join("\n");
}

/** Итоговая таблица наборов хоста для терминала. */
export function formatUploadTable(sets: readonly SetUploadReport[]): string {
  const head = [
    "Набор",
    "Версия",
    "Файлов",
    "Было",
    "Выгружено",
    "Размер",
    "Время",
    "Итог",
  ];
  const rows = sets.map((r) => [
    r.id,
    r.version === "" ? "—" : r.version,
    String(r.files),
    String(r.present),
    r.status === "planned" ? `(${r.missing})` : String(r.uploaded),
    formatBytes(r.status === "planned" ? r.bytes : r.uploadedBytes),
    formatMs(r.ms),
    UPLOAD_STATUS[r.status],
  ]);
  return textTable(head, rows, 2);
}

/** Строка о манифесте хоста. */
function manifestLine(h: HostUploadReport): string {
  if (h.manifestStatus === "skipped") {
    return `Манифест ${manifestUrl(h.host)} — не записан${h.manifestNote === undefined ? "" : `: ${h.manifestNote}`}`;
  }
  const first =
    h.remoteManifest === undefined
      ? " (в хранилище манифеста ещё не было)"
      : "";
  return `Манифест ${manifestUrl(h.host)} — ${MANIFEST_STATUS[h.manifestStatus]}${first}`;
}

/** Итоговые строки: показ, манифесты хостов, остановки, время. */
export function formatUploadSummary(r: UploadReport): string[] {
  const lines: string[] = [];
  if (r.dryRun) lines.push("Только показ: в хранилища ничего не записано.");
  if (r.hosts.length === 0 && r.stop.length > 0) {
    lines.push("Манифесты: не записаны — прогон остановлен");
  }
  for (const h of r.hosts) {
    lines.push(manifestLine(h));
    for (const s of h.stop) lines.push(`СТОП — ${h.host}: ${s}`);
  }
  for (const s of r.stop) lines.push(`СТОП — ${s}`);
  lines.push(`Время: ${formatMs(r.ms)}`);
  return lines;
}

/** Итог сверки хостов со сборкой: совпадают или что разошлось. */
export function formatVerifyVerdict(r: UploadReport): string[] {
  const hosts = r.hosts.map((h) => h.host).join(" и ");
  if (!verifyFailed(r)) {
    return [
      `Сверка: ${hosts} совпадают со сборкой — файлы версий и манифесты на месте.`,
    ];
  }
  const details: string[] = [];
  for (const h of r.hosts) {
    const parts: string[] = [];
    const planned = hostRows(h).filter((s) => s.status === "planned");
    if (planned.length > 0) {
      const missing = planned.reduce((n, s) => n + s.missing, 0);
      parts.push(
        `недостаёт файлов ${missing} (${planned.map((s) => s.id).join(", ")})`,
      );
    }
    if (h.manifestStatus === "planned") parts.push("манифест отличается");
    const stopped =
      h.stop.length + hostRows(h).filter((s) => s.stop.length > 0).length;
    if (stopped > 0) parts.push("СТОП");
    if (parts.length > 0) details.push(`${h.host}: ${parts.join(", ")}`);
  }
  if (r.stop.length > 0) details.push("СТОП прогона");
  return [
    `Сверка: расхождения — ${details.join("; ")}.`,
    "Недостающее докачает «Выкладка» (pnpm cdn upload); «СТОП» — разберитесь по строкам выше. Если в это время шла «Выкладка», повторите сверку после неё.",
  ];
}

const statusClass = (status: UploadStatus) =>
  status === "stopped" ? "stop" : "ok";

function setSection(h: HostUploadReport, r: SetUploadReport): string {
  const catalog = r.id === CATALOG_LABEL;
  const parts = [`<h3>${esc(r.id)}</h3>`];
  for (const s of r.stop) parts.push(`<p class="stop">СТОП — ${esc(s)}</p>`);
  if (r.files === 0) return parts.join("\n");
  parts.push(
    `<p>${catalog ? "Оглавление" : "Версия"} <code>${esc(r.version)}</code> · файлов ${r.files} (${esc(formatBytes(r.bytes))}) · в хранилище было ${r.present} · недоставало ${r.missing} · выгружено ${r.uploaded} (${esc(formatBytes(r.uploadedBytes))}) · ${esc(formatMs(r.ms))} · <span class="${statusClass(r.status)}">${esc(UPLOAD_STATUS[r.status])}</span></p>`,
  );
  if (r.status === "stopped" || r.status === "planned") return parts.join("\n");
  const paths = catalog
    ? [catalogIndexKey(r.version)]
    : [...r.samples, `${r.id}${CHECKSUMS_SUFFIX}`].map(
        (path) => `${VERSIONS_DIR}/${r.version}/${path}`,
      );
  const links = paths.map((path) => {
    const url = `https://${h.host}/${path}`;
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></li>`;
  });
  parts.push(`<p>Проверить глазами:</p><ul>${links.join("")}</ul>`);
  return parts.join("\n");
}

function hostSection(h: HostUploadReport): string {
  const rows = hostRows(h)
    .map(
      (s) =>
        `<tr><td>${esc(s.id)}</td><td><code>${esc(s.version === "" ? "—" : s.version)}</code></td><td class="num">${s.files}</td><td class="num">${s.present}</td><td class="num">${s.status === "planned" ? `(${s.missing})` : s.uploaded}</td><td class="num">${esc(formatBytes(s.status === "planned" ? s.bytes : s.uploadedBytes))}</td><td class="num">${esc(formatMs(s.ms))}</td><td class="${statusClass(s.status)}">${esc(UPLOAD_STATUS[s.status])}</td></tr>`,
    )
    .join("");
  const parts = [`<h2>${esc(formatHostTitle(h))}</h2>`];
  for (const s of h.stop) parts.push(`<p class="stop">СТОП — ${esc(s)}</p>`);
  if (hostRows(h).length > 0) {
    parts.push(
      `<table><tr><th>Набор</th><th>Версия</th><th class="num">Файлов</th><th class="num">Было</th><th class="num">Выгружено</th><th class="num">Размер</th><th class="num">Время</th><th>Итог</th></tr>${rows}</table>`,
    );
  }
  const url = manifestUrl(h.host);
  parts.push(
    `<p>Манифест <a href="${url}" target="_blank" rel="noopener">${url}</a> — <span class="${h.manifestStatus === "skipped" ? "stop" : "ok"}">${esc(MANIFEST_STATUS[h.manifestStatus])}</span>${h.manifestNote === undefined ? "" : `: ${esc(h.manifestNote)}`}.</p>`,
  );
  if (h.manifestStatus !== "skipped") {
    parts.push(
      h.remoteManifest === undefined
        ? "<p>В хранилище манифеста ещё не было.</p>"
        : `<p>В хранилище:</p><pre>${esc(h.remoteManifest)}</pre>`,
    );
  }
  parts.push(...hostRows(h).map((s) => setSection(h, s)));
  return parts.join("\n");
}

/** Страница .cache/reports/cdn/upload.html или verify.html. */
export function renderUploadPage(r: UploadReport, title = "Выгрузка"): string {
  const shown = r.dryRun
    ? " Только показ: в хранилища ничего не записано, только сравнение."
    : "";
  const intro = `<h1>${esc(title)}: ${OUT_DIR}/ → ${esc(r.hosts.map((h) => h.host).join(", ") || "хосты")}</h1>
<p class="muted">Фаза 2, шаги 2 и 4 — ADR-0022, ADR-0023, ADR-0025.${shown}</p>
<p>Выгружаются только недостающие файлы версий: версии неизменяемы, в <code>${VERSIONS_DIR}/</code> ничего не перезаписывается, а расхождение с хранилищем — «СТОП». Хосты идут по очереди; в каждом наборе файл сумм уходит последним, затем сверка по списку объектов: размер и SHA-256 (Bunny) или ETag = MD5 (R2). Манифесты — в самом конце, когда файлы версий есть на всех хостах, второй хост — последним, и только где манифест отличается. Ничего не удаляется. Каталог наборов для edge API (шаг 2 фазы 4) — только в R2: после файлов версий и перед манифестами, оглавление последним; имя файла — отпечаток содержимого.</p>
<h2>Что проверить</h2>
<ul>${checklist(r.hosts)
    .map((c) => `<li>${esc(c)}</li>`)
    .join("")}</ul>`;
  const summary = `<h2>Сводка</h2>
${formatUploadSummary(r)
  .map(
    (line) =>
      `<p${line.startsWith("СТОП") ? ' class="stop"' : ""}>${esc(line)}</p>`,
  )
  .join("\n")}`;
  const local =
    r.manifest === undefined
      ? ""
      : `<h2>Локальный манифест</h2><pre>${esc(r.manifest)}</pre>`;
  return htmlPage(
    title,
    CDN_STYLE,
    [intro, summary, ...r.hosts.map(hostSection), local].join("\n"),
  );
}
