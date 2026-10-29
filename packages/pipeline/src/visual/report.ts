// Отчёт визуального сравнения (фаза 3, шаг 9): таблица «набор × браузер» для терминала — сколько имён
// разошлось с эталоном больше допуска у тега и у React, — ниже отличия в допуске (сглаживание) и
// проблемы; сводка для страницы запуска CI (Markdown) и страница .cache/reports/visual/index.html с
// теми же цифрами и картинками: расхождения и примеры отличий в допуске.

import { esc, htmlPage } from "../report/html.js";
import { markdownTable, textTable } from "../report/table.js";
import { BROWSER_TITLES } from "../sandbox/browser.js";
import { CHUNK, MAX_SHOWN, SCALE, TOLERANCE } from "./config.js";
import {
  type Mismatch,
  type Renderer,
  type VisualResult,
  visualFailed,
} from "./run.js";

const RENDERERS: [Renderer, string][] = [
  ["tag", "тег"],
  ["react", "React"],
];

/** Допуск словами: «0,5%», 12 пикселей при 48 px. */
const tolerance = `${String(TOLERANCE * 100).replace(".", ",")}% пикселей иконки — ${Math.ceil(48 * 48 * TOLERANCE)} при 48 px`;

/** Наборы по порядку первого браузера, где они есть. */
const setIds = (results: VisualResult[]) => [
  ...new Set(results.flatMap((r) => r.sets.map((s) => s.set))),
];

const seconds = (ms: number) => `${(ms / 1000).toFixed(0)} с`;

/** Ячейка «набор × браузер»: расхождения тега / React, или сбой. */
function cell(r: VisualResult, set: string): string {
  if (r.failure) return "сбой";
  const s = r.sets.find((x) => x.set === set);
  return s ? `${s.counts.tag} / ${s.counts.react}` : "—";
}

const head = (results: VisualResult[]) => [
  "Набор",
  "Имён",
  ...results.map((r) => `${BROWSER_TITLES[r.browser]}: тег / React`),
];

function rows(results: VisualResult[]): string[][] {
  return setIds(results).map((set) => {
    const names = results
      .flatMap((r) => r.sets)
      .find((s) => s.set === set)?.names;
    return [set, String(names ?? "—"), ...results.map((r) => cell(r, set))];
  });
}

/** Отличия в допуске: по строке на браузер и набор, где они есть. */
const noise = (results: VisualResult[]) =>
  results.flatMap((r) =>
    r.sets
      .filter((s) => s.noise.tag.count + s.noise.react.count > 0)
      .map(
        (s) =>
          `${BROWSER_TITLES[r.browser]}, ${s.set}: тег — ${s.noise.tag.count}, React — ${s.noise.react.count}; больше всего — ${Math.max(s.noise.tag.max, s.noise.react.max)} пикс.`,
      ),
  );

const problems = (results: VisualResult[]) =>
  results.flatMap((r) => [
    ...(r.failure ? [`${BROWSER_TITLES[r.browser]}: ${r.failure}`] : []),
    ...r.problems.map((p) => `${BROWSER_TITLES[r.browser]}: ${p}`),
  ]);

const summary = (results: VisualResult[]) =>
  visualFailed(results)
    ? "Итог: есть расхождения или проблемы."
    : "Итог: все иконки через пакет — тег и React — выглядят так же, как SVG статики, во всех проверенных браузерах.";

export function formatVisual(results: VisualResult[]): string[] {
  const lines = [textTable(head(results), rows(results), 1)];
  const time = results
    .filter((r) => !r.failure)
    .map(
      (r) =>
        `${BROWSER_TITLES[r.browser]} — ${seconds(r.sets.reduce((n, s) => n + s.ms, 0))}`,
    );
  if (time.length > 0) lines.push("", `Время: ${time.join(", ")}.`);
  const smooth = noise(results);
  if (smooth.length > 0) {
    lines.push(
      "",
      `В допуске (сглаживание краёв, до ${tolerance}):`,
      ...smooth.map((n) => `  ${n}`),
    );
  }
  const list = problems(results);
  if (list.length > 0) {
    lines.push("", "Проблемы:", ...list.slice(0, 20).map((p) => `  ${p}`));
  }
  lines.push("", summary(results));
  return lines;
}

/** Сводка для страницы запуска CI. */
export function markdownVisual(results: VisualResult[]): string {
  const smooth = noise(results);
  const list = problems(results);
  return [
    "### Визуальное сравнение (pnpm visual)",
    "",
    `Каждое имя набора — иконки и алиасы — через тег и React рядом с SVG статики; в ячейках — сколько имён разошлось больше допуска (${tolerance}).`,
    "",
    markdownTable(head(results), rows(results)),
    "",
    ...(smooth.length > 0
      ? [
          "В допуске — сглаживание краёв:",
          "",
          ...smooth.map((n) => `- ${n}`),
          "",
        ]
      : []),
    ...(list.length > 0
      ? ["Проблемы:", "", ...list.slice(0, 20).map((p) => `- ${p}`), ""]
      : []),
    summary(results),
    "",
  ].join("\n");
}

