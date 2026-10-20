// Отчёт журнала (шаг 8, ADR-0018): строки для терминала, раздел в сводке галереи сборки и страница
// changelog.html — переименованные («было → стало»), скрытые, вернувшиеся и изменившиеся иконки
// картинками, новые алиасы и текст CHANGELOG.md. Без скриптов, как вся галерея.

import type { SetBuildReport } from "../build/run.js";
import { iconToSvg, type NormalizedIcon } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import { groupDigits, humanDate, needsApproval } from "./journal.js";
import type { SetChangelog } from "./run.js";
import { resolve, visibleCount } from "./state.js";

/** Сколько карточек каждого вида показывать; остальные — списком имён. */
export const CARD_LIMIT = 200;

const CHECKLIST = [
  "«Требуют вашего одобрения»: скрытые иконки действительно удалены у автора, а у переименованных рисунок «было» совпадает со «стало».",
  "Новые алиасы ведут на подходящие иконки — пролистайте несколько.",
  "Текст CHANGELOG.md читается без пояснений.",
];

export const CHANGELOG_STYLE = `
.log-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; }
.log-card { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.log-card p { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.log-card .arrow { color: var(--muted); }
.tile { display: block; flex: none; background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 6px; object-fit: contain; }
.names { overflow-wrap: anywhere; font-size: 13px; }
.approve { border: 2px solid var(--stop); border-radius: 10px; padding: 4px 14px 12px; margin: 12px 0; }
details { margin: 8px 0; } summary { cursor: pointer; font-weight: 600; }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

const tile = (icon: NormalizedIcon | undefined, size = 40) =>
  icon
    ? `<img class="tile" src="${svgDataUri(iconToSvg(icon))}" width="${size}" height="${size}" alt="">`
    : `<span class="stop">нет рисунка</span>`;

/** Строки журнала для сводки набора в терминале. */
export function formatChangelog(c: SetChangelog): string[] {
  const visible = visibleCount(c.state);
  const counts = `иконок ${visible} · скрытых ${c.state.icons.size - visible} · алиасов ${c.state.aliases.size}`;
  if (c.release === "same") {
    return [`  Журнал: без изменений · версия ${c.version} · ${counts}`];
  }
  const head =
    c.previous === undefined
      ? `первая запись · версия ${c.version}`
      : `новый выпуск · версия ${c.version} (была ${c.previous})`;
  const lines = [`  Журнал: ${head} · ${counts}`];
  const ch = c.changes;
  const parts = (
    [
      ["добавлено", ch.added.length],
      ["изменено", ch.changed.length],
      ["вернулось", ch.restored.length],
      ["скрыто", ch.hidden.length],
      ["переименовано", ch.renamed.size],
      ["новых алиасов", ch.aliases.size],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([title, n]) => `${title} ${n}`);
  if (parts.length > 0) lines.push(`  Изменения: ${parts.join(" · ")}`);
  if (ch.hidden.length > 0 || ch.renamed.size > 0) {
    lines.push(
      "  Требуют вашего одобрения: скрытия и переименования — в CHANGELOG.md и changelog.html",
    );
  }
  if (c.skipped.length > 0) {
    lines.push(
      `  Прежние имена от автора пропущены: ${c.skipped.length} — список в changelog.html`,
    );
  }
  return lines;
}

const newest = (c: SetChangelog) => c.file.releases[0];

function approvalCell(c: SetChangelog): string {
  const r = newest(c);
  if (c.release === "same" || !r) return `<span class="muted">—</span>`;
  return needsApproval(r)
    ? `<span class="stop">нужно ваше одобрение</span>`
    : `<span class="ok">не нужно</span>`;
}

function summaryTable(sets: readonly SetBuildReport[]): string {
  const rows = sets.map((r) => {
    const c = r.changelog;
    const ch = c.changes;
    const id = esc(r.normalize.id);
    const release =
      c.release === "same"
        ? "без изменений"
        : c.previous === undefined
          ? "первая запись"
          : `новый, была ${esc(c.previous)}`;
    const nums =
      c.release === "same"
        ? `<td class="num" colspan="6">—</td>`
        : [
            ch.added.length,
            ch.changed.length,
            ch.restored.length,
            ch.hidden.length,
            ch.renamed.size,
            ch.aliases.size,
          ]
            .map((n) => `<td class="num">${n}</td>`)
            .join("");
    return `<tr><td><b><a href="changelog.html#set-${id}">${esc(r.normalize.name)}</a></b><br><span class="muted">${id}</span></td><td><code>${esc(c.version)}</code></td><td>${release}</td>${nums}<td>${approvalCell(c)}</td></tr>`;
  });
  return `<table><thead><tr><th>Набор</th><th>Версия</th><th>Выпуск</th><th>Добавлены</th><th>Изменены</th><th>Вернулись</th><th>Скрыты</th><th>Переименованы</th><th>Новые алиасы</th><th>Одобрение</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>`;
}

/** Раздел «Журнал изменений» для сводки галереи сборки. */
export function changelogSection(sets: readonly SetBuildReport[]): string {
  return `<h2>Журнал изменений</h2>
<p class="muted">ADR-0018: сравнение с прошлой версией набора, версия набора, скрытые иконки и переименования. Картинки и текст CHANGELOG.md — <a href="changelog.html">changelog.html</a>.</p>
${summaryTable(sets)}`;
}

/** Карточки «имя и картинка»; больше CARD_LIMIT — остальные списком имён. */
function cards(
  title: string,
  hint: string,
  items: readonly { html: string; name: string }[],
): string {
  if (items.length === 0) return "";
  const rest = items.slice(CARD_LIMIT).map((i) => esc(i.name));
  const more =
    rest.length > 0
      ? `<p class="names muted">… и ещё ${rest.length}: ${rest.join(", ")}</p>`
      : "";
  return `<h3>${esc(title)} (${groupDigits(items.length)})</h3>
