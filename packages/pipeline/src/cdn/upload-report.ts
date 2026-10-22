// Отчёт выгрузки (ADR-0022): строки и таблица для терминала и страница .cache/reports/cdn/upload.html —
// сводка, манифест «в бакете → локальный», причины «СТОП», ссылки на выложенные файлы для проверки
// глазами. Это журнал прогона со временем, а не детерминированная страница сборки.

import { formatMs } from "../embed/report.js";
import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import { formatBytes } from "../sources/report.js";
import {
  CDN_HOST,
  CHECKSUMS_SUFFIX,
  MANIFEST_FILE,
  OUT_DIR,
  R2_BUCKET,
  VERSIONS_DIR,
} from "./config.js";
import { CDN_STYLE } from "./report.js";
import type {
  ManifestStatus,
  SetUploadReport,
  UploadReport,
  UploadStatus,
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

const CHECKLIST = [
  `В браузере открывается https://${CDN_HOST}/${MANIFEST_FILE}, и версии в нём те же, что в ${OUT_DIR}/${MANIFEST_FILE} (у манифеста кэш 5 минут: сразу после записи можно увидеть прежний).`,
  "Ссылки на файлы иконок ниже открываются: .json — текст IconifyJSON, .svg — рисунок иконки.",
  "В DevTools (F12 → Network) у файла иконки заголовки content-type: image/svg+xml и cache-control: public, max-age=31536000, immutable; у манифеста — max-age=300. CORS, сжатие и кэш JSON на CDN — шаг 3.",
  "Повторный pnpm cdn upload пишет «без изменений» у каждого набора и у манифеста.",
];

const manifestUrl = `https://${CDN_HOST}/${MANIFEST_FILE}`;

/** Строки одного набора для терминала. */
export function formatUploadReport(r: SetUploadReport): string {
  const lines = [r.id];
  if (r.files > 0) {
    lines.push(
      `  Версия ${r.version} · файлов ${r.files} (${formatBytes(r.bytes)}) · в бакете было ${r.present} · недоставало ${r.missing}`,
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
    lines.push("  без изменений: все файлы версии уже в бакете");
  }
  for (const s of r.stop) lines.push(`  СТОП — ${s}`);
  return lines.join("\n");
}

/** Итоговая таблица для терминала. */
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

/** Итоговые строки: показ, манифест, остановки, время. */
export function formatUploadSummary(r: UploadReport): string[] {
  const lines: string[] = [];
  if (r.dryRun)
    lines.push("Только показ (--dry-run): в бакет ничего не записано.");
  const stopped = r.sets.filter((s) => s.stop.length > 0).length;
  if (r.manifestStatus === "skipped") {
    lines.push(
      `Манифест: не записан — ${stopped > 0 ? `остановлено наборов: ${stopped}` : "прогон остановлен"}`,
    );
  } else {
    const first =
      r.remoteManifest === undefined ? " (в бакете манифеста ещё не было)" : "";
    lines.push(
      `Манифест: ${manifestUrl} — ${MANIFEST_STATUS[r.manifestStatus]}${first}`,
    );
  }
  for (const s of r.stop) lines.push(`СТОП — ${s}`);
  lines.push(`Время: ${formatMs(r.ms)}`);
  return lines;
}

const statusClass = (status: UploadStatus) =>
  status === "stopped" ? "stop" : "ok";

function setSection(r: SetUploadReport): string {
  const parts = [`<h2>${esc(r.id)}</h2>`];
  for (const s of r.stop) parts.push(`<p class="stop">СТОП — ${esc(s)}</p>`);
  if (r.files === 0) return parts.join("\n");
  parts.push(
    `<p>Версия <code>${esc(r.version)}</code> · файлов ${r.files} (${esc(formatBytes(r.bytes))}) · в бакете было ${r.present} · недоставало ${r.missing} · выгружено ${r.uploaded} (${esc(formatBytes(r.uploadedBytes))}) · ${esc(formatMs(r.ms))} · <span class="${statusClass(r.status)}">${esc(UPLOAD_STATUS[r.status])}</span></p>`,
  );
  if (r.status === "stopped" || r.status === "planned") return parts.join("\n");
  const links = [...r.samples, `${r.id}${CHECKSUMS_SUFFIX}`].map((path) => {
    const url = `https://${CDN_HOST}/${VERSIONS_DIR}/${r.version}/${path}`;
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></li>`;
  });
  parts.push(`<h3>Проверить глазами</h3><ul>${links.join("")}</ul>`);
  return parts.join("\n");
}

/** Страница .cache/reports/cdn/upload.html. */
export function renderUploadPage(r: UploadReport): string {
  const intro = `<h1>Выгрузка: ${OUT_DIR}/ → бакет ${esc(R2_BUCKET)}</h1>
<p class="muted">Фаза 2, шаг 2 — ADR-0022, ADR-0023.${r.dryRun ? " Только показ (--dry-run): в бакет ничего не записано." : ""}</p>
<p>Выгружаются только недостающие файлы версий: версии неизменяемы, в <code>${VERSIONS_DIR}/</code> ничего не перезаписывается, а расхождение с бакетом — «СТОП». В каждом наборе файл сумм уходит последним, манифест — в самом конце и только если отличается от того, что в бакете. Ничего не удаляется. Сверка — по списку объектов: размер и ETag (MD5) каждого файла версии.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
  const rows = r.sets
    .map(
      (s) =>
        `<tr><td>${esc(s.id)}</td><td><code>${esc(s.version === "" ? "—" : s.version)}</code></td><td class="num">${s.files}</td><td class="num">${s.present}</td><td class="num">${s.status === "planned" ? `(${s.missing})` : s.uploaded}</td><td class="num">${esc(formatBytes(s.status === "planned" ? s.bytes : s.uploadedBytes))}</td><td class="num">${esc(formatMs(s.ms))}</td><td class="${statusClass(s.status)}">${esc(UPLOAD_STATUS[s.status])}</td></tr>`,
    )
    .join("");
  const summary = `<h2>Сводка</h2>
<table><tr><th>Набор</th><th>Версия</th><th class="num">Файлов</th><th class="num">Было</th><th class="num">Выгружено</th><th class="num">Размер</th><th class="num">Время</th><th>Итог</th></tr>${rows}</table>
${formatUploadSummary(r)
  .map(
    (line) =>
      `<p${line.startsWith("СТОП") ? ' class="stop"' : ""}>${esc(line)}</p>`,
  )
  .join("\n")}`;
  const manifest = [`<h2>Манифест</h2>`];
  manifest.push(
    `<p><a href="${manifestUrl}" target="_blank" rel="noopener">${manifestUrl}</a> — <span class="${r.manifestStatus === "skipped" ? "stop" : "ok"}">${esc(MANIFEST_STATUS[r.manifestStatus])}</span>.</p>`,
  );
  if (r.manifestStatus !== "skipped") {
    manifest.push(
      r.remoteManifest === undefined
        ? "<h3>В бакете</h3><p>Манифеста ещё не было.</p>"
        : `<h3>В бакете</h3><pre>${esc(r.remoteManifest)}</pre>`,
    );
  }
  if (r.manifest !== undefined) {
    manifest.push(`<h3>Локальный</h3><pre>${esc(r.manifest)}</pre>`);
  }
  const sets = r.sets.map(setSection).join("\n");
  return htmlPage(
    "Выгрузка",
    CDN_STYLE,
    [intro, summary, manifest.join("\n"), sets].join("\n"),
  );
}
