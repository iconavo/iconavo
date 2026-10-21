// Отчёты эмбеддингов (шаг 11, ADR-0047): строки для терминала, таблица готовности и две страницы —
// .cache/reports/embed/index.html (прогон, готовность, чем отличаются модели) и nearest.html
// (ближайшие иконки к запросам). Без скриптов, как все отчёты: картинки — в адресах data:.

import { iconToSvg } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import { textTable } from "../report/table.js";
import { API_URL, TEXT_VERSION, TOP_TERMINAL } from "./config.js";
import { formatRub, type Spent } from "./cost.js";
import {
  median,
  type NearestReport,
  type Neighbor,
  overlap,
  type QueryResult,
} from "./nearest.js";
import type { EmbedReport, ModelStatus } from "./run.js";

const tokens = (n: number) => n.toLocaleString("ru-RU");

export const formatMb = (bytes: number) =>
  `${(bytes / 1e6).toFixed(1).replace(".", ",")} МБ`;

/** «850 мс», «1,2 с», «2 мин 5 с». */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} с`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

const score = (n: number) => n.toFixed(3).replace(".", ",");

/** Символов на токен — по факту прогонов; токенов нет — «—». */
const charsPerToken = (s: { chars: number; tokens: number }) =>
  s.tokens > 0 ? (s.chars / s.tokens).toFixed(2).replace(".", ",") : "—";

const sumSpent = (cells: readonly { spent: Spent }[]) =>
  cells.reduce(
    (n, c) => ({
      texts: n.texts + c.spent.texts,
      tokens: n.tokens + c.spent.tokens,
      chars: n.chars + c.spent.chars,
      rub: n.rub + c.spent.rub,
    }),
    { texts: 0, tokens: 0, chars: 0, rub: 0 },
  );

/** Сводка прогона для терминала: наборы, затем каждая модель. */
export function formatEmbedReport(r: EmbedReport): string {
  const lines: string[] = [];
  for (const s of r.sets) {
    const missing =
      s.missing.length > 0
        ? ` · без описаний ${s.missing.length} — сначала pnpm enrich ${s.id}`
        : "";
    lines.push(
      `${s.id} — ${s.name}: базовых иконок ${s.bases}, с описаниями ${s.withText}${missing}`,
    );
    for (const stop of s.stop) lines.push(`  СТОП — ${stop}`);
  }
  for (const m of r.models) {
    lines.push(
      "",
      `${m.model.key} — ${m.model.id} · длина вектора ${m.model.dims} · ${formatRub(m.model.rubPerMillion)} за млн токенов`,
    );
    for (const s of m.sets) {
      const parts = [`из кэша ${s.cached}`];
      if (s.todo > 0) {
        parts.push(`к отправке ${s.todo} (оценка ${formatRub(s.estimate)})`);
        // До отправки (--dry-run, «СТОП») посчитанных нет — строка была бы лишней.
        if (s.written) parts.push(`посчитано ${s.computed}`);
      }
      if (s.spent.requests > 0) {
        parts.push(`токенов ${tokens(s.spent.tokens)}`, formatRub(s.spent.rub));
      }
      parts.push(`векторов на диске ${s.stored} (${formatMb(s.bytes)})`);
      lines.push(`  ${s.id}: ${parts.join(" · ")}`);
      for (const note of s.notes) lines.push(`    ${note}`);
    }
    const batch = median(m.batchMs);
    if (batch !== undefined) {
      lines.push(
        `  Отправка: ${formatMs(m.ms)} · пачек ${m.batchMs.length} · медиана ответа на пачку до ${m.model.batchSize} текстов — ${formatMs(batch)}`,
      );
    }
    for (const stop of m.stop) lines.push(`  СТОП — ${stop}`);
  }
  const calculated =
    r.spent.rubCalculated > 0
      ? ` (из них по цене из конфига ${formatRub(r.spent.rubCalculated)})`
      : "";
  lines.push(
    "",
    `Оценка до отправки: ${formatRub(r.estimate)} · потрачено: ${formatRub(r.spent.rub)}${calculated}`,
  );
  for (const stop of r.stop) lines.push(`СТОП — ${stop}`);
  return lines.join("\n");
}

/** Таблица готовности «модель × набор»: векторов по текущему тексту / базовых с описаниями. */
export function formatEmbedTable(status: readonly ModelStatus[]): string {
  const ids = status[0]?.sets.map((s) => s.id) ?? [];
  const rows = status.map((m) => {
    const fresh = m.sets.reduce((n, s) => n + s.fresh, 0);
    const all = m.sets.reduce((n, s) => n + s.withText, 0);
    return [
      m.model.key,
      ...m.sets.map((s) => `${s.fresh}/${s.withText}`),
      `${fresh}/${all}`,
    ];
  });
  return textTable(["Модель", ...ids, "Всего"], rows);
}

export const EMBED_STYLE = `
.tile { display: block; flex: none; background: #ffffff; border: 1px solid var(--line); border-radius: 6px; padding: 3px; object-fit: contain; }
.nn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 12px; }
.nn-col { border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
.nn-col h4 { margin: 0 0 6px; }
.nn-list { margin: 0; padding-left: 26px; }
.nn-list li { padding: 2px 0; }
.nn-list li > span { display: inline-flex; gap: 8px; align-items: center; vertical-align: middle; }
.nn-list li.top code { font-weight: 600; }
.nn-list .both::after { content: " ●"; color: var(--ok); }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

const CHECKLIST = [
  "В таблице готовности у каждой модели векторов столько же, сколько базовых иконок с описаниями.",
  "Повторный запуск pnpm embed отправляет 0 текстов и стоит 0 ₽.",
  "Ближайшие иконки к запросам похожи на правду — страница nearest.html (команда pnpm nearest).",
];

const MODELS_TEXT = `<ul>
<li><b>Цена</b> — за токены текста. Токен — кусок слова; русский текст дробится мельче английского. Весь каталог стоит десятки рублей, а вектор одного поискового запроса — доли копейки, поэтому модель выбирают по качеству поиска — замер на шаге 12.</li>
<li><b>Скорость</b> бывает двух видов. Разовая — посчитать весь каталог: это колонка «Ответ на пачку», минуты на модель. Постоянная — вектор каждого поискового запроса на сайте, то есть задержка поиска: её показывает nearest.html.</li>
<li><b>Длина вектора</b> — сколько чисел хранится на иконку: длиннее — больше места и чуть медленнее поиск. Все три модели умеют укорачивать вектор без пересчёта, длину подберём на шаге 12.</li>
</ul>`;

function readinessTable(status: readonly ModelStatus[]): string {
  const ids = status[0]?.sets.map((s) => s.id) ?? [];
  const rows = status.map((m) => {
    const fresh = m.sets.reduce((n, s) => n + s.fresh, 0);
    const all = m.sets.reduce((n, s) => n + s.withText, 0);
    const cells = m.sets.map((s) => {
      const cls = s.fresh === s.withText ? "ok" : "stop";
      const note = s.note
        ? `<br><span class="muted">${esc(s.note)}</span>`
        : "";
      return `<td class="num"><span class="${cls}">${s.fresh}/${s.withText}</span>${note}</td>`;
    });
    return `<tr><td><b>${esc(m.model.key)}</b></td>${cells.join("")}<td class="num"><span class="${fresh === all ? "ok" : "stop"}">${fresh}/${all}</span></td></tr>`;
  });
  return `<table><thead><tr><th>Модель</th>${ids.map((id) => `<th>${esc(id)}</th>`).join("")}<th>Всего</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
<p class="muted">Векторов по текущему тексту иконки / базовых иконок с описаниями.</p>`;
}

function modelsTable(r: EmbedReport, status: readonly ModelStatus[]): string {
  const rows = status.map((m) => {
    const s = sumSpent(m.sets);
    const all = m.sets.reduce((n, c) => n + c.withText, 0);
    const bytes = m.sets.reduce((n, c) => n + c.bytes, 0);
    const perIcon = s.texts > 0 ? s.rub / s.texts : undefined;
    const batch = median(
      r.models.find((x) => x.model.key === m.model.key)?.batchMs ?? [],
    );
    return `<tr><td><b>${esc(m.model.key)}</b><br><span class="muted">${esc(m.model.id)}</span></td><td class="num">${m.model.dims}</td><td class="num">${formatRub(m.model.rubPerMillion)}</td><td class="num">${formatRub(s.rub)}<br><span class="muted">${s.texts} текстов</span></td><td class="num">${tokens(s.tokens)}<br><span class="muted">${charsPerToken(s)} символа на токен</span></td><td class="num">${perIcon === undefined ? "—" : formatRub(perIcon * 1000)}</td><td class="num">${perIcon === undefined ? "—" : formatRub(perIcon * all)}</td><td class="num">${batch === undefined ? "—" : formatMs(batch)}</td><td class="num">${formatMb(bytes)}</td></tr>`;
  });
  return `<table><thead><tr><th>Модель</th><th>Длина вектора</th><th>Цена за 1 млн токенов</th><th>Потрачено на векторы</th><th>Токенов</th><th>На 1000 иконок</th><th>Весь каталог</th><th>Ответ на пачку</th><th>На диске</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
<p class="muted">«Потрачено» и токены — за все прогоны по оглавлениям векторов; «Весь каталог» — по цене одной иконки. «Ответ на пачку» — медиана этого прогона, пачка до 100 текстов; «—» — в этом прогоне модель ничего не отправляла.</p>`;
}

function runSection(r: EmbedReport): string {
  const sets = r.sets
    .map((s) => {
      const missing =
        s.missing.length > 0
          ? ` · без описаний ${s.missing.length}: ${s.missing.slice(0, 20).map(esc).join(", ")}${s.missing.length > 20 ? " …" : ""} — сначала <code>pnpm enrich ${esc(s.id)}</code>`
          : "";
      const stops = s.stop
        .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
        .join("");
      return `<li><b>${esc(s.name)}</b> <span class="muted">${esc(s.id)}</span>: базовых иконок ${s.bases}, с описаниями ${s.withText}${missing}${stops}</li>`;
    })
    .join("");
  const models = r.models
    .map((m) => {
      const rows = m.sets
        .map(
          (s) =>
            `<tr><td>${esc(s.id)}</td><td class="num">${s.cached}</td><td class="num">${s.todo}</td><td class="num">${s.computed}</td><td class="num">${s.todo > 0 ? formatRub(s.estimate) : "—"}</td><td class="num">${s.spent.requests > 0 ? `${formatRub(s.spent.rub)}<br><span class="muted">${tokens(s.spent.tokens)} токенов</span>` : "—"}</td><td class="num">${s.stored}<br><span class="muted">${formatMb(s.bytes)}</span></td><td>${s.notes.map(esc).join("<br>")}</td></tr>`,
        )
        .join("");
      const batch = median(m.batchMs);
      const timing =
        batch === undefined
          ? ""
          : `<p>Отправка: ${formatMs(m.ms)}, пачек ${m.batchMs.length}, медиана ответа на пачку до ${m.model.batchSize} текстов — ${formatMs(batch)}.</p>`;
      const stops = m.stop
        .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
        .join("");
      return `<h3>${esc(m.model.key)} <span class="muted">${esc(m.model.id)}</span></h3>
${stops}${timing}
<table><thead><tr><th>Набор</th><th>Из кэша</th><th>К отправке</th><th>Посчитано</th><th>Оценка</th><th>Потрачено</th><th>На диске</th><th>Заметки</th></tr></thead>
<tbody>${rows}</tbody></table>`;
    })
    .join("\n");
  const stops = r.stop
    .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
    .join("");
  const calculated =
    r.spent.rubCalculated > 0
      ? ` (из них по цене из конфига ${formatRub(r.spent.rubCalculated)})`
      : "";
  return `${stops}<p>Оценка до отправки: ${formatRub(r.estimate)} · потрачено: <b>${formatRub(r.spent.rub)}</b>${calculated}.</p>
<ul>${sets}</ul>
${models}`;
}

/** Страница index.html отчёта эмбеддингов. */
export function renderEmbedPage(
  r: EmbedReport,
  status: readonly ModelStatus[],
): string {
  return htmlPage(
    "Эмбеддинги",
    `body { max-width: 1440px; }${EMBED_STYLE}`,
    `<h1>Эмбеддинги</h1>
<p class="muted">ADR-0047: векторы текста базовых иконок через Polza AI (<code>${esc(API_URL)}</code>), текст версии ${TEXT_VERSION}. Векторы лежат в .cache/embeddings на этом компьютере, в git их нет. Ближайшие иконки к запросам — на странице <a href="nearest.html">nearest.html</a>.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Готовность</h2>
${readinessTable(status)}
<h2>Чем отличаются модели</h2>
${modelsTable(r, status)}
${MODELS_TEXT}
<h2>Этот прогон</h2>
${runSection(r)}`,
  );
}

/** Строки pnpm nearest для терминала: пятёрка по каждому запросу и совпадение в паре ru/en. */
export function formatNearest(r: NearestReport): string {
  const lines: string[] = [];
  for (const e of r.errors) lines.push(`${e.id}: не прочитан — ${e.message}`);
  for (const m of r.models) {
    const latency = median(m.latencies);
    lines.push(
      `${m.model.key} — ${m.model.id}${latency === undefined ? "" : ` · ответ на запрос: медиана ${formatMs(latency)}`}`,
    );
    for (const note of m.notes) lines.push(`  ${note}`);
    m.results.forEach((res, i) => {
      lines.push(
        `  «${res.query}»: ${res.neighbors
          .slice(0, TOP_TERMINAL)
          .map((n) => `${n.set}:${n.name} ${score(n.score)}`)
          .join(" · ")}`,
      );
      const prev = m.results[i - 1];
      if (i % 2 === 1 && prev) {
        lines.push(
          `    совпало в пятёрках: ${overlap(prev.neighbors, res.neighbors, TOP_TERMINAL)} из ${TOP_TERMINAL}`,
        );
      }
    });
    for (const stop of m.stop) lines.push(`  СТОП — ${stop}`);
  }
  for (const stop of r.stop) lines.push(`СТОП — ${stop}`);
  return lines.join("\n");
}

const keyOf = (n: Neighbor) => `${n.set}:${n.name}`;

function neighborsColumn(
  res: QueryResult | undefined,
  query: string,
  both: ReadonlySet<string>,
): string {
  if (!res) {
    return `<div class="nn-col"><h4>«${esc(query)}»</h4><p class="muted">нет результата</p></div>`;
  }
  const items = res.neighbors
    .map((n, i) => {
      const cls = [
        i < TOP_TERMINAL ? "top" : "",
        both.has(keyOf(n)) ? "both" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const pic = n.icon
        ? `<img class="tile" src="${svgDataUri(iconToSvg(n.icon))}" width="32" height="32" alt="">`
        : "";
      return `<li${cls ? ` class="${cls}"` : ""}><span>${pic}<code>${esc(n.set)}:${esc(n.name)}</code> <span class="muted">${score(n.score)}</span></span></li>`;
    })
    .join("");
  return `<div class="nn-col"><h4>«${esc(query)}» <span class="muted">${formatMs(res.ms)}</span></h4><ol class="nn-list">${items}</ol></div>`;
}

/** Страница nearest.html: запросы парами ru/en, по каждой модели — десятка ближайших иконок. */
export function renderNearestPage(r: NearestReport): string {
  const latency = r.models
    .map((m) => {
      const med = median(m.latencies);
      return `<tr><td><b>${esc(m.model.key)}</b><br><span class="muted">${esc(m.model.id)}</span></td><td class="num">${med === undefined ? "—" : formatMs(med)}</td><td class="num">${m.latencies.map(formatMs).join(", ") || "—"}</td><td class="num">${m.vectors}</td><td>${[...m.notes, ...m.stop.map((s) => `СТОП — ${s}`)].map(esc).join("<br>")}</td></tr>`;
    })
    .join("");
  const groups: string[] = [];
  for (let i = 0; i < r.queries.length; i += 2) {
    const pair = r.queries.slice(i, i + 2);
    const title = pair.map((q) => `«${esc(q)}»`).join(" / ");
    const models = r.models
      .filter((m) => m.results.length > 0)
      .map((m) => {
        const results = pair.map((q, j) =>
          m.results[i + j]?.query === q ? m.results[i + j] : undefined,
        );
        const [a, b] = results;
        const both = new Set<string>();
        let same = "";
        if (a && b) {
          const top = new Set(a.neighbors.slice(0, TOP_TERMINAL).map(keyOf));
          for (const n of b.neighbors.slice(0, TOP_TERMINAL)) {
            if (top.has(keyOf(n))) both.add(keyOf(n));
          }
          same = ` <span class="muted">совпало в пятёрках: ${both.size} из ${TOP_TERMINAL}</span>`;
        }
        const columns = pair
          .map((q, j) => neighborsColumn(results[j], q, both))
          .join("");
        return `<h3>${esc(m.model.key)}${same}</h3><div class="nn-grid">${columns}</div>`;
      })
      .join("\n");
    groups.push(`<h2>${title}</h2>\n${models}`);
  }
  const errors = r.errors
    .map((e) => `<p class="stop">${esc(e.id)}: ${esc(e.message)}</p>`)
    .join("");
  const stops = r.stop
    .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
    .join("");
  return htmlPage(
    "Ближайшие иконки",
    `body { max-width: 1440px; }${EMBED_STYLE}`,
    `<h1>Ближайшие иконки</h1>
<p class="muted">ADR-0047. Похожесть — косинус между вектором запроса и вектором иконки: 1 — смысл совпадает, около 0 — не связан. Жирным — первая пятёрка (её считает Hit@5, ADR-0021), ● — иконка есть в пятёрках обоих запросов пары. Это проверка на глаз: формат текста по этим запросам не подгоняется.</p>
${stops}${errors}
<h2>Что проверить</h2>
<ul>
<li>У пары ru/en пятёрки почти совпадают.</li>
<li>Иконки подходят к запросу по смыслу, а не только по словам из имени.</li>
<li>«Корзина» двусмысленна — это и тележка магазина, и мусорная корзина: посмотрите, что выбрала каждая модель.</li>
</ul>
<h2>Время ответа на запрос</h2>
<table><thead><tr><th>Модель</th><th>Медиана</th><th>Все замеры</th><th>Векторов</th><th>Заметки</th></tr></thead>
<tbody>${latency}</tbody></table>
<p class="muted">Время — с этого компьютера через Polza, без первого запроса (в нём открывается соединение). На рабочем сервере в фазе 2 цифры будут другими, а разница между моделями видна и здесь.</p>
${groups.join("\n")}`,
  );
}
