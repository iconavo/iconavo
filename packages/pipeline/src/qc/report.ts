// Отчёт контроля качества (ADR-0016): раздел «Контроль качества» в index.html галереи сборки,
// страница qc.html с карточками подозрительных иконок и строки для терминала. Без скриптов, как
// вся галерея: картинки — PNG и SVG в адресах data:.

import type { SetBuildReport } from "../build/run.js";
import { cardLink } from "../normalize/gallery.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import {
  CHANGED_NAMES_LIMIT,
  CHANGED_PIXELS,
  CROP_LIMIT,
  EMPTY_LIMIT,
  RENDER_SIZE,
  REPORT_LIMIT,
  SPARSE_LIMIT,
} from "./config.js";
import { canvasRect, paddedSvg } from "./render.js";
import {
  QC_KINDS,
  type QcFinding,
  type QcImage,
  type QcKind,
  type SetQcReport,
  share,
} from "./run.js";

/** Картинки в отчёте крупнее в 2 раза: 64 px → 128 px, пиксели без размытия. */
const ZOOM = 2;

const TITLES: Record<QcKind, string> = {
  failed: "Не нарисовались",
  empty: "Пустые",
  sparse: "Почти пустые",
  cropped: "Обрезанные",
  changed: "Изменились с прошлой версии",
  original: "Отличаются от оригинала",
};

const HINTS: Record<QcKind, string> = {
  failed:
    "resvg не смог нарисовать иконку — проверить её нельзя. Набор остановлен.",
  empty: `Закрашено меньше ${share(EMPTY_LIMIT)} холста: иконка фактически ничего не рисует. Набор остановлен.`,
  sparse: `Закрашено меньше ${share(SPARSE_LIMIT)} холста. Обычно это мелкие значки вроде точки — проверьте, что рисунок на месте.`,
  cropped: `Рисунок выходит за холст (пунктир) больше чем на ${share(CROP_LIMIT)} размера: в браузере выступающая часть обрежется. Решите: ошибка или так задумано автором.`,
  changed: `Отличается от прошлой версии больше чем на ${share(CHANGED_PIXELS)} пикселей.`,
  original: `Отличается от исходного файла автора больше чем на ${share(CHANGED_PIXELS)} пикселей. В монохромных наборах сравнивается только тёмная краска: цвет там заменяется намеренно, но белая деталь, ставшая цветом текста, — отличие.`,
};

/** Короткие подписи для значков на карточках галереи. */
const BADGES: Record<QcKind, string> = {
  failed: "не нарисовалась",
  empty: "пустая",
  sparse: "почти пустая",
  cropped: "обрезана",
  changed: "изменилась с прошлой версии",
  original: "сверка с оригиналом",
};

export const QC_STYLE = `
.qc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 10px; }
.qc-card { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; content-visibility: auto; contain-intrinsic-size: auto 260px; }
.qc-card h4 { margin: 0 0 2px; font-size: 14px; overflow-wrap: anywhere; }
.qc-card p { margin: 0 0 8px; font-size: 13px; }
.pics { display: flex; flex-wrap: wrap; gap: 8px; }
.pics figure { margin: 0; }
.pics figcaption { font-size: 12px; color: var(--muted); text-align: center; }
.pic { position: relative; display: block; background: #ffffff; border: 1px solid var(--line); }
.pic img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.pic img.vector { image-rendering: auto; }
.pic i { position: absolute; border: 1px dashed #e5484d; box-sizing: border-box; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; }
.names { overflow-wrap: anywhere; font-size: 13px; }
`;

const countOf = (qc: SetQcReport, kind: QcKind) =>
  qc.findings.filter((f) => f.kind === kind).length;

/** Причины для значков на карточке иконки в галерее: находки по её имени. */
export function qcBadges(findings: readonly QcFinding[]): string[] {
  return findings.map((f) => `${BADGES[f.kind]}: ${f.text}`);
}

/** Находки набора по именам — чтобы карточки галереи получили значки. */
export function findingsByName(qc: SetQcReport): Map<string, QcFinding[]> {
  const out = new Map<string, QcFinding[]>();
  for (const f of qc.findings) out.set(f.name, [...(out.get(f.name) ?? []), f]);
  return out;
}

/** Строки контроля для сводки набора в терминале. */
export function formatQc(qc: SetQcReport): string[] {
  const failed = countOf(qc, "failed");
  const lines = [
    `  Контроль: нарисовано ${qc.checked} · пустых ${countOf(qc, "empty")} · почти пустых ${countOf(qc, "sparse")} · обрезанных ${countOf(qc, "cropped")} · отличаются от оригинала ${countOf(qc, "original")}${failed > 0 ? ` · не нарисовались ${failed}` : ""}`,
  ];
  const b = qc.baseline;
  lines.push(
    b
      ? `  Прошлая версия: ${b.label} (${b.sourceChanged ? "источник обновлён" : "источник тот же"}) — изменились ${qc.changed} · пропали ${qc.missing.length} · новых ${qc.added.length} (${share(qc.changedShare)} имён, порог ${share(CHANGED_NAMES_LIMIT)})${qc.accepted ? " · приняты флагом --accept-changes" : ""}`
      : `  Прошлая версия: сравнивать не с чем — ${qc.baselineNote ?? "нет данных"}`,
  );
  return lines;
}

