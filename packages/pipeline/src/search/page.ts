// Страница прототипа поиска (шаг 12, ADR-0048): форма запроса и колонки результатов рядом — текст и
// гибрид каждой модели. Без скриптов, как отчёты: картинки — в адресах data:, форма уходит GET-запросом.
// Карточку результата рисует и галерея промахов в отчёте замера (eval/report.ts).

import { iconToSvg } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import type { Catalog } from "./catalog.js";
import type { Field, MatchKind } from "./config.js";
import type { Mode, Ranked } from "./hybrid.js";
import type { WordMatch } from "./text.js";

const FIELD_NAMES: Record<Field, string> = {
  name: "имя",
  tags: "теги",
  synonyms: "синонимы",
};

const KIND_NAMES: Record<MatchKind, string> = {
  exact: "",
  prefix: "начало слова",
  typo1: "опечатка",
  typo2: "две опечатки",
};

export const MODE_NAMES: Record<Mode, string> = {
  hybrid: "Гибрид",
  vector: "Только смысл",
  text: "Только текст",
};

const number = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

/** «+3 варианта», «+5 оттенков». */
function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** Почему карточка нашлась: совпавшие слова с полем, похожесть по смыслу, точное имя. */
function whyLine(r: Ranked, matches: readonly WordMatch[] | undefined): string {
  const parts: string[] = [];
  if (r.exact) parts.push(`<span class="badge">точное имя</span>`);
  for (const m of matches ?? []) {
    const kind = KIND_NAMES[m.kind];
    const word =
      m.word === m.query ? esc(m.word) : `${esc(m.query)} → ${esc(m.word)}`;
    parts.push(
      `${word} <span class="muted">(${FIELD_NAMES[m.field]}${kind ? `, ${kind}` : ""})</span>`,
    );
  }
  if (r.cosine !== undefined) {
    parts.push(`<span class="muted">смысл ${number(r.cosine, 3)}</span>`);
  }
  return parts.join(" · ");
}

export interface CardOptions {
  /** Совпадения слов у документов — из текстовой части. */
  matches?: ReadonlyMap<number, readonly WordMatch[]>;
  /** Отметка разметки эталона у карточки: подходит, частично, нет. */
  mark?: (doc: number) => string | undefined;
}

/** Одна карточка: иконка, имя, варианты или оттенки, почему нашлась. */
export function resultCard(
  catalog: Catalog,
  r: Ranked,
  options: CardOptions = {},
): string {
  const doc = catalog.docs[r.doc];
  if (!doc) return "";
  const extra: string[] = [];
  if (doc.variants.length > 0) {
    const n = doc.variants.length;
    extra.push(`+${n} ${plural(n, "вариант", "варианта", "вариантов")}`);
  }
  if (doc.tones.length > 0) {
    const n = doc.tones.length;
    extra.push(`+${n} ${plural(n, "оттенок", "оттенка", "оттенков")}`);
  }
  const mark = options.mark?.(r.doc);
  return `<div class="card${mark ? ` ${mark}` : ""}"><img class="tile" src="${svgDataUri(iconToSvg(doc.icon))}" width="40" height="40" alt=""><div><code>${esc(doc.id)}</code>${extra.length > 0 ? ` <span class="muted">${extra.join(", ")}</span>` : ""}<div class="why">${whyLine(r, options.matches?.get(r.doc))}</div></div></div>`;
}

export interface Column {
  title: string;
  /** Под заголовком: доля смысла, длина, время ответа. */
  subtitle?: string;
  notes?: string[];
  results: Ranked[];
}

/** Колонка результатов: первая пятёрка выделена — её считает Hit@5 (ADR-0021). */
export function resultColumn(
  catalog: Catalog,
  column: Column,
  options: CardOptions = {},
): string {
  const items = column.results
    .map(
      (r, i) =>
        `<li${i < 5 ? ` class="top"` : ""}><span class="rank">${i + 1}</span>${resultCard(catalog, r, options)}</li>`,
    )
    .join("");
  const notes = (column.notes ?? [])
    .map((n) => `<p class="note">${esc(n)}</p>`)
    .join("");
  return `<section class="col"><h3>${esc(column.title)}</h3>${column.subtitle ? `<p class="muted">${esc(column.subtitle)}</p>` : ""}${notes}${items ? `<ol>${items}</ol>` : `<p class="muted">ничего не нашлось</p>`}</section>`;
}