const STYLE = `
.cells { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
figure { margin: 0; border: 1px solid var(--line); border-radius: 12px; padding: 8px; }
figure .row { display: flex; gap: 8px; align-items: flex-start; }
figure img { background: #fff; image-rendering: pixelated; border: 1px solid var(--line); }
figcaption { font-size: 13px; margin-top: 6px; overflow-wrap: anywhere; }
td.ok { color: var(--ok); font-weight: 600; } td.stop { color: var(--stop); font-weight: 600; }
`;

const figure = (m: Mismatch, title: string) =>
  `<figure><div class="row"><img alt="эталон" src="${m.images.ref}"><img alt="${title}" src="${m.images.own}"><img alt="разница" src="${m.images.diff}"></div><figcaption><code>${esc(m.icon)}</code> — ${m.pixels} пикс.: эталон, ${title}, разница</figcaption></figure>`;

/** Картинки: расхождения или примеры отличий в допуске. */
function gallery(results: VisualResult[], kind: "shown" | "noise"): string {
  const parts: string[] = [];
  for (const r of results) {
    for (const s of r.sets) {
      for (const [renderer, title] of RENDERERS) {
        const shown =
          kind === "shown" ? s.shown[renderer] : s.noise[renderer].shown;
        const total =
          kind === "shown" ? s.counts[renderer] : s.noise[renderer].count;
        if (shown.length === 0) continue;
        const more =
          total > shown.length ? ` — первые ${shown.length} из ${total}` : "";
        parts.push(
          `<h3>${esc(BROWSER_TITLES[r.browser])}, ${esc(s.set)}, ${title}${more}</h3><div class="cells">${shown
            .map((m) => figure(m, title))
            .join("")}</div>`,
        );
      }
    }
  }
  return parts.join("\n");
}

export function renderVisualReport(results: VisualResult[]): string {
  const failed = visualFailed(results);
  const list = problems(results);
  const smooth = noise(results);
  const body = rows(results)
    .map(
      (row) =>
        `<tr>${row
          .map((value, i) => {
            const status =
              i < 2
                ? ""
                : value === "0 / 0"
                  ? ' class="ok"'
                  : value === "—"
                    ? ""
                    : ' class="stop"';
            return `<td${status}>${esc(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("\n");
  const mismatches = gallery(results, "shown");
  const examples = gallery(results, "noise");
  return htmlPage(
    "Визуальное сравнение: пакет и SVG статики",
    STYLE,
    `<h1>Визуальное сравнение: пакет и SVG статики</h1>
<p class="muted">pnpm visual: каждое имя пяти наборов — иконки и алиасы — рисуется тегом &lt;iconavo-icon&gt; и компонентом React (серверный HTML, как у Next.js) рядом с эталоном — тем же SVG-файлом, что отдаёт cdn.iconavo.dev, открытым как картинка. Размер — ${SCALE} px на единицу сетки, страницы по ${CHUNK} имён. Сравнение — pixelmatch с порогом контроля качества: сглаживание краёв он не засчитывает. Расхождение — отличающихся пикселей больше допуска: ${tolerance}. SVG-картинку и тот же SVG в странице браузер сглаживает по-разному, поэтому у иконок с мелкими деталями расходятся несколько пикселей края — это «в допуске». На каждой странице есть контрольная клетка, которую пакет нарочно рисует иначе: проверка обязана её поймать.</p>
<p class="${failed ? "stop" : "ok"}">${esc(summary(results))}</p>
${list.length > 0 ? `<h2>Проблемы</h2><ul>${list.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<table><thead><tr>${head(results)
      .map((h) => `<th>${esc(h)}</th>`)
      .join("")}</tr></thead><tbody>
${body}
</tbody></table>
<p class="muted">В ячейках — сколько имён разошлось с эталоном больше допуска у тега и у React. Картинками — не больше ${MAX_SHOWN} на набор и вид отрисовки.</p>
${mismatches ? `<h2>Расхождения</h2>${mismatches}` : ""}
${smooth.length > 0 ? `<h2>В допуске — сглаживание краёв</h2><ul>${smooth.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p class="muted">Примеры: эталон, отрисовка пакета и карта разницы — красным пиксели, которые у пакета светлее или пропали, синим — темнее или появились; бледно-серым — совпадающее и сглаживание: его pixelmatch не считает.</p>${examples}` : ""}`,
  );
}
