// Галерея нормализации: каждая иконка «было» и «стало» — на светлом и тёмном фоне, в красном цвете,
// в размерах 48, 24 и 16 px. Без скриптов. Результат встраивается в страницу, а не картинкой:
// так видно, что цвет действительно берётся от текста вокруг — как будет в пакете.

import { esc, htmlPage, inIcons, percent, svgDataUri } from "../report/html.js";
import { formatNumber } from "./canvas.js";
import type { NormalizedEntry, SetNormalizeReport } from "./run.js";

/** Иконок на странице галереи. */
export const PAGE_SIZE = 500;
/** Сколько пунктов «Сначала посмотрите» показывать на набор. */
const ATTENTION_LIMIT = 300;
const SIZES = [48, 24, 16] as const;
const TONES = ["light", "dark", "red"] as const;

export interface GalleryFile {
  /** Имя файла в папке галереи. */
  name: string;
  html: string;
}

const CHECKLIST = [
  "Результат совпадает с оригиналом по форме.",
  "В красном цвете перекрашена вся монохромная иконка, а не её часть.",
  "Линейные иконки (Lucide, Tabler) не превратились в залитые силуэты.",
  "На тёмном фоне иконки видны: цвет берётся от текста.",
  "Fluent Emoji сохранили свои цвета.",
];

const STYLE = `
body { max-width: 1440px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 10px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; content-visibility: auto; contain-intrinsic-size: auto 150px; }
.card h3 { margin: 0 0 6px; font-size: 14px; overflow-wrap: anywhere; }
.badge { display: inline-block; margin: 2px 0 0 6px; padding: 0 6px; border-radius: 6px; background: var(--code); color: var(--stop); font-size: 12px; font-weight: 600; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; }
.lbl { width: 40px; font-size: 12px; color: var(--muted); }
.t { display: inline-flex; align-items: center; gap: 6px; padding: 6px; border-radius: 8px; border: 1px solid var(--line); }
.t > * { display: block; flex: none; }
.light { background: #ffffff; color: #1c1c1e; } .dark { background: #141416; color: #ececf0; } .red { background: #ffffff; color: #e5484d; }
.o { background: no-repeat center / contain; }
.s48 { width: 48px; height: 48px; } .s24 { width: 24px; height: 24px; } .s16 { width: 16px; height: 16px; }
.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
`;

const pageFile = (id: string, page: number) => `${id}-${page}.html`;
const pageCount = (r: SetNormalizeReport) =>
  Math.ceil(r.icons.length / PAGE_SIZE);
const anchor = (name: string) => `i-${name}`;
const viewBoxOf = (e: NormalizedEntry) =>
  `0 0 ${formatNumber(e.icon.width)} ${formatNumber(e.icon.height)}`;
/** Ширина плитки при заданной высоте: неквадратные иконки сохраняют пропорции. */
const widthAt = (e: NormalizedEntry, size: number) =>
  formatNumber((size * e.icon.width) / e.icon.height);

const canvasLabel = (r: SetNormalizeReport) =>
  r.sourceGrid === r.grid
    ? `сетка ${r.grid}`
    : `источник ${formatNumber(r.sourceGrid)} → сетка ${r.grid}`;

/** Исходный файл картинкой: данные — в стилях страницы, один раз на иконку. */
function originalTiles(e: NormalizedEntry, n: number): string {
  return SIZES.map((size) => {
    const width = widthAt(e, size);
    const style = width === String(size) ? "" : ` style="width:${width}px"`;
    return `<i class="o o${n} s${size}"${style}></i>`;
  }).join("");
}

/**
 * Результат прямо в странице. Иконка без ID — ссылкой на общий <symbol>; иконка с ID — своей
 * копией на каждую плитку с уникальными ID, как будет рисовать пакет (ADR-0031).
 */
function resultTiles(
  e: NormalizedEntry,
  n: number,
  base: string,
  tone: number,
): string {
  return SIZES.map((size, k) => {
    const attrs = `width="${widthAt(e, size)}" height="${size}"`;
    if (e.stats.ids.renamed === 0) {
      return `<svg ${attrs}><use href="#s${n}"/></svg>`;
    }
    const copy = e.icon.body.replaceAll(
      `${base}-`,
      `${base}-t${tone * SIZES.length + k}-`,
    );
    return `<svg ${attrs} viewBox="${viewBoxOf(e)}">${copy}</svg>`;
  }).join("");
}

