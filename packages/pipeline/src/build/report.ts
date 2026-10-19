// Отчёт сборки (шаг 5): сводка в терминале, таблица размеров и галерея, где у каждой иконки три
// строки — было, до SVGO (после нормализации) и после SVGO. Страницы наборов общие с галереей шага 4.
// Контроль качества (шаг 6) добавляет раздел в сводку, страницу qc.html и значки на карточках.

import {
  attentionItems,
  attentionSection,
  GALLERY_STYLE,
  type GalleryFile,
  type GalleryItem,
  type PageKind,
  pagesSection,
  renderSetPages,
  stopsSection,
} from "../normalize/gallery.js";
import {
  findingsByName,
  formatQc,
  qcBadges,
  qcSection,
  renderQcPage,
} from "../qc/report.js";
import type { QcFinding } from "../qc/run.js";
import { esc, htmlPage, percent } from "../report/html.js";
import { formatBytes } from "../sources/report.js";
import type { BuildSizes, BuiltIcon, SetBuildReport } from "./run.js";

const BUILD_PAGE: PageKind = {
  title: "сборка",
  legend:
    "Было — исходный файл картинкой. До SVGO — после нормализации (шаг 4). SVGO — то, что записано в icons.json. На светлом фоне, на тёмном и в красном цвете; 48, 24 и 16 px. У алиасов своей карточки нет: они нарисованы так же, как иконка, на карточке которой перечислены.",
};

const CHECKLIST = [
  "Иконки из отчёта контроля качества (qc.html) разобраны: ошибка или так задумано автором.",
  "Строки «до SVGO» и «SVGO» совпадают по форме — особенно на 16 px.",
  "У Tabler нигде нет квадратной рамки.",
  "Тонкие линии и мелкие детали на месте: Phosphor *-thin, точки и круги Lucide.",
  "Fluent Emoji сохранили цвета, обрезку и градиенты.",
  "На карточках Material Symbols — значки алиасов: эти варианты нарисованы так же.",
];

/** Элементы, которые SVGO меняет осторожно: в цветном наборе такие иконки стоит сверить глазами. */
const COMPLEX: readonly [RegExp, string][] = [
  [/<clipPath\b/, "обрезка"],
  [/<mask\b/, "маска"],
  [/Gradient\b/, "градиент"],
  [/<pattern\b/, "узор"],
  [/<filter\b/, "фильтр"],
];

/** «−40,3%» или «+12,1%»: насколько изменился размер. */
export function sizeChange(before: number, after: number): string {
  if (before === 0) return "—";
  return `${after <= before ? "−" : "+"}${percent(Math.abs(before - after), before)}`;
}

/**
 * Почему иконку стоит посмотреть первой: замечания нормализации, то, что заметила сборка, и находки
 * контроля качества.
 */
function attentionOf(
  r: SetBuildReport,
  b: BuiltIcon,
  findings: readonly QcFinding[],
): string[] {
  const out = [...b.entry.attention];
  if (b.transformsLeft > 0) out.push(`transform остался: ${b.transformsLeft}`);
  if (r.normalize.palette === "color") {
    const found = COMPLEX.filter(([re]) => re.test(b.icon.body));
    if (found.length > 0) {
      out.push(`сложная цветная: ${found.map(([, what]) => what).join(", ")}`);
    }
  }
  return [...out, ...qcBadges(findings)];
}

function itemsOf(r: SetBuildReport): GalleryItem[] {
  const findings = findingsByName(r.qc);
  return r.icons.map((b) => ({
    entry: b.entry,
    optimized: b.icon,
    aliases: b.aliases,
    attention: attentionOf(r, b, findings.get(b.entry.name) ?? []),
  }));
}

/**
 * Иконки без карточки: исключённые, не прошедшие SVGO, с одним именем на несколько файлов,
 * пропавшие с прошлой версии.
 */
const problemsOf = (r: SetBuildReport) => [
  ...r.normalize.excluded.map((e) => ({
    name: e.name,
    reason: `исключена: ${e.reason}`,
  })),
  ...r.broken.map((b) => ({
    name: b.name,
    reason: `не прошла SVGO: ${b.problem}`,
  })),
  ...r.conflicts.map((c) => ({
    name: c.name,
    reason: `одно имя у файлов: ${c.files.join(", ")}`,
  })),
  ...r.qc.missing.map((name) => ({
    name,
    reason: "пропала: была в прошлой версии",
  })),
];

function sizeCells(s: BuildSizes): string {
  return `<td class="num">${formatBytes(s.source)}</td><td class="num">${formatBytes(s.normalized)}</td><td class="num">${formatBytes(s.optimized)} (${sizeChange(s.normalized, s.optimized)})</td><td class="num">${s.json === undefined ? "—" : formatBytes(s.json)}</td>`;
}

function sizeRow(r: SetBuildReport): string {
  const n = r.normalize;
  const verdict =
    r.stop.length === 0
      ? `<span class="ok">можно записывать</span>`
      : `<span class="stop">СТОП</span>`;
  return `<tr><td><b>${esc(n.name)}</b><br><span class="muted">${esc(n.id)} · ${esc(n.source)}</span></td><td class="num">${n.total}</td><td class="num">${r.icons.length}</td><td class="num">${r.aliases.length}</td><td class="num">${n.excluded.length}</td>${sizeCells(r.sizes)}<td class="num">${r.transforms.before} → ${r.transforms.left}</td><td>${verdict}</td></tr>`;
}

