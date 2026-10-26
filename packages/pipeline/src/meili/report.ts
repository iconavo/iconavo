// Отчёт робота поискового индекса (ADR-0049): строки для терминала и страница
// .cache/reports/search/index.html — наборы и сверка с раздачей, настройки, документы, векторы иконок и
// фраз, рубли, версия индекса, заметки и «СТОП». Это журнал прогона, а не детерминированная страница.

import { INDEX_UID } from "@iconavo-ui/search";
import { formatRub } from "../embed/cost.js";
import { formatMs } from "../embed/report.js";
import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import type {
  DocumentChange,
  SearchIndexReport,
  SettingsState,
} from "./run.js";

const MODE: Record<SearchIndexReport["mode"], string> = {
  offline: "план без сети",
  "dry-run": "только показ",
  write: "запись",
};

const SETTINGS: Record<SettingsState, string> = {
  same: "без изменений",
  update: "обновить",
  create: "создать индекс",
  unknown: "не сравнивались",
};

const CHANGE: Record<DocumentChange, string> = {
  add: "добавить",
  update: "изменить",
  delete: "удалить",
};

const n = (value: number) => value.toLocaleString("ru-RU");

/** Строки итога для терминала. */
export function formatSearchIndexReport(r: SearchIndexReport): string[] {
  const d = r.documents;
  const lines = [
    `Поисковый индекс «${INDEX_UID}» — ${MODE[r.mode]}, ${formatMs(r.ms)}`,
    `  Карточек ${n(r.cards)}, с описаниями (есть вектор) ${n(r.withText)}`,
    `  Настройки: ${SETTINGS[r.settings]}${r.settingsChanged.length > 0 && r.settings === "update" ? ` (${r.settingsChanged.join(", ")})` : ""}`,
    `  Документы: добавить ${n(d.add)} · изменить ${n(d.update)} · удалить ${n(d.delete)} · без изменений ${n(d.same)}`,
    `  Векторы иконок: в бакете ${n(r.vectors.stored)}, готовых ${n(r.vectors.reused)}, посчитать ${n(r.vectors.missing)}${r.mode === "write" ? `, посчитано ${n(r.vectors.computed)}` : ""}`,
    `  Фразы каталога: ${n(r.phrases.total)}, в бакете ${n(r.phrases.stored)}, посчитать ${n(r.phrases.missing)}${r.mode === "write" ? `, посчитано ${n(r.phrases.computed)}` : ""}`,
    `  Polza: оценка ${formatRub(r.rub.estimate)} · потрачено ${formatRub(r.rub.spent)} · лимит ${formatRub(r.rub.limit)}`,
    `  Версия индекса: ${r.version.before ?? "—"} → ${r.version.after || "—"}${r.version.written ? " (записана)" : r.version.before === r.version.after ? " (без изменений)" : ""}`,
  ];
  for (const note of r.notes) lines.push(`  ${note}`);
  for (const stop of r.stop) lines.push(`  СТОП — ${stop}`);
  return lines;
}

/** Наборы: версия в data/ и на раздаче, карточек. */
export function formatSetsTable(r: SearchIndexReport): string {
  return textTable(
    ["Набор", "Версия", "Раздача", "Карточек"],
    r.sets.map((s) => [
      s.id,
      s.version,
      s.live === undefined ? "—" : s.live === s.version ? "та же" : s.live,
      n(s.cards),
    ]),
    3,
  );
}

const STYLE = `
.tiles { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.tile { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 150px; }
.tile b { display: block; font-size: 22px; }
`;

const tile = (label: string, value: string) =>
  `<div class="tile"><b>${esc(value)}</b>${esc(label)}</div>`;

/** Страница отчёта. */
export function renderSearchIndexPage(r: SearchIndexReport): string {
  const d = r.documents;
  const stops =
    r.stop.length > 0
      ? `<h2 class="stop">СТОП</h2><ul>${r.stop.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
      : `<p class="ok">Без остановок.</p>`;
  const notes =
    r.notes.length > 0
      ? `<ul>${r.notes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
      : "";
  const sets = r.sets
    .map(
      (s) =>
        `<tr><td>${esc(s.id)}</td><td>${esc(s.version)}</td><td>${esc(s.live === undefined ? "—" : s.live === s.version ? "та же" : s.live)}</td><td class="num">${n(s.cards)}</td></tr>`,
    )
    .join("");
  const samples = d.samples
    .map(
      (c) => `<tr><td>${esc(c.id)}</td><td>${esc(CHANGE[c.change])}</td></tr>`,
    )
    .join("");
  const body = `<h1>Поисковый индекс «${esc(INDEX_UID)}»</h1>
<p class="muted">${esc(MODE[r.mode])} · ${esc(formatMs(r.ms))} · ADR-0049</p>
${stops}
${notes}
<div class="tiles">
${tile("карточек", n(r.cards))}
${tile("с вектором", n(r.withText))}
${tile("документов изменится", n(d.add + d.update + d.delete))}
${tile("фраз каталога", n(r.phrases.total))}
${tile("потрачено Polza", formatRub(r.rub.spent))}
${tile("версия индекса", r.version.after || "—")}
</div>
<h2>Наборы и раздача</h2>
<p class="muted">Индекс не обгоняет раздачу: версии наборов в data/ должны совпадать с манифестом cdn.iconavo.dev.</p>
<table><tr><th>Набор</th><th>Версия в data/</th><th>На раздаче</th><th class="num">Карточек</th></tr>${sets}</table>
<h2>Индекс</h2>
<ul>
<li>Настройки: ${esc(SETTINGS[r.settings])}${r.settingsChanged.length > 0 && r.settings === "update" ? ` — ${esc(r.settingsChanged.join(", "))}` : ""}</li>
<li>Документы: добавить ${n(d.add)}, изменить ${n(d.update)}, удалить ${n(d.delete)}, без изменений ${n(d.same)}</li>
<li>Версия индекса: ${esc(r.version.before ?? "—")} → ${esc(r.version.after || "—")}${r.version.written ? " (записана в бакет)" : ""}</li>
</ul>
${samples === "" ? "" : `<h3>Изменения <span class="muted">первые ${d.samples.length}</span></h3><table><tr><th>Документ</th><th>Что</th></tr>${samples}</table>`}
<h2>Векторы</h2>
<ul>
<li>Иконки: в бакете ${n(r.vectors.stored)}, готовых ${n(r.vectors.reused)}, посчитать ${n(r.vectors.missing)}, посчитано ${n(r.vectors.computed)}${r.vectors.brokenSets.length > 0 ? `; заново: ${esc(r.vectors.brokenSets.join(", "))}` : ""}</li>
<li>Фразы каталога: ${n(r.phrases.total)}, в бакете ${n(r.phrases.stored)}, посчитать ${n(r.phrases.missing)}, посчитано ${n(r.phrases.computed)}</li>
<li>Polza: оценка ${esc(formatRub(r.rub.estimate))}, потрачено ${esc(formatRub(r.rub.spent))}, лимит ${esc(formatRub(r.rub.limit))}</li>
</ul>`;
  return htmlPage("Поисковый индекс", STYLE, body);
}
