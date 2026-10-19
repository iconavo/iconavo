// Галерея нормализации: каждая иконка «было» и «стало» — на светлом и тёмном фоне, в красном цвете,
// в размерах 48, 24 и 16 px. Без скриптов. Результат встраивается в страницу, а не картинкой:
// так видно, что цвет действительно берётся от текста вокруг — как будет в пакете.
// Страницы наборов общие с галереей сборки (шаг 5): там у иконки третья строка — после SVGO.

import { esc, htmlPage, inIcons, percent, svgDataUri } from "../report/html.js";
import { formatNumber } from "./canvas.js";
import type { NormalizedIcon } from "./normalize.js";
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

/** Что странице галереи нужно знать о наборе. */
export type GallerySet = Pick<
  SetNormalizeReport,
  "id" | "name" | "source" | "palette" | "grid" | "sourceGrid"
>;

/** Иконка в галерее. */
export interface GalleryItem {
  entry: NormalizedEntry;
  /** Иконка после SVGO — третья строка в галерее сборки. */
  optimized?: NormalizedIcon;
  /** Варианты, ставшие алиасами этой иконки (ADR-0002). */
  aliases?: readonly string[];
  /** Почему иконку стоит посмотреть первой; пусто — не нужно. */
  attention: readonly string[];
}

/** Заголовок и пояснение страниц набора. */
export interface PageKind {
  title: string;
  legend: string;
}

const CHECKLIST = [
  "Результат совпадает с оригиналом по форме.",
  "В красном цвете перекрашена вся монохромная иконка, а не её часть.",
  "Линейные иконки (Lucide, Tabler) не превратились в залитые силуэты.",
  "На тёмном фоне иконки видны: цвет берётся от текста.",
  "Fluent Emoji сохранили свои цвета.",
];

export const GALLERY_STYLE = `
body { max-width: 1440px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(450px, 1fr)); gap: 10px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; content-visibility: auto; contain-intrinsic-size: auto 150px; }
.card h3 { margin: 0 0 6px; font-size: 14px; overflow-wrap: anywhere; }
.badge { display: inline-block; margin: 2px 0 0 6px; padding: 0 6px; border-radius: 6px; background: var(--code); color: var(--stop); font-size: 12px; font-weight: 600; }
.badge.alias { color: var(--muted); font-weight: normal; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; }
.lbl { width: 56px; font-size: 12px; color: var(--muted); }
.t { display: inline-flex; align-items: center; gap: 6px; padding: 6px; border-radius: 8px; border: 1px solid var(--line); }
.t > * { display: block; flex: none; }
.light { background: #ffffff; color: #1c1c1e; } .dark { background: #141416; color: #ececf0; } .red { background: #ffffff; color: #e5484d; }
.o { background: no-repeat center / contain; }
.s48 { width: 48px; height: 48px; } .s24 { width: 24px; height: 24px; } .s16 { width: 16px; height: 16px; }
.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
`;

const NORMALIZE_PAGE: PageKind = {
  title: "нормализация",
  legend:
    "Было — исходный файл картинкой: он не знает цвета текста вокруг. Стало — результат прямо в странице: на светлом фоне, на тёмном и в красном цвете; 48, 24 и 16 px.",
};

export const pageFile = (id: string, page: number) => `${id}-${page}.html`;
const pageCount = (count: number) => Math.ceil(count / PAGE_SIZE);
const anchor = (name: string) => `i-${name}`;
/** Ссылка на карточку иконки: страница набора по номеру иконки и якорь. */
export const cardLink = (id: string, index: number, name: string) =>
  `${pageFile(id, Math.floor(index / PAGE_SIZE) + 1)}#${anchor(name)}`;
const viewBoxOf = (icon: NormalizedIcon) =>
  `0 0 ${formatNumber(icon.width)} ${formatNumber(icon.height)}`;
/** Ширина плитки при заданной высоте: неквадратные иконки сохраняют пропорции. */
const widthAt = (icon: NormalizedIcon, size: number) =>
  formatNumber((size * icon.width) / icon.height);
/** Иконке с ID нужна своя копия на каждую плитку, остальным хватает общего <symbol>. */
const hasIds = (icon: NormalizedIcon) => icon.body.includes(' id="');

export const canvasLabel = (r: GallerySet) =>
  r.sourceGrid === r.grid
    ? `сетка ${r.grid}`
    : `источник ${formatNumber(r.sourceGrid)} → сетка ${r.grid}`;

/** Исходный файл картинкой: данные — в стилях страницы, один раз на иконку. */
function originalTiles(icon: NormalizedIcon, n: number): string {
  return SIZES.map((size) => {
    const width = widthAt(icon, size);
    const style = width === String(size) ? "" : ` style="width:${width}px"`;
    return `<i class="o o${n} s${size}"${style}></i>`;
  }).join("");
}

