// Отчёт обогащения (шаг 10, ADR-0046): строки для терминала, итоговая таблица и страница
// .cache/reports/enrich/index.html — иконка, PNG для модели, описания и синонимы, стоимость.
// Без скриптов, как все отчёты: картинки — в адресах data:.

import { iconToSvg } from "../normalize/normalize.js";
import { esc, htmlPage, svgDataUri } from "../report/html.js";
import {
  BATCH_PRICES,
  EFFORT,
  MODEL,
  PROMPT_VERSION,
  REPORT_CARDS,
} from "./config.js";
import { formatUsd } from "./cost.js";
import type { CardStatus, EnrichCard, SetEnrichReport } from "./run.js";

const CHECKLIST = [
  "Описание говорит только о том, что нарисовано: ни одной детали, которой нет на картинке.",
  "Синонимы — слова, которыми иконку будут искать; среди них есть разговорные («мусорка», «домик»).",
  "Названий брендов нет, если иконка — не логотип.",
  "Ошибочных описаний на выборке не больше 5% — иначе промпт дорабатывается (ADR-0020).",
  "Стоимость на иконку и прогноз на каталог укладываются в бюджет.",
];

const STATUS_TITLE: Record<CardStatus, string> = {
  sent: "сейчас",
  failed: "отказ",
  cached: "уже было",
  planned: "будет отправлена",
  waiting: "ждёт результата",
};

export const ENRICH_STYLE = `
.enrich-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 560px), 1fr)); gap: 12px; }
.enrich-card { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
.enrich-card .pics { display: flex; flex-direction: column; gap: 6px; flex: none; }
.tile { display: block; background: #ffffff; border: 1px solid var(--line); border-radius: 8px; padding: 6px; object-fit: contain; }
.png { display: block; border: 1px solid var(--line); border-radius: 8px; }
.enrich-card h4 { margin: 0 0 4px; font-size: 14px; overflow-wrap: anywhere; }
.enrich-card p { margin: 3px 0; font-size: 13px; overflow-wrap: anywhere; }
.syn { color: var(--muted); }
.st-failed { color: var(--stop); font-weight: 600; } .st-sent { color: var(--ok); font-weight: 600; }
code { background: var(--code); border-radius: 4px; padding: 1px 4px; overflow-wrap: anywhere; }
`;

/** Траты: этот прогон, а если ничего не отправляли — последний прогон с отправкой. */
const spentOf = (r: SetEnrichReport) => r.cost ?? r.last?.cost;

const perIcon = (r: SetEnrichReport): number | undefined => {
  const c = spentOf(r);
  return c && c.requests > 0 ? c.usd / c.requests : undefined;
};

const tokens = (n: number) => n.toLocaleString("ru-RU");

/** Строки одного набора для терминала. */
export function formatEnrichReport(r: SetEnrichReport): string {
  const lines = [`${r.id} — ${r.name}`];
  if (r.bases > 0 || r.stop.length === 0) {
    lines.push(
      `  Базовых иконок: ${r.bases} · с описаниями: было ${r.enrichedBefore} → стало ${r.enrichedAfter} · выборка ${r.sample} · без описаний в ней ${r.selected}`,
    );
  }
  if (r.resumed) lines.push("  Продолжение пакета из файла состояния");
  if (r.waiting !== undefined) {
    lines.push(
      `  Пакет ${r.waiting} отправлен, результаты заберёт следующий запуск: pnpm enrich ${r.id}`,
    );
  } else if (r.sent > 0 || r.cost) {
    lines.push(
      `  Пакет: отправлено ${r.sent} · получено ${r.succeeded} · отказов ${r.failed.length}`,
    );
  }
  const c = r.cost;
  if (c) {
    const each = perIcon(r);
    const left = Math.max(0, r.bases - r.enrichedAfter);
    const forecast =
      each === undefined
        ? ""
        : ` · остаток набора (${left}) ≈ ${formatUsd(each * left)}`;
    lines.push(
      `  Стоимость: ${formatUsd(c.usd)} · вход ${tokens(c.input)} токенов, выход ${tokens(c.output)}${each === undefined ? "" : ` · на иконку ${formatUsd(each)}`}${forecast}`,
    );
  } else if (r.selected > 0 && r.stop.length === 0 && !r.resumed) {
    lines.push(`  Оценка стоимости: ${formatUsd(r.estimate)}`);
  }
  if (!c && r.last) {
    const each = perIcon(r);
    lines.push(
      `  Последний прогон с отправкой: пакет ${r.last.batchId} · отправлено ${r.last.sent} · получено ${r.last.succeeded} · отказов ${r.last.failed} · ${formatUsd(r.last.cost.usd)}${each === undefined ? "" : ` · на иконку ${formatUsd(each)}`}`,
    );
  }
  for (const f of r.failed.slice(0, 10))
    lines.push(`  отказ ${f.name}: ${f.reason}`);
  if (r.failed.length > 10)
    lines.push(`  … и ещё ${r.failed.length - 10} отказов`);
  for (const s of r.stop) lines.push(`  СТОП — ${s}`);
  if (r.written) lines.push(`  записано data/${r.id}/search.json`);
  return lines.join("\n");
}