function card(r: SetNormalizeReport, e: NormalizedEntry, n: number): string {
  const badges = e.attention
    .map((a) => `<span class="badge">${esc(a)}</span>`)
    .join("");
  const before =
    `<span class="t light">${originalTiles(e, n)}</span>` +
    (r.palette === "color"
      ? `<span class="t dark">${originalTiles(e, n)}</span>`
      : "");
  const base = `${r.id}--${e.name}`;
  const after = TONES.map(
    (tone, i) => `<span class="t ${tone}">${resultTiles(e, n, base, i)}</span>`,
  ).join("");
  return `<article class="card" id="${anchor(e.name)}"><h3>${esc(e.name)}${badges}</h3>
<div class="row"><span class="lbl">было</span>${before}</div>
<div class="row"><span class="lbl">стало</span>${after}</div></article>`;
}

function pageNav(r: SetNormalizeReport, page: number): string {
  const pages = pageCount(r);
  const links: string[] = [];
  for (let p = 1; p <= pages; p++) {
    links.push(
      p === page ? `<b>${p}</b>` : `<a href="${pageFile(r.id, p)}">${p}</a>`,
    );
  }
  const prev =
    page > 1
      ? `<a href="${pageFile(r.id, page - 1)}">← назад</a>`
      : `<span class="muted">← назад</span>`;
  const next =
    page < pages
      ? `<a href="${pageFile(r.id, page + 1)}">вперёд →</a>`
      : `<span class="muted">вперёд →</span>`;
  return `<nav><a href="index.html">Сводка</a> · ${prev} · ${links.join(" ")} · ${next}</nav>`;
}

function renderPage(r: SetNormalizeReport, page: number): string {
  const pages = pageCount(r);
  const from = (page - 1) * PAGE_SIZE;
  const entries = r.icons.slice(from, from + PAGE_SIZE);
  const originals = entries
    .map(
      (e, n) => `.o${n} { background-image: url("${svgDataUri(e.source)}"); }`,
    )
    .join("\n");
  const symbols = entries
    .map((e, n) =>
      e.stats.ids.renamed > 0
        ? ""
        : `<symbol id="s${n}" viewBox="${viewBoxOf(e)}">${e.icon.body}</symbol>`,
    )
    .join("");
  const nav = pageNav(r, page);
  return htmlPage(
    `${r.name} — нормализация, ${page} из ${pages}`,
    `${STYLE}${originals}\n`,
    `<h1>${esc(r.name)} <span class="muted">страница ${page} из ${pages}</span></h1>
<p class="muted">${esc(r.id)} · ${esc(r.source)} · ${canvasLabel(r)} · иконки ${from + 1}–${from + entries.length} из ${r.icons.length}</p>
${nav}
<p class="muted">Было — исходный файл картинкой: он не знает цвета текста вокруг. Стало — результат прямо в странице: на светлом фоне, на тёмном и в красном цвете; 48, 24 и 16 px.</p>
<svg class="sprite" aria-hidden="true">${symbols}</svg>
<div class="cards">
${entries.map((e, n) => card(r, e, n)).join("\n")}
</div>
${nav}`,
  );
}

function summaryRow(r: SetNormalizeReport): string {
  const c = r.counts;
  const verdict =
    r.stop.length === 0
      ? `<span class="ok">можно обновлять</span>`
      : `<span class="stop">СТОП</span>`;
  return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.id)} · ${esc(r.source)}</span></td><td class="num">${r.total}</td><td>${canvasLabel(r)}</td><td class="num">${c.moved}</td><td class="num">${r.palette === "color" ? "—" : c.defaults}</td><td class="num">${r.palette === "color" ? "—" : c.recolored}</td><td class="num">${c.withIds}</td><td class="num">${r.offGrid.length}</td><td class="num">${r.excluded.length} (${percent(r.excluded.length, r.total)})</td><td>${verdict}</td></tr>`;
}

function attentionItems(r: SetNormalizeReport): string[] {
  const items: string[] = r.excluded.map(
    (e) =>
      `<li><b>${esc(r.id)}:${esc(e.name)}</b> — исключена: ${esc(e.reason)}</li>`,
  );
  r.icons.forEach((e, index) => {
    if (e.attention.length === 0) return;
    const href = `${pageFile(r.id, Math.floor(index / PAGE_SIZE) + 1)}#${anchor(e.name)}`;
    items.push(
      `<li><a href="${href}">${esc(r.id)}:${esc(e.name)}</a> — ${esc(e.attention.join("; "))}</li>`,
    );
  });
  return items;
}