/**
 * Иконка прямо в странице: три тона по три размера. Без ID — ссылкой на общий <symbol>; с ID — своей
 * копией на каждую плитку с уникальными ID, как будет рисовать пакет (ADR-0031). first — номер первой
 * плитки строки: у строки «после SVGO» номера свои.
 */
function resultRow(
  icon: NormalizedIcon,
  symbol: string,
  base: string,
  first: number,
): string {
  return TONES.map((tone, i) => {
    const tiles = SIZES.map((size, k) => {
      const attrs = `width="${widthAt(icon, size)}" height="${size}"`;
      if (!hasIds(icon)) return `<svg ${attrs}><use href="#${symbol}"/></svg>`;
      const copy = icon.body.replaceAll(
        `${base}-`,
        `${base}-t${first + i * SIZES.length + k}-`,
      );
      return `<svg ${attrs} viewBox="${viewBoxOf(icon)}">${copy}</svg>`;
    }).join("");
    return `<span class="t ${tone}">${tiles}</span>`;
  }).join("");
}

function card(r: GallerySet, item: GalleryItem, n: number): string {
  const e = item.entry;
  const badges = item.attention
    .map((a) => `<span class="badge">${esc(a)}</span>`)
    .join("");
  const aliases =
    item.aliases && item.aliases.length > 0
      ? `<span class="badge alias">алиасы: ${esc(item.aliases.join(", "))}</span>`
      : "";
  const before =
    `<span class="t light">${originalTiles(e.icon, n)}</span>` +
    (r.palette === "color"
      ? `<span class="t dark">${originalTiles(e.icon, n)}</span>`
      : "");
  const base = `${r.id}--${e.name}`;
  const rows = [
    `<div class="row"><span class="lbl">было</span>${before}</div>`,
    `<div class="row"><span class="lbl">${item.optimized ? "до SVGO" : "стало"}</span>${resultRow(e.icon, `s${n}`, base, 0)}</div>`,
  ];
  if (item.optimized) {
    rows.push(
      `<div class="row"><span class="lbl">SVGO</span>${resultRow(item.optimized, `p${n}`, base, TONES.length * SIZES.length)}</div>`,
    );
  }
  return `<article class="card" id="${anchor(e.name)}"><h3>${esc(e.name)}${badges}${aliases}</h3>
${rows.join("\n")}</article>`;
}

