// Отчёт метаданных (шаг 7, ADR-0017): строки для терминала, итоговая таблица, раздел в сводке
// галереи сборки и страница metadata.html — лицензии с полным текстом, витрины, категории и выборка
// иконок с тегами. Без скриптов, как вся галерея: картинки — SVG в адресах data:.

import { createHash } from "node:crypto";
import type { SetBuildReport } from "../build/run.js";
import { cardLink } from "../normalize/gallery.js";
import { iconToSvg, type NormalizedIcon } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import type { SetLicense } from "./license.js";
import type { SetMetadata } from "./run.js";

/** Сколько иконок каждого набора показать с тегами. */
export const TAG_SAMPLE = 10;
/** Сколько имён показывать в списках. */
const LIST_LIMIT = 300;

const STATUS: Record<SetLicense["status"], string> = {
  confirmed: "подтверждена",
  unconfirmed: "не подтверждена",
  changed: "изменилась у автора",
};

const CHECKLIST = [
  "Текст лицензии каждого набора прочитан. Подтверждение — ваше решение (ADR-0017): после него Claude впишет отпечаток текста в конфиг набора.",
  "У 10 иконок каждого набора теги похожи на правду.",
  "Витрина — шесть иконок — передаёт стиль набора.",
  "Категории — как у автора; у набора без метаданных автора их нет.",
];

export const METADATA_STYLE = `
.meta-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 10px; }
.meta-card { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.meta-card h4 { margin: 0 0 4px; font-size: 14px; overflow-wrap: anywhere; }
.meta-card p { margin: 2px 0; font-size: 13px; overflow-wrap: anywhere; }
.tile { display: block; flex: none; background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 6px; object-fit: contain; }
.samples { display: flex; flex-wrap: wrap; gap: 12px; }
.samples figure { margin: 0; }
.samples figcaption { font-size: 12px; color: var(--muted); max-width: 96px; overflow-wrap: anywhere; }
.names { overflow-wrap: anywhere; font-size: 13px; }
details { margin: 8px 0; } summary { cursor: pointer; font-weight: 600; }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
/** Коммит — первые 7 символов, версия пакета — как есть. */
const shortRevision = (revision: string) =>
  /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;

interface Counts {
  total: number;
  /** С тегами автора. */
  author: number;
  /** С тегами из частей имени. */
  name: number;
  categories: number;
}

function countsOf(m: SetMetadata): Counts {
  let author = 0;
  for (const icon of m.icons.values()) if (icon.from === "author") author++;
  return {
    total: m.icons.size,
    author,
    name: m.icons.size - author,
    categories: m.categories.length,
  };
}

/** Строки метаданных для сводки набора в терминале. */
export function formatMetadata(m: SetMetadata): string[] {
  const c = countsOf(m);
  const l = m.license;
  return [
    l
      ? `  Лицензия: ${l.spdx} — ${STATUS[l.status]} · NOTICE: ${l.noticeFile ?? "нет"} · ${l.source} · ${shortRevision(l.revision)}`
      : "  Лицензия: текст не прочитан",
    `  Метаданные ${m.format ? `автора (${m.format})` : "автора: нет"} · теги автора у ${c.author} из ${c.total} · из имени ${c.name} · категорий ${c.categories}`,
    `  Витрина: ${m.samples.join(", ")}`,
  ];
}

/** Итоговая таблица для терминала: набор, лицензия, иконок, с тегами автора, из имени, категорий. */
export function formatMetadataTable(sets: readonly SetBuildReport[]): string {
  const head = [
    "Набор",
    "Лицензия",
    "Иконок",
    "С тегами автора",
    "Теги из имени",
    "Категорий",
  ];
  const rows = sets.map((r) => {
    const c = countsOf(r.metadata);
    return [
      r.normalize.id,
      r.metadata.license?.spdx ?? "—",
      String(c.total),
      String(c.author),
      String(c.name),
      String(c.categories),
    ];
  });
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) =>
        i < 2 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

function statusCell(l: SetLicense | undefined): string {
  if (!l) return `<span class="stop">не прочитана</span>`;
  return l.status === "confirmed"
    ? `<span class="ok">${STATUS[l.status]}</span>`
    : `<span class="stop">${STATUS[l.status]}</span>`;
}

function summaryTable(sets: readonly SetBuildReport[]): string {
  const rows = sets.map((r) => {
    const m = r.metadata;
    const c = countsOf(m);
    const id = esc(r.normalize.id);
    return `<tr><td><b><a href="metadata.html#set-${id}">${esc(r.normalize.name)}</a></b><br><span class="muted">${id}</span></td><td>${m.license ? esc(m.license.spdx) : "—"}<br>${statusCell(m.license)}</td><td class="num">${c.total}</td><td class="num">${c.author}</td><td class="num">${c.name}</td><td class="num">${c.categories}</td><td>${m.format ? esc(m.format) : `<span class="muted">нет — теги из имени</span>`}</td></tr>`;
  });
  return `<table><thead><tr><th>Набор</th><th>Лицензия</th><th>Иконок</th><th>С тегами автора</th><th>Теги из имени</th><th>Категорий</th><th>Метаданные автора</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>`;
}

/** Раздел «Метаданные и лицензии» для сводки галереи сборки. */
export function metadataSection(sets: readonly SetBuildReport[]): string {
  return `<h2>Метаданные и лицензии</h2>