/** Итоговая таблица для терминала. */
export function formatEnrichTable(sets: readonly SetEnrichReport[]): string {
  const head = [
    "Набор",
    "Базовых",
    "С описаниями",
    "Отправлено",
    "Получено",
    "Отказов",
    "Стоимость",
  ];
  const rows = sets.map((r) => [
    r.id,
    String(r.bases),
    String(r.enrichedAfter),
    String(r.sent),
    String(r.succeeded),
    String(r.failed.length),
    r.cost ? formatUsd(r.cost.usd) : "—",
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

const language = (
  title: string,
  value: { description: string; synonyms: string[] },
) =>
  `<p><b>${title}:</b> ${esc(value.description)}</p><p class="syn">${value.synonyms.map(esc).join(" · ")}</p>`;

function card(id: string, c: EnrichCard): string {
  const pics = [
    `<img class="tile" src="${svgDataUri(iconToSvg(c.icon))}" width="64" height="64" alt="">`,
  ];
  if (c.png) {
    pics.push(
      `<img class="png" src="data:image/png;base64,${c.png.toString("base64")}" width="128" height="128" alt="">`,
    );
  }
  const usage = c.usage
    ? ` · токены ${tokens(c.usage.input_tokens)} + ${tokens(c.usage.output_tokens)}`
    : "";
  const status = `<span class="st-${c.status}">${STATUS_TITLE[c.status]}</span>`;
  const body: string[] = [
    `<h4>${esc(id)}:${esc(c.name)} <span class="muted">${status}${usage}</span></h4>`,
    `<p class="muted">Теги: ${c.tags.length > 0 ? c.tags.map(esc).join(", ") : "—"}</p>`,
  ];
  if (c.value) {
    body.push(language("ru", c.value.ru), language("en", c.value.en));
  }
  if (c.reason !== undefined)
    body.push(`<p class="st-failed">${esc(c.reason)}</p>`);
  return `<article class="enrich-card"><div class="pics">${pics.join("")}</div><div>${body.join("")}</div></article>`;
}

function summaryTable(sets: readonly SetEnrichReport[]): string {
  const rows = sets.map(
    (r) =>
      `<tr><td><b><a href="#set-${esc(r.id)}">${esc(r.name)}</a></b><br><span class="muted">${esc(r.id)}</span></td><td class="num">${r.bases}</td><td class="num">${r.enrichedBefore} → ${r.enrichedAfter}</td><td class="num">${r.sent}</td><td class="num">${r.succeeded}</td><td class="num">${r.failed.length}</td><td class="num">${r.cost ? formatUsd(r.cost.usd) : r.last ? `${formatUsd(r.last.cost.usd)}<br><span class="muted">прошлый прогон</span>` : "—"}</td><td>${r.stop.length > 0 ? `<span class="stop">СТОП</span>` : r.waiting ? "ждёт" : r.written ? `<span class="ok">записано</span>` : "—"}</td></tr>`,
  );
  return `<table><thead><tr><th>Набор</th><th>Базовых</th><th>С описаниями</th><th>Отправлено</th><th>Получено</th><th>Отказов</th><th>Стоимость</th><th>Итог</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>`;
}

function setSection(r: SetEnrichReport): string {
  const stops = r.stop
    .map((s) => `<p class="stop">СТОП — ${esc(s)}</p>`)
    .join("");
  const c = r.cost;
  const each = perIcon(r);
  const left = Math.max(0, r.bases - r.enrichedAfter);
  const cost = c
    ? `<p>Стоимость прогона: <b>${formatUsd(c.usd)}</b> — вход ${tokens(c.input)} токенов, выход ${tokens(c.output)}${each === undefined ? "" : `; на иконку ${formatUsd(each)}; остаток набора (${left} иконок) ≈ ${formatUsd(each * left)}`}.</p>`
    : r.waiting
      ? `<p>Пакет <code>${esc(r.waiting)}</code> ещё обрабатывается: результаты заберёт следующий запуск <code>pnpm enrich ${esc(r.id)}</code>.</p>`
      : r.selected > 0 && r.stop.length === 0
        ? `<p>Оценка стоимости: ${formatUsd(r.estimate)} за ${r.selected} иконок.</p>`
        : "";
  const last =
    !c && r.last
      ? `<p>Последний прогон с отправкой — пакет <code>${esc(r.last.batchId)}</code>: отправлено ${r.last.sent}, получено ${r.last.succeeded}, отказов ${r.last.failed}, стоимость <b>${formatUsd(r.last.cost.usd)}</b> — вход ${tokens(r.last.cost.input)} токенов, выход ${tokens(r.last.cost.output)}${each === undefined ? "" : `; на иконку ${formatUsd(each)}; остаток набора (${left} иконок) ≈ ${formatUsd(each * left)}`}.</p>`
      : "";
  const shown = r.cards.slice(0, REPORT_CARDS);
  const more =
    r.cards.length > REPORT_CARDS
      ? `<p class="muted">… и ещё ${r.cards.length - REPORT_CARDS} карточек не показаны.</p>`
      : "";
  const failed =
    r.failed.length > 0
      ? `<h3>Отказы (${r.failed.length})</h3><ul>${r.failed.map((f) => `<li><code>${esc(f.name)}</code> — ${esc(f.reason)}</li>`).join("")}</ul>`
      : "";
  return `<h2 id="set-${esc(r.id)}">${esc(r.name)}</h2>
<p class="muted">${esc(r.id)} · базовых иконок ${r.bases} · с описаниями было ${r.enrichedBefore}, стало ${r.enrichedAfter} · выборка ${r.sample}, без описаний в ней ${r.selected}${r.resumed ? " · продолжение пакета" : ""}</p>
${stops}
${cost}${last}
${failed}
<h3>Карточки (${r.cards.length})</h3>
<p class="muted">Слева — иконка как в галерее, справа — PNG, который видела модель. Порядок: отказы, отправленные сейчас, ждущие, запланированные, уже обогащённые.</p>
<div class="enrich-cards">
${shown.map((c) => card(r.id, c)).join("\n")}
</div>
${more}`;
}

/** Страница index.html отчёта обогащения. */
export function renderEnrichPage(
  sets: readonly SetEnrichReport[],
  catalog: { bases: number; enriched: number },
): string {
  const costs = sets.flatMap((r) => {
    const c = spentOf(r);
    return c ? [c] : [];
  });
  const requests = costs.reduce((n, c) => n + c.requests, 0);
  const usd = costs.reduce((n, c) => n + c.usd, 0);
  const left = Math.max(0, catalog.bases - catalog.enriched);
  const forecast =
    requests > 0
      ? ` По цене этого прогона (${formatUsd(usd / requests)} за иконку) остаток каталога — ${left} базовых иконок — обойдётся примерно в ${formatUsd((usd / requests) * left)}.`
      : "";
  return htmlPage(
    "Обогащение",
    `body { max-width: 1440px; }${ENRICH_STYLE}`,
    `<h1>Обогащение</h1>
<p class="muted">ADR-0020, ADR-0046: модель ${esc(MODEL)} через Message Batches, промпт v${PROMPT_VERSION}, усилие ${esc(EFFORT)}, цены $${BATCH_PRICES.input} и $${BATCH_PRICES.output} за миллион входных и выходных токенов. Описания и синонимы лежат в data/{набор}/search.json только у базовых иконок.</p>
<h2>Что проверить</h2>
<ul>${CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Сводка</h2>
${summaryTable(sets)}
<p>В каталоге описания есть у ${catalog.enriched} из ${catalog.bases} базовых иконок.${forecast}</p>
${sets.map(setSection).join("\n")}`,
  );
}
