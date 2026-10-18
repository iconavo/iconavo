// Отчёт санитайзера: короткий текст для терминала и HTML-страница с картинками «до/после».

import type { FixtureOutcome, IconPreview, SetSanitizeReport } from "./run.js";
import type { RemovalKind } from "./sanitize.js";

const KINDS: readonly RemovalKind[] = ["dangerous", "junk", "style", "unknown"];

const KIND_TITLES: Readonly<Record<RemovalKind, string>> = {
  dangerous: "Опасное (удалено)",
  junk: "Лишнее (удалено)",
  style: "Стили → атрибуты",
  unknown: "Неизвестное (удалено)",
};

const percent = (part: number, total: number) =>
  `${(total === 0 ? 0 : (part / total) * 100).toFixed(1).replace(".", ",")}%`;

/** «в 1 иконке», «в 21 иконке», «в 5 иконках». */
const inIcons = (n: number) =>
  `в ${n} ${n % 10 === 1 && n % 100 !== 11 ? "иконке" : "иконках"}`;

const kept = (r: SetSanitizeReport) => r.total - r.excluded.length;

/** Сводка по набору для терминала. */
export function formatSanitizeReport(r: SetSanitizeReport): string {
  const lines = [`${r.id} (${r.name}) — ${r.source}`];
  lines.push(
    `  Иконок: ${r.total} · без изменений: ${r.unchanged} · очищено: ${r.cleaned} · исключено: ${r.excluded.length} (${percent(r.excluded.length, r.total)}, порог 1%)`,
  );
  for (const kind of KINDS) {
    const items = r.removals.filter((x) => x.kind === kind);
    if (items.length === 0) continue;
    lines.push(`  ${KIND_TITLES[kind]}:`);
    for (const x of items.slice(0, 12)) {
      lines.push(`    ${x.what} — ${x.count} раз ${inIcons(x.icons)}`);
    }
    if (items.length > 12) lines.push(`    … и ещё ${items.length - 12}`);
  }
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
  lines.push(
    `  Проверки: фигуры потеряны — ${r.lostShapes.length}, атрибуты рисунка потеряны — ${r.lostAttrs.length}, проверку результата прошли ${kept(r) - r.unsafe.length} из ${kept(r)}`,
  );
  for (const name of r.lostShapes.slice(0, 5)) {
    lines.push(`    ПРОВЕРИТЬ ${name}: фигур стало меньше`);
  }
  for (const x of r.lostAttrs.slice(0, 5)) {
    lines.push(`    ПРОВЕРИТЬ ${x.name}: удалены ${x.attrs.join(", ")}`);
  }
  for (const x of r.unsafe.slice(0, 5)) {
    lines.push(`    ПРОВЕРИТЬ ${x.name}: ${x.problems.join("; ")}`);
  }
  if (r.stop.length === 0) lines.push("  Итог: можно обновлять");
  else for (const s of r.stop) lines.push(`  СТОП: ${s}`);
  return lines.join("\n");
}

const describe = (f: FixtureOutcome) =>
  f.result.status === "excluded"
    ? `исключена: ${f.result.reason}`
    : `очищена: ${f.result.removals.map((x) => `${x.what} ×${x.count}`).join(", ")}`;

/** Итог по «вредным» SVG для терминала. */
export function formatFixtures(fixtures: readonly FixtureOutcome[]): string {
  const excluded = fixtures.filter(
    (f) => f.result.status === "excluded",
  ).length;
  const lines = [
    `Вредные SVG: ${fixtures.length} файлов — очищено ${fixtures.length - excluded}, исключено ${excluded}`,
  ];
  for (const f of fixtures) lines.push(`  ${f.file} — ${describe(f)}`);
  return lines.join("\n");
}

const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** SVG как картинка: в <img> он не выполняет скриптов и ничего не загружает. */
const img = (svg: string, label: string) =>
  `<img src="data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}" width="64" height="64" alt="${esc(label)}">`;

const code = (text: string, limit = 2000) =>
  `<pre><code>${esc(text.length > limit ? `${text.slice(0, limit)}\n…` : text)}</code></pre>`;

const removalList = (items: readonly { what: string; count: number }[]) =>
  items.length === 0
    ? `<p class="muted">ничего не удалено</p>`
    : `<ul>${items.map((x) => `<li>${esc(x.what)} — ${x.count}</li>`).join("")}</ul>`;

function sampleCard(p: IconPreview): string {
  return `<figure class="card">
<figcaption>${esc(p.name)}</figcaption>
<div class="pair"><div class="tile">${img(p.before, `${p.name}: до`)}<span>до</span></div><div class="tile">${p.after ? img(p.after, `${p.name}: после`) : ""}<span>после</span></div></div>
${removalList(p.removals)}
</figure>`;
}