function pageNav(r: GallerySet, page: number, pages: number): string {
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

function renderPage(
  r: GallerySet,
  items: readonly GalleryItem[],
  page: number,
  kind: PageKind,
): string {
  const pages = pageCount(items.length);
  const from = (page - 1) * PAGE_SIZE;
  const shown = items.slice(from, from + PAGE_SIZE);
  const originals = shown
    .map(
      (item, n) =>
        `.o${n} { background-image: url("${svgDataUri(item.entry.source)}"); }`,
    )
    .join("\n");
  const symbol = (icon: NormalizedIcon, id: string) =>
    hasIds(icon)
      ? ""
      : `<symbol id="${id}" viewBox="${viewBoxOf(icon)}">${icon.body}</symbol>`;
  const symbols = shown
    .map(
      (item, n) =>
        symbol(item.entry.icon, `s${n}`) +
        (item.optimized ? symbol(item.optimized, `p${n}`) : ""),
    )
    .join("");
  const nav = pageNav(r, page, pages);
  return htmlPage(
    `${r.name} — ${kind.title}, ${page} из ${pages}`,
    `${GALLERY_STYLE}${originals}\n`,
    `<h1>${esc(r.name)} <span class="muted">страница ${page} из ${pages}</span></h1>
<p class="muted">${esc(r.id)} · ${esc(r.source)} · ${canvasLabel(r)} · иконки ${from + 1}–${from + shown.length} из ${items.length}</p>
${nav}
<p class="muted">${kind.legend}</p>
<svg class="sprite" aria-hidden="true">${symbols}</svg>
<div class="cards">
${shown.map((item, n) => card(r, item, n)).join("\n")}
</div>
${nav}`,
  );
}

/** Страницы набора по PAGE_SIZE иконок. По одной — чтобы не держать всё в памяти. */
export function* renderSetPages(
  r: GallerySet,
  items: readonly GalleryItem[],
  kind: PageKind,
): Generator<GalleryFile> {
  for (let page = 1; page <= pageCount(items.length); page++) {
    yield {
      name: pageFile(r.id, page),
      html: renderPage(r, items, page, kind),
    };
  }
}

/**
 * Пункты «Сначала посмотрите» набора: сначала иконки без карточки (исключённые и т. п.) с причиной,
 * затем иконки со ссылкой на карточку.
 */
export function attentionItems(
  r: GallerySet,
  items: readonly GalleryItem[],
  problems: readonly { name: string; reason: string }[],
): string[] {
  const out = problems.map(
    (p) => `<li><b>${esc(r.id)}:${esc(p.name)}</b> — ${esc(p.reason)}</li>`,
  );
  items.forEach((item, index) => {
    if (item.attention.length === 0) return;
    const href = cardLink(r.id, index, item.entry.name);
    out.push(
      `<li><a href="${href}">${esc(r.id)}:${esc(item.entry.name)}</a> — ${esc(item.attention.join("; "))}</li>`,
    );
  });
  return out;
}

/** Раздел «Сначала посмотрите»: не больше ATTENTION_LIMIT пунктов на набор. */
export function attentionSection(
  sets: readonly { id: string; items: readonly string[] }[],
): string {
  const shown = sets.flatMap(({ id, items }) => {
    const list = items.slice(0, ATTENTION_LIMIT);
    if (items.length > ATTENTION_LIMIT) {
      list.push(
        `<li class="muted">… и ещё ${items.length - ATTENTION_LIMIT} в наборе ${esc(id)}</li>`,
      );
    }
    return list;
  });
  return shown.length === 0
    ? `<p>Ничего необычного не найдено.</p>`
    : `<ul>${shown.join("")}</ul>`;
}

/** Ссылки на страницы всех наборов. */
export function pagesSection(
  sets: readonly { set: GallerySet; count: number }[],
): string {
  const items = sets.map(({ set, count }) => {
    const links: string[] = [];
    for (let p = 1; p <= pageCount(count); p++) {
      links.push(`<a href="${pageFile(set.id, p)}">${p}</a>`);
    }
    return `<li><b>${esc(set.name)}</b> (${count}): ${links.join(" ") || `<span class="muted">нет иконок</span>`}</li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

/** Причины, по которым наборы нельзя обновлять. */
export const stopsSection = (
  sets: readonly { name: string; stop: readonly string[] }[],
) =>
  sets
    .flatMap((r) =>
      r.stop.map((s) => `<p class="stop">${esc(r.name)}: СТОП — ${esc(s)}</p>`),
    )
    .join("");

const itemsOf = (r: SetNormalizeReport): GalleryItem[] =>
  r.icons.map((entry) => ({ entry, attention: entry.attention }));

function summaryRow(r: SetNormalizeReport): string {
  const c = r.counts;
  const verdict =
    r.stop.length === 0
      ? `<span class="ok">можно обновлять</span>`
      : `<span class="stop">СТОП</span>`;
  return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.id)} · ${esc(r.source)}</span></td><td class="num">${r.total}</td><td>${canvasLabel(r)}</td><td class="num">${c.moved}</td><td class="num">${r.palette === "color" ? "—" : c.defaults}</td><td class="num">${r.palette === "color" ? "—" : c.recolored}</td><td class="num">${c.withIds}</td><td class="num">${r.offGrid.length}</td><td class="num">${r.excluded.length} (${percent(r.excluded.length, r.total)})</td><td>${verdict}</td></tr>`;
}

function renderIndex(sets: readonly SetNormalizeReport[]): string {
  const attention = attentionSection(
    sets.map((r) => ({
      id: r.id,
      items: attentionItems(
        r,
        itemsOf(r),
        r.excluded.map((e) => ({
          name: e.name,
          reason: `исключена: ${e.reason}`,
        })),
      ),
    })),
  );
  return htmlPage(
    "Нормализация иконок — галерея",
    GALLERY_STYLE,
    `<h1>Нормализация иконок</h1>
<p class="muted">ADR-0014: холст набора, атрибуты корня во внешнем &lt;g&gt;, цвет «как у текста» в монохромных наборах, ID без конфликтов. Масштаб здесь ещё записан атрибутом transform — в координаты его «впечатывает» SVGO при сборке (pnpm data).</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Сводка</h2>
<table><thead><tr><th>Набор</th><th>Иконок</th><th>Холст</th><th>Атрибуты корня → &lt;g&gt;</th><th>Цвет по умолчанию</th><th>Цвета → currentColor</th><th>С ID</th><th>Вне сетки</th><th>Исключено</th><th>Итог</th></tr></thead>
<tbody>${sets.map(summaryRow).join("")}</tbody></table>
${stopsSection(sets)}
<h2>Сначала посмотрите</h2>
${attention}
<h2>Все иконки</h2>
${pagesSection(sets.map((r) => ({ set: r, count: r.icons.length })))}`,
  );
}

/** Файлы галереи: сводка index.html и страницы наборов. По одному — чтобы не держать всё в памяти. */
export function* renderGallery(
  sets: readonly SetNormalizeReport[],
): Generator<GalleryFile> {
  yield { name: "index.html", html: renderIndex(sets) };
  for (const r of sets) yield* renderSetPages(r, itemsOf(r), NORMALIZE_PAGE);
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