<p class="muted">ADR-0017: лицензия набора целиком, теги и категории автора, витрина. Тексты лицензий, витрины и выборка иконок с тегами — <a href="metadata.html">metadata.html</a>.</p>
${summaryTable(sets)}`;
}

/** Иконка картинкой на белой плитке: монохромная рисуется чёрным. */
const tile = (icon: NormalizedIcon, size: number) =>
  `<img class="tile" src="${svgDataUri(iconToSvg(icon))}" width="${size}" height="${size}" alt="">`;

function namesList(names: readonly string[]): string {
  const shown = names.slice(0, LIST_LIMIT).map(esc).join(", ");
  const more =
    names.length > LIST_LIMIT
      ? ` <span class="muted">… и ещё ${names.length - LIST_LIMIT}</span>`
      : "";
  return `<p class="names">${shown}${more}</p>`;
}

function licenseBlock(id: string, l: SetLicense | undefined): string {
  if (!l)
    return `<p class="stop">Текст лицензии не прочитан — причина выше.</p>`;
  const rows = [
    [
      "Лицензия",
      `${esc(l.spdx)} · <a href="${esc(l.url)}">${esc(l.title)}</a>`,
    ],
    ["Статус", statusCell(l)],
    ["Источник", `<a href="${esc(l.source)}">${esc(l.source)}</a>`],
    ["Версия или коммит", `<code>${esc(l.revision)}</code>`],
    ["Отпечаток текста", `<code>${l.hash}</code>`],
    ["NOTICE", l.noticeFile ? esc(l.noticeFile) : "нет"],
  ]
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join("");
  const confirm =
    l.status === "confirmed"
      ? ""
      : `<p>Подтверждение — ваше решение (ADR-0017). Если текст в порядке, скажите Claude «подтверждаю»: в <code>sources/${esc(id)}.ts</code> в поле <code>license</code> добавится <code>confirmed: "${l.hash}"</code>.</p>`;
  const open = l.status === "confirmed" ? "" : " open";
  const notice = l.notice
    ? `<details${open}><summary>NOTICE</summary><pre>${esc(l.notice)}</pre></details>`
    : "";
  return `<table>${rows}</table>
${confirm}
<details${open}><summary>Текст LICENSE</summary><pre>${esc(l.text)}</pre></details>
${notice}`;
}

function samplesBlock(r: SetBuildReport): string {
  const icons = new Map(r.icons.map((b) => [b.entry.name, b.icon]));
  const figures = r.metadata.samples.map((name) => {
    const icon = icons.get(name);
    const picture = icon
      ? tile(icon, 48)
      : `<span class="stop">нет такой иконки</span>`;
    return `<figure>${picture}<figcaption>${esc(name)}</figcaption></figure>`;
  });
  return `<div class="samples">${figures.join("")}</div>`;
}

function suffixesBlock(m: SetMetadata): string {
  if (!m.suffixes) return "";
  const items = Object.entries(m.suffixes).map(
    ([suffix, title]) =>
      `<li><code>${suffix === "" ? "без суффикса" : esc(suffix)}</code> — ${esc(title)}</li>`,
  );
  return `<h3>Варианты</h3>