function verdict(qc: SetQcReport): string {
  if (qc.stop.length > 0) return `<span class="stop">СТОП</span>`;
  if (qc.accepted) return `<span class="ok">изменения приняты</span>`;
  return `<span class="ok">можно записывать</span>`;
}

function baselineCell(qc: SetQcReport): string {
  const b = qc.baseline;
  if (!b) {
    return `<span class="muted">сравнивать не с чем: ${esc(qc.baselineNote ?? "нет данных")}</span>`;
  }
  return `${esc(b.label)}<br><span class="muted">${b.sourceChanged ? "источник обновлён" : "источник тот же"}</span>`;
}

function summaryTable(sets: readonly SetBuildReport[]): string {
  const rows = sets.map((r) => {
    const qc = r.qc;
    const cell = (kind: QcKind) => `<td class="num">${countOf(qc, kind)}</td>`;
    const changed = qc.baseline
      ? `<td class="num">${qc.changed}</td><td class="num">${qc.missing.length}</td><td class="num">${qc.added.length}</td>`
      : `<td class="num">—</td><td class="num">—</td><td class="num">—</td>`;
    return `<tr><td><b>${esc(r.normalize.name)}</b><br><span class="muted">${esc(r.normalize.id)}</span></td><td class="num">${qc.checked}</td>${cell("empty")}${cell("sparse")}${cell("cropped")}${changed}${cell("original")}<td>${baselineCell(qc)}</td><td>${verdict(qc)}</td></tr>`;
  });
  return `<table><thead><tr><th>Набор</th><th>Нарисовано</th><th>Пустые</th><th>Почти пустые</th><th>Обрезанные</th><th>Изменились</th><th>Пропали</th><th>Новые</th><th>Отличаются от оригинала</th><th>Прошлая версия</th><th>Итог</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>`;
}

/** Раздел «Контроль качества» для сводки галереи сборки. */
export function qcSection(sets: readonly SetBuildReport[]): string {
  return `<h2>Контроль качества</h2>
<p class="muted">ADR-0016: каждая иконка нарисована через resvg (сетка — ${RENDER_SIZE} px), машина отобрала подозрительные. Подробно, с картинками и причинами — <a href="qc.html">qc.html</a>.</p>
${summaryTable(sets)}`;
}

/** Картинка в рамке: PNG из проверки или SVG браузера; frame — пунктир по краю холста. */
function figure(label: string, image: Omit<QcImage, "label">, vector = false) {
  const width = image.width * ZOOM;
  const height = image.height * ZOOM;
  const frame = image.frame
    ? `<i style="left:${image.frame.x * ZOOM}px;top:${image.frame.y * ZOOM}px;width:${image.frame.width * ZOOM}px;height:${image.frame.height * ZOOM}px"></i>`
    : "";
  return `<figure><span class="pic" style="width:${width}px;height:${height}px"><img${vector ? ` class="vector"` : ""} src="${image.src}" alt="">${frame}</span><figcaption>${esc(label)}</figcaption></figure>`;
}

/** Иконка глазами браузера: тот же запас и рамка холста, что у картинки resvg. */
function browserFigure(icon: NormalizedIcon, grid: number): string {
  const rect = canvasRect(icon, grid);
  const svg = paddedSvg(icon, grid);
  return figure(
    "браузер",
    {
      src: svgDataUri(svg),
      width: rect.width + 2 * rect.x,
      height: rect.height + 2 * rect.y,
      frame: rect,
    },
    true,
  );
}

interface SetLookup {
  /** Ссылка на карточку в галерее; у алиаса — на карточку родителя. */
  links: Map<string, string>;
  /** Тело иконки по имени, у алиаса — тело родителя. */
  icons: Map<string, NormalizedIcon>;
}

function lookupOf(r: SetBuildReport): SetLookup {
  const id = r.normalize.id;
  const links = new Map<string, string>();
  const icons = new Map<string, NormalizedIcon>();
  r.icons.forEach((b, index) => {
    links.set(b.entry.name, cardLink(id, index, b.entry.name));
    icons.set(b.entry.name, b.icon);
  });
  for (const [alias, parent] of r.aliases) {
    const link = links.get(parent);
    const icon = icons.get(parent);
    if (link) links.set(alias, link);
    if (icon) icons.set(alias, icon);
  }
  return { links, icons };
}