function totalRow(sets: readonly SetBuildReport[]): string {
  const sum = (pick: (r: SetBuildReport) => number) =>
    sets.reduce((n, r) => n + pick(r), 0);
  const written = sets.filter((r) => r.sizes.json !== undefined);
  const sizes: BuildSizes = {
    source: sum((r) => r.sizes.source),
    normalized: sum((r) => r.sizes.normalized),
    optimized: sum((r) => r.sizes.optimized),
    json:
      written.length === sets.length
        ? sum((r) => r.sizes.json ?? 0)
        : undefined,
  };
  return `<tr><td><b>Всего</b></td><td class="num">${sum((r) => r.normalize.total)}</td><td class="num">${sum((r) => r.icons.length)}</td><td class="num">${sum((r) => r.aliases.length)}</td><td class="num">${sum((r) => r.normalize.excluded.length)}</td>${sizeCells(sizes)}<td class="num">${sum((r) => r.transforms.before)} → ${sum((r) => r.transforms.left)}</td><td></td></tr>`;
}

function renderIndex(
  sets: readonly SetBuildReport[],
  items: readonly GalleryItem[][],
): string {
  const attention = attentionSection(
    sets.map((r, i) => ({
      id: r.normalize.id,
      items: attentionItems(r.normalize, items[i] ?? [], problemsOf(r)),
    })),
  );
  return htmlPage(
    "Сборка наборов — галерея",
    GALLERY_STYLE,
    `<h1>Сборка наборов</h1>
<p class="muted">ADR-0015: SVGO с закреплённой версией и явным списком плагинов, три знака после запятой, масштаб впечатан в координаты; одинаковые варианты — алиасы (ADR-0002). Результат — data/{набор}/icons.json.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Размер</h2>
<p class="muted">До SVGO — тела иконок после нормализации; после SVGO — те же иконки, включая ставшие алиасами. icons.json — файл набора целиком, алиасы в нём — одна строка вместо тела.</p>
<table><thead><tr><th>Набор</th><th>Иконок</th><th>В наборе</th><th>Алиасов</th><th>Исключено</th><th>Исходные SVG</th><th>До SVGO</th><th>После SVGO</th><th>icons.json</th><th>transform: было → осталось</th><th>Итог</th></tr></thead>
<tbody>${sets.map(sizeRow).join("")}${totalRow(sets)}</tbody></table>
${stopsSection(sets.map((r) => ({ name: r.normalize.name, stop: r.stop })))}
${qcSection(sets)}
<h2>Сначала посмотрите</h2>
${attention}
<h2>Все иконки</h2>
${pagesSection(sets.map((r, i) => ({ set: r.normalize, count: items[i]?.length ?? 0 })))}`,
  );
}

/** Файлы галереи сборки: сводка index.html, контроль качества qc.html и страницы наборов. */
export function* renderBuildGallery(
  sets: readonly SetBuildReport[],
): Generator<GalleryFile> {
  const items = sets.map(itemsOf);
  yield { name: "index.html", html: renderIndex(sets, items) };
  yield { name: "qc.html", html: renderQcPage(sets) };
  for (const [i, r] of sets.entries()) {
    yield* renderSetPages(r.normalize, items[i] ?? [], BUILD_PAGE);
  }
}

/** Сводка сборки набора для терминала. */
export function formatBuildReport(r: SetBuildReport): string {
  const n = r.normalize;
  const s = r.sizes;
  const lines = [`${n.id} (${n.name}) — ${n.source}`];
  lines.push(
    `  Иконок: ${n.total} · в наборе: ${r.icons.length} · алиасов: ${r.aliases.length} · исключено: ${n.excluded.length} (${percent(n.excluded.length, n.total)}, порог 1%)`,
  );
  lines.push(
    `  Размер: исходные SVG ${formatBytes(s.source)} → до SVGO ${formatBytes(s.normalized)} → после SVGO ${formatBytes(s.optimized)} (${sizeChange(s.normalized, s.optimized)})${s.json === undefined ? "" : ` · icons.json ${formatBytes(s.json)}`}`,
  );
  lines.push(
    `  transform: было ${r.transforms.before} · осталось ${r.transforms.left}`,
  );
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`  ${title}:`);
    for (const item of items.slice(0, 10)) lines.push(`    ${item}`);
    if (items.length > 10) lines.push(`    … и ещё ${items.length - 10}`);
  };
  list(
    "Исключены",
    n.excluded.map((e) => `${e.name} — ${e.reason}`),
  );
  list(
    "Не прошли SVGO",
    r.broken.map((b) => `${b.name} — ${b.problem}`),
  );
  list(
    "Одно имя у нескольких файлов",
    r.conflicts.map((c) => `${c.name}: ${c.files.join(", ")}`),
  );
  lines.push(...formatQc(r.qc));
  for (const kind of ["failed", "empty"] as const) {
    list(
      kind === "failed" ? "Не нарисовались" : "Пустые",
      r.qc.findings
        .filter((f) => f.kind === kind)
        .map((f) => `${f.name} — ${f.text}`),
    );
  }
  if (r.stop.length === 0) lines.push("  Итог: можно записывать");
  else for (const x of r.stop) lines.push(`  СТОП: ${x}`);
  return lines.join("\n");
}