<p class="muted">${esc(hint)}</p>
<div class="log-cards">
${items
  .slice(0, CARD_LIMIT)
  .map((i) => i.html)
  .join("\n")}
</div>${more}`;
}

const pairCard = (
  from: string,
  was: NormalizedIcon | undefined,
  to: string,
  now: NormalizedIcon | undefined,
) => ({
  name: from,
  html: `<article class="log-card">${tile(was)}<span class="arrow">→</span>${tile(now)}<p><code>${esc(from)}</code> <span class="arrow">→</span> <code>${esc(to)}</code></p></article>`,
});

const oneCard = (name: string, icon: NormalizedIcon | undefined) => ({
  name,
  html: `<article class="log-card">${tile(icon)}<p><code>${esc(name)}</code></p></article>`,
});

function setSection(r: SetBuildReport): string {
  const c = r.changelog;
  const ch = c.changes;
  const before = c.before;
  const was = (name: string) => (before ? resolve(before, name) : undefined);
  const now = (name: string) => resolve(c.state, name);
  const stops = c.stop
    .map((s) => `<p class="stop">СТОП — ${esc(s)}</p>`)
    .join("");
  const release = newest(c);
  const head =
    c.release === "same"
      ? `версия <code>${esc(c.version)}</code> не изменилась — журнал тот же`
      : `${c.previous === undefined ? "первая запись журнала" : `новый выпуск, прошлая версия <code>${esc(c.previous)}</code>`} · версия <code>${esc(c.version)}</code>${release ? ` · ${esc(humanDate(release.date))}` : ""}`;

  const parts: string[] = [];
  if (c.release === "new") {
    const approval = [
      cards(
        "Скрыты",
        "Автор удалил иконку: она осталась в icons.json со старым рисунком и пометкой hidden, работает по имени, но не видна в каталоге и поиске.",
        ch.hidden.map((name) => oneCard(name, now(name))),
      ),
      cards(
        "Переименованы",
        "Старое имя пропало, а такой же рисунок появился под новым: старое имя стало алиасом нового. Слева — рисунок прошлой версии, справа — новой.",
        [...ch.renamed].map(([from, to]) =>
          pairCard(from, was(from), to, now(to)),
        ),
      ),
    ].filter(Boolean);
    if (approval.length > 0) {
      parts.push(`<section class="approve"><h3>Требуют вашего одобрения</h3>
<p class="muted">Скрытия и переименования вы одобряете лично (ADR-0019): этот блок есть и в CHANGELOG.md.</p>
${approval.join("\n")}</section>`);
    }
    parts.push(
      cards(
        "Вернулись",
        "Были скрыты, а теперь снова есть у автора.",
        ch.restored.map((name) => oneCard(name, now(name))),
      ),
      cards(
        "Изменены",
        "Отпечаток рисунка другой. Слева — прошлая версия, справа — новая; насколько заметно отличие, показывает qc.html.",
        ch.changed.map((name) => pairCard(name, was(name), name, now(name))),
      ),
      cards(
        "Добавлены",
        "Новые иконки.",
        ch.added.map((name) => oneCard(name, now(name))),
      ),
      cards(
        "Новые алиасы",
        "Новые имена уже известных иконок: прежние имена от автора и новые варианты.",
        [...ch.aliases].map(([name, parent]) => ({
          name,
          html: `<article class="log-card">${tile(now(parent))}<p><code>${esc(name)}</code> <span class="arrow">→</span> <code>${esc(parent)}</code></p></article>`,
        })),
      ),
    );
  }
  if (c.skipped.length > 0) {
    parts.push(`<h3>Прежние имена от автора, которые не стали алиасами (${c.skipped.length})</h3>
<ul>${c.skipped.map((s) => `<li><code>${esc(s.name)}</code> → <code>${esc(s.parent)}</code> — ${esc(s.reason)}</li>`).join("")}</ul>`);
  }
  const markdown = c.files?.find((f) => f.name === "CHANGELOG.md")?.text;
  if (markdown !== undefined) {
    parts.push(
      `<details><summary>CHANGELOG.md</summary><pre>${esc(markdown)}</pre></details>`,
    );
  }
  const body = parts.filter(Boolean).join("\n");
  return `<h2 id="set-${esc(r.normalize.id)}">${esc(r.normalize.name)}</h2>
<p class="muted">${esc(r.normalize.id)} · ${esc(r.normalize.source)} · ${head}</p>
${stops}
${body || "<p>Изменений нет.</p>"}`;
}

/** Страница changelog.html: что изменилось в каждом наборе — картинками и текстом журнала. */
export function renderChangelogPage(sets: readonly SetBuildReport[]): string {
  return htmlPage(
    "Журнал изменений",
    `body { max-width: 1440px; }${CHANGELOG_STYLE}`,
    `<h1>Журнал изменений</h1>
<p class="muted">ADR-0018: сборка сравнивается с версией набора в main. Имена не пропадают: иконка, которую удалил автор, скрывается, переименованная оставляет старое имя алиасом. Версия набора меняется, когда меняется хоть что-то в icons.json. Журнал записывается в data/{набор}/changelog.json и CHANGELOG.md.</p>
<nav><a href="index.html">Сводка сборки</a></nav>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Сводка</h2>
${summaryTable(sets)}
${sets.map(setSection).join("\n")}`,
  );
}