<p class="muted">Карта суффиксов (ADR-0002): по ней сайт группирует варианты одной иконки.</p>
<ul>${items.join("")}</ul>`;
}

function categoriesBlock(m: SetMetadata): string {
  if (m.categories.length === 0) {
    return `<p class="muted">Нет: в источнике нет категорий автора.</p>`;
  }
  const items = [...m.categories]
    .sort(([a, x], [b, y]) => y.length - x.length || order(a, b))
    .map(([title, list]) => `${esc(title)} (${list.length})`);
  return `<p class="names">${items.join(", ")}</p>`;
}

/** Выборка иконок с тегами: постоянная для набора, вразброс по алфавиту. */
function tagCards(r: SetBuildReport): string {
  const id = r.normalize.id;
  const picked = r.icons
    .map((b, index) => ({ b, index, key: sha1(`${id}:${b.entry.name}`) }))
    .sort((x, y) => order(x.key, y.key))
    .slice(0, TAG_SAMPLE)
    .sort((x, y) => x.index - y.index);
  return picked
    .map(({ b, index }) => {
      const name = b.entry.name;
      const meta = r.metadata.icons.get(name);
      const tags =
        meta && meta.tags.length > 0 ? meta.tags.map(esc).join(", ") : "—";
      const from = meta?.from === "author" ? "от автора" : "из имени";
      const categories =
        meta && meta.categories.length > 0
          ? meta.categories.map(esc).join(", ")
          : "—";
      return `<article class="meta-card">${tile(b.icon, 48)}<div><h4><a href="${cardLink(id, index, name)}">${esc(id)}:${esc(name)}</a></h4><p><b>Теги</b> <span class="muted">${from}</span>: ${tags}</p><p><b>Категории:</b> ${categories}</p></div></article>`;
    })
    .join("\n");
}

function setSection(r: SetBuildReport): string {
  const n = r.normalize;
  const m = r.metadata;
  const author = m.author.url
    ? `<a href="${esc(m.author.url)}">${esc(m.author.name)}</a>`
    : esc(m.author.name);
  const stops = m.stop
    .map((s) => `<p class="stop">СТОП — ${esc(s)}</p>`)
    .join("");
  const without =
    m.format && m.withoutAuthor.length > 0
      ? `<h3>Без тегов автора (${m.withoutAuthor.length})</h3>
<p class="muted">Им достались теги из частей имени.</p>
${namesList(m.withoutAuthor)}`
      : "";
  return `<h2 id="set-${esc(n.id)}">${esc(n.name)}</h2>
<p class="muted">${esc(n.id)} · ${esc(n.source)} · автор: ${author}</p>
${stops}
<h3>Лицензия</h3>
${licenseBlock(n.id, m.license)}
<h3>Витрина</h3>
${samplesBlock(r)}
${suffixesBlock(m)}
<h3>Категории (${m.categories.length})</h3>
${categoriesBlock(m)}
<h3>${Math.min(TAG_SAMPLE, r.icons.length)} иконок с тегами</h3>
<p class="muted">Выборка постоянная: при повторной сборке те же иконки. Ссылка ведёт на карточку в галерее.</p>
<div class="meta-cards">
${tagCards(r)}
</div>
${without}`;
}

/** Страница metadata.html: лицензии с полным текстом, витрины, категории и иконки с тегами. */
export function renderMetadataPage(sets: readonly SetBuildReport[]): string {
  return htmlPage(
    "Метаданные и лицензии",
    `body { max-width: 1440px; }${METADATA_STYLE}`,
    `<h1>Метаданные и лицензии</h1>
<p class="muted">ADR-0017: лицензия набора хранится целиком и подтверждается человеком; теги и категории — как у автора, теги строчными и без повторов; если тегов автора нет — части имени без суффикса варианта. Всё это записывается в data/{набор}/info.json, metadata.json, search.json и LICENSE.</p>
<nav><a href="index.html">Сводка сборки</a></nav>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Сводка</h2>
${summaryTable(sets)}
${sets.map(setSection).join("\n")}`,
  );
}