export const SEARCH_STYLE = `
body { max-width: 1680px; }
form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 4px; }
input[type=search] { flex: 1 1 320px; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); }
select, button { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--code); color: var(--fg); }
button { cursor: pointer; font-weight: 600; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; margin-top: 12px; }
.col { border: 1px solid var(--line); border-radius: 10px; padding: 10px; min-width: 0; }
.col h3 { margin: 0 0 2px; }
.col ol { margin: 8px 0 0; padding: 0; list-style: none; }
.col li { display: flex; gap: 6px; align-items: flex-start; padding: 3px 0; }
.rank { flex: none; width: 1.6em; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; padding-top: 2px; }
.col li.top { font-weight: 600; }
.col li:nth-child(5) { border-bottom: 1px dashed var(--line); padding-bottom: 6px; margin-bottom: 4px; }
.card { display: flex; gap: 8px; align-items: flex-start; font-weight: normal; }
.card code { font-weight: inherit; }
.tile { display: block; flex: none; background: #ffffff; border: 1px solid var(--line); border-radius: 6px; padding: 3px; object-fit: contain; }
.why { font-size: 0.85em; overflow-wrap: anywhere; }
.badge { background: var(--ok); color: #ffffff; border-radius: 4px; padding: 0 5px; font-size: 0.85em; }
.note { color: var(--stop); margin: 4px 0; font-size: 0.9em; }
.card.fits .tile { border: 2px solid var(--ok); }
.card.partial .tile { border: 2px solid #c99a00; }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

export interface SearchPage {
  query: string;
  set?: string;
  mode: Mode;
  sets: { id: string; name: string }[];
  /** Слова, по которым шла текстовая часть: без служебных. */
  words: string[];
  columns: Column[];
  notes: string[];
  /** Совпадения слов у документов. */
  matches?: ReadonlyMap<number, readonly WordMatch[]>;
}

/** Страница поиска целиком: форма, заметки и колонки. */
export function renderSearchPage(catalog: Catalog, page: SearchPage): string {
  const setOptions = [
    `<option value="">все наборы</option>`,
    ...page.sets.map(
      (s) =>
        `<option value="${esc(s.id)}"${s.id === page.set ? " selected" : ""}>${esc(s.name)}</option>`,
    ),
  ].join("");
  const modeOptions = (Object.keys(MODE_NAMES) as Mode[])
    .map(
      (m) =>
        `<option value="${m}"${m === page.mode ? " selected" : ""}>${MODE_NAMES[m]}</option>`,
    )
    .join("");
  const notes = page.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("");
  const options: CardOptions = page.matches ? { matches: page.matches } : {};
  const body =
    page.query === ""
      ? `<p class="muted">Введите запрос на русском или английском. Точное имя иконки (<code>shopping-cart</code>, <code>lucide:house</code>) встаёт первым; служебные слова («в», «для», «иконка») не ищутся. Векторы ваших запросов считаются через Polza, около 2 секунд, повтор — из кэша. Для настройки поиска эти запросы не используются.</p>`
      : `<p class="muted">Слова текстовой части: ${page.words.length > 0 ? page.words.map((w) => `<code>${esc(w)}</code>`).join(" ") : "нет — одни служебные"}. Первая пятёрка выделена — её считает Hit@5.</p>
${notes}<div class="cols">${page.columns.map((c) => resultColumn(catalog, c, options)).join("")}</div>`;
  return htmlPage(
    page.query === "" ? "Поиск иконок" : `${page.query} — поиск иконок`,
    SEARCH_STYLE,
    `<h1>Поиск иконок — прототип</h1>
<p class="muted">ADR-0048: текстовая часть по именам, тегам и синонимам ru/en плюс смысловая по векторам трёх моделей; точное имя — наверху. Отчёты: <a href="/reports/eval/index.html">замер</a>, <a href="/reports/eval/judge.html">разметка эталона</a>, <a href="/reports/embed/nearest.html">ближайшие иконки</a>.</p>
<form method="get" action="/"><input type="search" name="q" value="${esc(page.query)}" placeholder="например, корзина или trash" autofocus maxlength="200"><select name="set">${setOptions}</select><select name="mode">${modeOptions}</select><button type="submit">Найти</button></form>
${body}`,
  );
}