function renderIndex(sets: readonly SetNormalizeReport[]): string {
  const attention = sets.flatMap((r) => {
    const items = attentionItems(r);
    const shown = items.slice(0, ATTENTION_LIMIT);
    if (items.length > ATTENTION_LIMIT) {
      shown.push(
        `<li class="muted">… и ещё ${items.length - ATTENTION_LIMIT} в наборе ${esc(r.id)}</li>`,
      );
    }
    return shown;
  });
  const pages = sets
    .map((r) => {
      const links: string[] = [];
      for (let p = 1; p <= pageCount(r); p++) {
        links.push(`<a href="${pageFile(r.id, p)}">${p}</a>`);
      }
      return `<li><b>${esc(r.name)}</b> (${r.icons.length}): ${links.join(" ") || `<span class="muted">нет иконок</span>`}</li>`;
    })
    .join("");
  const stops = sets
    .flatMap((r) =>
      r.stop.map((s) => `<p class="stop">${esc(r.name)}: СТОП — ${esc(s)}</p>`),
    )
    .join("");
  return htmlPage(
    "Нормализация иконок — галерея",
    STYLE,
    `<h1>Нормализация иконок</h1>
<p class="muted">ADR-0014: холст набора, атрибуты корня во внешнем &lt;g&gt;, цвет «как у текста» в монохромных наборах, ID без конфликтов. Масштаб пока записан атрибутом transform — в координаты его «впечатает» SVGO на шаге 5.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Сводка</h2>
<table><thead><tr><th>Набор</th><th>Иконок</th><th>Холст</th><th>Атрибуты корня → &lt;g&gt;</th><th>Цвет по умолчанию</th><th>Цвета → currentColor</th><th>С ID</th><th>Вне сетки</th><th>Исключено</th><th>Итог</th></tr></thead>
<tbody>${sets.map(summaryRow).join("")}</tbody></table>
${stops}
<h2>Сначала посмотрите</h2>
${attention.length === 0 ? `<p>Ничего необычного не найдено.</p>` : `<ul>${attention.join("")}</ul>`}
<h2>Все иконки</h2>
<ul>${pages}</ul>`,
  );
}

/** Файлы галереи: сводка index.html и страницы наборов. По одному — чтобы не держать всё в памяти. */
export function* renderGallery(
  sets: readonly SetNormalizeReport[],
): Generator<GalleryFile> {
  yield { name: "index.html", html: renderIndex(sets) };
  for (const r of sets) {
    for (let page = 1; page <= pageCount(r); page++) {
      yield { name: pageFile(r.id, page), html: renderPage(r, page) };
    }
  }
}

/** Сводка по набору для терминала. */
export function formatNormalizeReport(r: SetNormalizeReport): string {
  const c = r.counts;
  const lines = [`${r.id} (${r.name}) — ${r.source}`];
  lines.push(
    `  Иконок: ${r.total} · нормализовано: ${r.icons.length} · исключено: ${r.excluded.length} (${percent(r.excluded.length, r.total)}, порог 1%)`,
  );
  const offGrid =
    r.offGrid.length === 0
      ? "0"
      : `${r.offGrid.length} — ${r.offGrid.slice(0, 5).join(", ")}${r.offGrid.length > 5 ? " …" : ""}`;
  lines.push(
    `  Холст: ${canvasLabel(r)} · масштаб или сдвиг: ${c.scaled} · вне сетки: ${offGrid}`,
  );
  lines.push(
    `  Атрибуты корня → <g>: ${c.moved} · ID переименовано: ${c.idsRenamed} ${inIcons(c.withIds)} · ID удалено: ${c.idsRemoved}`,
  );
  lines.push(
    r.palette === "color"
      ? "  Цветной набор: цвета не меняются"
      : `  Цвет по умолчанию: ${c.defaults} · цвета → currentColor: ${c.recolored} · несколько цветов: ${c.multiColor} · сложные: ${c.complex} · залитые фигуры с обводкой: ${c.strokedFilled}`,
  );
  if (r.excluded.length > 0) {
    lines.push("  Исключены:");
    for (const e of r.excluded.slice(0, 10)) {
      lines.push(`    ${e.name} — ${e.reason}`);
    }
    if (r.excluded.length > 10) {
      lines.push(`    … и ещё ${r.excluded.length - 10}`);
    }
  }
  if (r.warnings.length > 0) {
    lines.push("  Предупреждения:");
    for (const w of r.warnings.slice(0, 5)) {
      lines.push(`    ${w.what} — ${inIcons(w.icons)}`);
    }
  }
  for (const x of r.unsafe.slice(0, 5)) {
    lines.push(`    ПРОВЕРИТЬ ${x.name}: ${x.problems.join("; ")}`);
  }
  if (r.stop.length === 0) lines.push("  Итог: можно обновлять");
  else for (const s of r.stop) lines.push(`  СТОП: ${s}`);
  return lines.join("\n");
}