function setSection(r: SetSanitizeReport): string {
  const rows = KINDS.flatMap((kind) =>
    r.removals
      .filter((x) => x.kind === kind)
      .map(
        (x) =>
          `<tr><td>${esc(KIND_TITLES[kind])}</td><td>${esc(x.what)}</td><td class="num">${x.count}</td><td class="num">${x.icons}</td></tr>`,
      ),
  );
  const removals =
    rows.length === 0
      ? `<p>Ничего не удалено и не переведено: иконки набора уже чистые.</p>`
      : `<table><thead><tr><th>Вид</th><th>Что</th><th>Сколько раз</th><th>В скольких иконках</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const excluded =
    r.excluded.length === 0
      ? ""
      : `<h4>Исключённые иконки (${r.excluded.length})</h4>
<ul>${r.excluded.map((e) => `<li><b>${esc(e.name)}</b> — ${esc(e.reason)}</li>`).join("")}</ul>
${r.excludedPreviews.map((p) => `<details><summary>${esc(p.name)}: исходный файл</summary>${code(p.before)}</details>`).join("")}`;
  const checks = `<p>Фигуры потеряны: <b>${r.lostShapes.length}</b> · атрибуты рисунка потеряны: <b>${r.lostAttrs.length}</b> · независимую проверку результата прошли <b>${kept(r) - r.unsafe.length}</b> из ${kept(r)}</p>`;
  const verdict =
    r.stop.length === 0
      ? `<p class="ok">Итог: можно обновлять</p>`
      : r.stop.map((s) => `<p class="stop">СТОП: ${esc(s)}</p>`).join("");
  return `<section id="set-${esc(r.id)}">
<h3>${esc(r.name)} <span class="muted">${esc(r.id)} · ${esc(r.source)}</span></h3>
${verdict}
${removals}
${checks}
<h4>До и после</h4>
<div class="cards">${r.samples.map(sampleCard).join("")}</div>
${excluded}
</section>`;
}

function fixtureSection(f: FixtureOutcome): string {
  const status =
    f.result.status === "excluded"
      ? `<p class="stop">Исключена: ${esc(f.result.reason)}</p>`
      : `<p class="ok">Очищена</p>`;
  const after = f.after
    ? `<div class="tile">${img(f.after, `${f.file}: после`)}<span>после</span></div>${code(f.after)}`
    : `<p class="muted">Иконка исключена — результата нет.</p>`;
  return `<section class="fixture">
<h3>${esc(f.title)} <span class="muted">${esc(f.file)}</span></h3>
${status}
${removalList(f.result.removals)}
<div class="columns"><div><h4>Было</h4>${code(f.source)}</div><div><h4>Стало</h4>${after}</div></div>
</section>`;
}

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1c1c1e; --muted: #6b6b70; --line: #dcdce0; --ok: #1a7f37; --stop: #c62828; --code: #f4f4f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #141416; --fg: #ececf0; --muted: #9a9aa2; --line: #34343a; --ok: #4ac26b; --stop: #ff6b6b; --code: #1e1e22; } }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 28px; margin: 0 0 8px; } h2 { margin-top: 40px; border-bottom: 1px solid var(--line); padding-bottom: 6px; } h3 { margin: 28px 0 8px; } h4 { margin: 16px 0 8px; }
.muted { color: var(--muted); font-weight: normal; font-size: 0.9em; } .ok { color: var(--ok); font-weight: 600; } .stop { color: var(--stop); font-weight: 600; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; display: block; overflow-x: auto; } th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; } .num { text-align: right; font-variant-numeric: tabular-nums; }
.cards { display: flex; flex-wrap: wrap; gap: 12px; } .card { margin: 0; border: 1px solid var(--line); border-radius: 10px; padding: 12px; width: 230px; } .card figcaption { font-weight: 600; margin-bottom: 8px; overflow-wrap: anywhere; }
.pair { display: flex; gap: 12px; } .tile { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); } .tile img { background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
ul { margin: 6px 0; padding-left: 20px; } pre { background: var(--code); border-radius: 8px; padding: 10px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } @media (max-width: 720px) { .columns { grid-template-columns: 1fr; } }
.fixture { border-top: 1px solid var(--line); }
a { color: inherit; } nav { margin: 12px 0; }
`;

/** HTML-отчёт. Без отметок времени и с фиксированным порядком: одинаковый вход — одинаковый файл. */
export function renderSanitizeHtml(
  sets: readonly SetSanitizeReport[],
  fixtures: readonly FixtureOutcome[],
): string {
  const total = sets.reduce((n, r) => n + r.total, 0);
  const summary = sets
    .map(
      (r) =>
        `<tr><td><a href="#set-${esc(r.id)}"><b>${esc(r.name)}</b></a><br><span class="muted">${esc(r.source)}</span></td><td class="num">${r.total}</td><td class="num">${r.unchanged}</td><td class="num">${r.cleaned}</td><td class="num">${r.excluded.length} (${percent(r.excluded.length, r.total)})</td><td class="num">${r.dangerous}</td><td>${r.stop.length === 0 ? `<span class="ok">можно обновлять</span>` : `<span class="stop">СТОП</span>`}</td></tr>`,
    )
    .join("");
  const fixturesExcluded = fixtures.filter(
    (f) => f.result.status === "excluded",
  ).length;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Очистка SVG — отчёт</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Очистка SVG</h1>
<p class="muted">Санитайзер по белому списку (ADR-0013): опасное и лишнее удаляется, непонятное исключает иконку. Набор останавливается, если исключено больше 1% иконок или найдено опасное.</p>
<nav><a href="#summary">Сводка</a> · <a href="#sets">Наборы</a> · <a href="#fixtures">Вредные SVG</a></nav>
<h2 id="summary">Сводка</h2>
<table><thead><tr><th>Набор</th><th>Иконок</th><th>Без изменений</th><th>Очищено</th><th>Исключено</th><th>Опасное</th><th>Итог</th></tr></thead>
<tbody>${summary}</tbody></table>
<p>Всего иконок: <b>${total}</b>.</p>
<h2 id="sets">Наборы</h2>
${sets.map(setSection).join("\n")}
<h2 id="fixtures">Вредные SVG</h2>
<p>Проверочные файлы из <code>packages/pipeline/fixtures/harmful-svg/</code>: ${fixtures.length} шт., очищено ${fixtures.length - fixturesExcluded}, исключено ${fixturesExcluded}. «Было» показано текстом и не выполняется.</p>
${fixtures.map(fixtureSection).join("\n")}
</body>
</html>
`;
}