function card(r: SetBuildReport, f: QcFinding, lookup: SetLookup): string {
  const id = r.normalize.id;
  const link = lookup.links.get(f.name);
  const title = link
    ? `<a href="${link}">${esc(id)}:${esc(f.name)}</a>`
    : `${esc(id)}:${esc(f.name)}`;
  const figures = f.images.map((img) => figure(img.label, img));
  const icon = lookup.icons.get(f.name);
  const withBrowser: readonly QcKind[] = [
    "failed",
    "empty",
    "sparse",
    "cropped",
  ];
  if (icon && withBrowser.includes(f.kind)) {
    figures.push(browserFigure(icon, r.normalize.grid));
  }
  return `<article class="qc-card"><h4>${title}</h4><p>${esc(f.text)}</p><div class="pics">${figures.join("")}</div></article>`;
}

function namesList(title: string, names: readonly string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, REPORT_LIMIT).map(esc).join(", ");
  const more =
    names.length > REPORT_LIMIT
      ? ` <span class="muted">… и ещё ${names.length - REPORT_LIMIT}</span>`
      : "";
  return `<h3>${esc(title)} (${names.length})</h3><p class="names">${shown}${more}</p>`;
}

function setSection(r: SetBuildReport): string {
  const qc = r.qc;
  const lookup = lookupOf(r);
  const parts: string[] = [];
  for (const kind of QC_KINDS) {
    const list = qc.findings.filter((f) => f.kind === kind);
    if (list.length === 0) continue;
    const more =
      list.length > REPORT_LIMIT
        ? `<p class="muted">… и ещё ${list.length - REPORT_LIMIT}: ${list
            .slice(REPORT_LIMIT)
            .map((f) => esc(f.name))
            .join(", ")}</p>`
        : "";
    parts.push(`<h3>${TITLES[kind]} (${list.length})</h3>
<p class="muted">${HINTS[kind]}</p>
<div class="qc-cards">
${list
  .slice(0, REPORT_LIMIT)
  .map((f) => card(r, f, lookup))
  .join("\n")}
</div>${more}`);
  }
  if (qc.changed > countOf(qc, "changed")) {
    parts.push(
      `<p class="muted">Всего изменилось имён: ${qc.changed} — алиасы показаны вместе с родителем.</p>`,
    );
  }
  parts.push(namesList("Пропали с прошлой версии", qc.missing));
  parts.push(namesList("Новые", qc.added));
  const stops = qc.stop
    .map((s) => `<p class="stop">СТОП — ${esc(s)}</p>`)
    .join("");
  const body = parts.filter(Boolean).join("\n");
  return `<h2 id="set-${esc(r.normalize.id)}">${esc(r.normalize.name)}</h2>
<p class="muted">${esc(r.normalize.id)} · ${esc(r.normalize.source)} · прошлая версия: ${
    qc.baseline
      ? `${esc(qc.baseline.label)}, ${qc.baseline.sourceChanged ? "источник обновлён" : "источник тот же"}`
      : `сравнивать не с чем — ${esc(qc.baselineNote ?? "нет данных")}`
  }</p>
${stops}
${body || "<p>Ничего подозрительного.</p>"}`;
}

/** Страница qc.html: все подозрительные иконки с картинками и причинами. */
export function renderQcPage(sets: readonly SetBuildReport[]): string {
  return htmlPage(
    "Контроль качества",
    `body { max-width: 1440px; }${QC_STYLE}`,
    `<h1>Контроль качества</h1>
<p class="muted">ADR-0016: каждая иконка нарисована через resvg — сетка ${RENDER_SIZE} px, прозрачный фон, запас вокруг холста. Машина сравнила её с прошлой версией из git и с исходным файлом автора. Здесь только подозрительные иконки; ссылка в заголовке карточки ведёт на её карточку в галерее (16, 24 и 48 px, тёмный фон, красный цвет).</p>
<nav><a href="index.html">Сводка сборки</a></nav>
<h2>Как читать</h2>
<ul>
${QC_KINDS.map((k) => `<li><b>${TITLES[k]}</b> — ${HINTS[k]}</li>`).join("\n")}
<li><b>Картинки.</b> «resvg» — что увидела проверка, «браузер» — как иконку рисует браузер; пунктир — край холста. Если они расходятся, ошибается сама проверка.</li>
<li><b>Наложение.</b> <span class="swatch" style="background:#d6d6d6"></span> совпадает, <span class="swatch" style="background:#e5484d"></span> пропало или посветлело, <span class="swatch" style="background:#3e63dd"></span> появилось или потемнело.</li>
</ul>
<h2>Сводка</h2>
${summaryTable(sets)}
${sets.map(setSection).join("\n")}`,
  );
}
