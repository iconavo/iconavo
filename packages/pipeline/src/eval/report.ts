// Отчёты разметки и замера (шаг 12, ADR-0048): строки для терминала и две страницы —
// .cache/reports/eval/judge.html (разметка судьи и 20 запросов для проверки владельцем) и index.html
// (замер: главные цифры с погрешностью, доля смысловой части, длина вектора, модели попарно, промахи
// рабочей части). Без скриптов, как все отчёты. Плюс baseline.json — первый замер для фазы 2.

import type { Json } from "../build/json.js";
import { iconToSvg } from "../normalize/normalize.js";
import { esc, htmlPage, percent, svgDataUri } from "../report/html.js";
import { textTable } from "../report/table.js";
import type { Catalog } from "../search/catalog.js";
import { resultCard, SEARCH_STYLE } from "../search/page.js";
import {
  JUDGE_MODEL,
  LENGTH_TOLERANCE,
  SEED,
  SIGNIFICANCE,
  SPOT_CHECK,
} from "./config.js";
import { type GoldenQuery, TYPES, type Verdict } from "./golden.js";
import { type JudgeReport, shuffle, verdictCounts } from "./judge.js";
import type { Summary } from "./metrics.js";
import type {
  Diagnosis,
  EvalReport,
  SetShares,
  SystemResult,
  WorstEntry,
} from "./run.js";

const rub = (n: number) => `${n.toFixed(2).replace(".", ",")} ₽`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fixed = (x: number, digits = 2) => x.toFixed(digits).replace(".", ",");
const mb = (bytes: number) =>
  `${(bytes / 1e6).toFixed(1).replace(".", ",")} МБ`;

const TYPE_NAMES: Record<string, string> = {
  object: "предметы",
  action: "действия",
  abstract: "абстракции",
  ui: "интерфейс",
  casual: "разговорные",
};

const LANG_ORDER = ["ru", "en"] as const;

/** Плитка иконки по «набор:имя» с рамкой вердикта. */
function tile(catalog: Catalog, id: string, verdict?: Verdict, note?: string) {
  const doc = catalog.docs[catalog.byId.get(id) as number];
  const pic = doc
    ? `<img class="tile" src="${svgDataUri(iconToSvg(doc.icon))}" width="40" height="40" alt="">`
    : "";
  return `<figure class="t${verdict ? ` ${verdict}` : ""}">${pic}<figcaption><code>${esc(id)}</code>${note ? ` <span class="muted">${esc(note)}</span>` : ""}</figcaption></figure>`;
}

const EVAL_STYLE = `${SEARCH_STYLE}
body { max-width: 1440px; }
.tiles { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 12px; }
figure.t { margin: 0; width: 112px; font-size: 0.78em; }
figure.t .tile { margin-bottom: 2px; }
figure.t.fits .tile { border: 2px solid var(--ok); }
figure.t.partial .tile { border: 2px solid #c99a00; }
figure.t.no { opacity: 0.6; }
.q { border-top: 1px solid var(--line); padding-top: 8px; margin-top: 12px; }
.q h4 { margin: 0; }
.best { font-weight: 700; }
td.c { text-align: center; }
`;

// ——— Разметка ———

/** Строки pnpm judge для терминала. */
export function formatJudgeReport(r: JudgeReport): string {
  const lines: string[] = [];
  lines.push(
    `Запросов в разметке: ${r.queries.length} из ${r.total}${r.queries.length < r.total ? " (пилот)" : ""}`,
  );
  for (const note of r.notes) lines.push(`  ${note}`);
  for (const round of r.rounds) {
    lines.push(
      `Круг ${round.round}: неразмеченных пар ${round.pending}, запросов к судье ${round.requests}, оценка ${rub(round.estimate)}, получено вердиктов ${round.judged}`,
    );
  }
  const s = r.spent;
  if (s.requests > 0) {
    lines.push(
      `Потрачено: ${rub(s.rub)} · запросов ${s.requests} · картинок ${s.images} · токенов ${s.promptTokens.toLocaleString("ru-RU")} + ${s.completionTokens.toLocaleString("ru-RU")} · ${rub(s.rub / s.images)} на картинку`,
    );
    const done = r.queries.filter(
      (q) => (r.labels.byQuery.get(q.id)?.size ?? 0) > 0,
    ).length;
    if (r.queries.length < r.total && done > 0) {
      lines.push(
        `Прогноз на весь эталон: ≈ ${rub((s.rub / done) * r.total)} (по ${rub(s.rub / done)} на запрос)`,
      );
    }
  }
  lines.push(
    `Вся разметка стоила: ${rub(r.spentTotal.rub)} за ${r.spentTotal.requests} запросов`,
  );
  const v = verdictCounts(r.labels);
  lines.push(
    `Вердикты: подходит ${v.fits}, частично ${v.partial}, нет ${v.no}${r.labels.overridden > 0 ? ` · ваших правок ${r.labels.overridden}` : ""}`,
  );
  if (r.agreement.pairs > 0) {
    lines.push(
      `Согласие судьи с собой: ${r.agreement.same} из ${r.agreement.pairs} пар (${percent(r.agreement.same, r.agreement.pairs)}), по «подходит или нет» — ${percent(r.agreement.sameFits, r.agreement.pairs)}`,
    );
  }
  // Без моделей прототипа (--service-only) долей нет — и строки нет.
  if (r.tuned && r.tuned.size > 0) {
    lines.push(
      `Доля смысловой части по рабочей части: ${[...r.tuned].map(([k, t]) => `${k} ${fixed(t.alpha, 1)}`).join(", ")}`,
    );
  }
  if (r.failures.length > 0) {
    lines.push(
      `Ответы, которые не разобрались (${r.failures.length}) — отправятся снова:`,
    );
    for (const f of r.failures.slice(0, 10))
      lines.push(`  ${f.id}: ${f.reason}`);
  }
  lines.push(
    r.pending > 0
      ? `Осталось неразмеченных пар: ${r.pending} — запустите pnpm judge ещё раз`
      : "Неразмеченных пар в первых местах вариантов нет.",
  );
  for (const stop of r.stop) lines.push(`СТОП — ${stop}`);
  return lines.join("\n");
}

const verdictOrder: Record<Verdict, number> = { fits: 0, partial: 1, no: 2 };

function queryCard(
  catalog: Catalog,
  q: GoldenQuery,
  labels: ReadonlyMap<string, Verdict> | undefined,
  overridden: ReadonlySet<string>,
  full: boolean,
): string {
  const items = [...(labels ?? [])].sort(
    (a, b) => verdictOrder[a[1]] - verdictOrder[b[1]] || (a[0] < b[0] ? -1 : 1),
  );
  const shown = full ? items : items.filter(([, v]) => v !== "no");
  const hidden = items.length - shown.length;
  const tiles = shown
    .map(([id, v]) =>
      tile(catalog, id, v, overridden.has(id) ? "правка владельца" : undefined),
    )
    .join("");
  return `<div class="q"><h4>${esc(q.id)} · «${esc(q.query)}» <span class="muted">${q.lang}, ${TYPE_NAMES[q.type] ?? q.type}, ${q.split === "work" ? "рабочая" : "контрольная"}</span></h4>
<p>Ожидание: ${esc(q.description)}</p>
<div class="tiles">${tiles || `<span class="muted">не размечено</span>`}</div>${hidden > 0 ? `<p class="muted">и ещё ${hidden} — «нет»</p>` : ""}</div>`;
}

/** Страница judge.html: итог, 20 запросов для проверки, остальные — только подходящие. */
export function renderJudgePage(
  r: JudgeReport,
  overrides: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string {
  const labeled = r.queries.filter(
    (q) => (r.labels.byQuery.get(q.id)?.size ?? 0) > 0,
  );
  const spot = shuffle(labeled, `${SEED}|spot`).slice(0, SPOT_CHECK);
  const spotIds = new Set(spot.map((q) => q.id));
  const over = (id: string) => new Set(Object.keys(overrides[id] ?? {}));
  const card = (q: GoldenQuery, full: boolean) =>
    queryCard(r.catalog, q, r.labels.byQuery.get(q.id), over(q.id), full);
  const v = verdictCounts(r.labels);
  const stops = r.stop
    .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
    .join("");
  const s = r.spent;
  return htmlPage(
    "Разметка эталона",
    EVAL_STYLE,
    `<h1>Разметка эталона</h1>
<p class="muted">ADR-0048. Судья — <code>${esc(JUDGE_MODEL)}</code> через Polza: видит запрос, описание ожидаемой иконки и картинки кандидатов с именами без набора, перемешанные постоянным случаем. Наших описаний и синонимов не видит. Кандидаты — первые десятки всех вариантов замера. Зелёная рамка — «подходит», жёлтая — «частично».</p>
${stops}
<h2>Итог</h2>
<ul>
<li>Запросов: ${r.queries.length} из ${r.total}${r.queries.length < r.total ? " — пилот" : ""}.</li>
<li>Вердикты: подходит ${v.fits}, частично ${v.partial}, нет ${v.no}${r.labels.overridden > 0 ? `; ваших правок ${r.labels.overridden}` : ""}.</li>
<li>Этот запуск: ${s.requests > 0 ? `${rub(s.rub)}, запросов ${s.requests}, картинок ${s.images}, ${rub(s.rub / s.images)} на картинку` : "ничего не отправлялось"}. Вся разметка — ${rub(r.spentTotal.rub)}.</li>
${r.agreement.pairs > 0 ? `<li>Согласие судьи с собой: ${percent(r.agreement.same, r.agreement.pairs)} из ${r.agreement.pairs} повторно размеченных пар, по «подходит или нет» — ${percent(r.agreement.sameFits, r.agreement.pairs)}.</li>` : ""}
<li>${r.pending > 0 ? `Осталось неразмеченных пар: ${r.pending}.` : "Неразмеченных пар в первых местах вариантов нет."}</li>
</ul>
<h2>Что проверить — ${spot.length} случайных запросов</h2>
<ul>
<li>Запрос похож на то, что вводят люди (ADR-0021).</li>
<li>Зелёные действительно подходят, а среди серых нет нужной иконки.</li>
<li>Неверный вердикт — напишите, например, «ru-008: lucide:shopping-basket — нет». Я впишу правку в <code>docs/eval/overrides.json</code>, судья её не перезапишет.</li>
</ul>
${spot.map((q) => card(q, true)).join("")}
<h2>Остальные запросы — подходящие и частичные</h2>
${r.queries
  .filter((q) => !spotIds.has(q.id))
  .map((q) => card(q, false))
  .join("")}`,
  );
}

// ——— Замер ———

const cell = (s: Summary) =>
  s.n === 0
    ? "—"
    : `${pct(s.hit)} <span class="muted">${pct(s.low)}–${pct(s.high)}</span>`;

const plainCell = (s: Summary) => (s.n === 0 ? "—" : pct(s.hit));

/** Строки pnpm eval для терминала: главная таблица, α, длины, рекомендация. */
export function formatEvalReport(r: EvalReport): string {
  const lines: string[] = [];
  for (const note of r.notes) lines.push(note);
  if (r.main.length > 0) {
    lines.push(
      `В замере ${r.included.length} запросов из ${r.queries.length}; без подходящей иконки в каталоге — ${r.ceiling.length}.`,
      "",
      "Hit@5 — доля запросов с подходящей иконкой в первой пятёрке; строго — по всем 200, «потолок» — промах:",
      textTable(
        [
          "Вариант",
          "строго ru",
          "строго en",
          "строго, все 200",
          "MRR@10 строго ru",
          "MRR@10 строго en",
          "контр. ru",
          "контр. en",
          "контр. всего",
        ],
        r.main.map((m) => [
          m.system.title,
          plainCell(m.strict.all.ru),
          plainCell(m.strict.all.en),
          plainCell(m.strict.all.all),
          fixed(m.strict.all.ru.mrr),
          fixed(m.strict.all.en.mrr),
          plainCell(m.groups.holdout.ru),
          plainCell(m.groups.holdout.en),
          plainCell(m.groups.holdout.all),
        ]),
      ),
      "",
    );
    if (r.oracle) {
      lines.push(
        `Оракул на рабочей части — лучший из вариантов замера для каждого запроса: ${LANG_ORDER.map((l) => `${l} ${r.oracle?.[l].hits} из ${r.oracle?.[l].n}`).join(", ")}.`,
      );
    }
    // Замер только сервиса (CI) идёт без моделей прототипа: их долей и длин нет.
    if (r.choice.alpha.size > 0) {
      lines.push(
        `Доля смысловой части: ${[...r.choice.alpha].map(([k, a]) => `${k} ${fixed(a, 1)}`).join(", ")}${r.tuned ? " (подобрана на рабочей части)" : " (из настроек)"}`,
      );
    }
    if (r.lengths.length > 0) {
      lines.push(
        `Длина вектора по правилу ADR-0048: ${r.lengths.map((l) => `${l.model} ${l.picked}`).join(", ")}`,
      );
    }
    const service = serviceText(r);
    if (service !== "") lines.push(service);
    const rec = r.recommendation;
    if (rec) {
      lines.push(
        `Лидер на контрольной части: ${rec.leader}${rec.closeHoldout.length > 0 ? `; в пределах случайности — ${rec.closeHoldout.join(", ")}${rec.closeAll.length > 0 ? `, и на всех запросах — ${rec.closeAll.join(", ")}` : ", на всех запросах разница надёжна"}` : "; разница с остальными надёжна"}`,
      );
    }
    if (r.perSet) {
      lines.push(
        `По наборам (${r.perSet.model}): ${r.perSet.sets.map((s) => `${s.set} ${plainCell(s.summary)} из ${s.summary.n}`).join(", ")}`,
      );
    }
  }
  for (const stop of r.stop) lines.push(`СТОП — ${stop}`);
  return lines.join("\n");
}

function mainTable(
  rows: readonly SystemResult[],
  group: "holdout" | "work" | "all",
  strict = false,
): string {
  const pickGroup = (m: SystemResult) =>
    strict ? m.strict[group] : m.groups[group];
  const best = Math.max(...rows.map((m) => pickGroup(m).all.hit));
  return `<table><thead><tr><th>Вариант</th><th>ru</th><th>en</th><th>Всего</th><th>MRR@10</th><th>P@5</th><th>Запросов</th></tr></thead><tbody>${rows
    .map((m) => {
      const g = pickGroup(m);
      return `<tr${g.all.hit === best && g.all.n > 0 ? ` class="best"` : ""}><td>${esc(m.system.title)}${m.system.mode === "hybrid" ? ` <span class="muted">α ${fixed(m.system.alpha, 1)}, длина ${m.system.length ?? "полная"}</span>` : ""}</td><td class="num">${cell(g.ru)}</td><td class="num">${cell(g.en)}</td><td class="num">${cell(g.all)}</td><td class="num">${fixed(g.all.mrr)}</td><td class="num">${fixed(g.all.p5)}</td><td class="num">${g.all.n}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

/** Итог поискового сервиса (ADR-0049, ADR-0053): доля смысла и сравнение с гибридом Gemini прототипа. */
export function serviceText(r: EvalReport): string {
  const s = r.service;
  if (!s) return "";
  const rule =
    s.tuned === undefined
      ? ""
      : s.tuned.alpha === s.ratio
        ? ", её же выбирает правило на рабочей части"
        : `; правило на рабочей части выбрало бы ${fixed(s.tuned.alpha, 1)}`;
  const ratio = `Сервис: доля смысла ${fixed(s.ratio, 1)}, как в функции edge API${rule}`;
  if (!s.versus) return `${ratio}.`;
  const h = s.versus.holdout;
  return `${ratio}; против гибрида Gemini прототипа на контрольной части нашёл только сервис ${h.onlyA}, только прототип ${h.onlyB}, p = ${fixed(h.p, 3)} — ${s.versus.notWorse ? "не хуже в пределах случайности" : "хуже прототипа сверх случайности: нужен запасной способ (ADR-0049)"}.`;
}

/** Раздел страницы о поисковом сервисе: итог и кривая доли смысла на рабочей части. */
function serviceSection(r: EvalReport): string {
  const s = r.service;
  if (!s) return "";
  const curve = s.tuned
    ? `<table><thead><tr><th>Доля смысла</th><th>Hit@5</th><th>MRR@10</th></tr></thead><tbody>${s.tuned.curve
        .map(
          (p) =>
            `<tr${p.alpha === s.tuned?.alpha ? ` class="best"` : ""}><td class="num">${fixed(p.alpha, 1)}${p.alpha === s.ratio ? " · в функции" : ""}</td><td class="num">${pct(p.hit)}</td><td class="num">${fixed(p.mrr)}</td></tr>`,
        )
        .join("")}</tbody></table>
<p class="muted">Рабочая часть. Жирным — доля, которую выбирает правило: середина лучшего плато, при равенстве — по MRR@10, как α прототипа (ADR-0048, ADR-0049). «В функции» — доля, с которой сейчас ищет edge API (SEMANTIC_RATIO): строка «Сервис» в таблицах — это она. 0 — только слова, 1 — только смысл.</p>`
    : `<p class="muted">Правило долю не выбрало: разметка рабочей части неполная.</p>`;
  return `<h2>Поисковый сервис</h2>
<p><b>${esc(serviceText(r))}</b></p>
<p class="muted">«Сервис» — гибрид Meilisearch теми же запросами, что у функции edge API, при её доле смысла; «Сервис, только слова» — выдача, которая приходит первой, пока смысл не посчитан. Цель шага 8 фазы 4 (ADR-0021, ADR-0053): строго не ниже 90% и на русском, и на английском; Hit@5 контрольной части не ниже, чем до правок.</p>
${serviceStrictTable(r)}
${curve}`;
}

/** Сервис строго по языкам, контрольная и рабочая части и оракул рабочей части. */
function serviceStrictTable(r: EvalReport): string {
  const m = r.main.find((x) => x.system.key === "service:gemini");
  if (!m) return "";
  const hits = (s: Summary) =>
    `${pct(s.hit)} <span class="muted">${s.hits} из ${s.n}</span>`;
  const rows = [...LANG_ORDER, "all" as const]
    .map((l) => {
      const oracle =
        l === "all"
          ? r.oracle
            ? `${r.oracle.ru.hits + r.oracle.en.hits} из ${r.oracle.ru.n + r.oracle.en.n}`
            : "—"
          : r.oracle
            ? `${r.oracle[l].hits} из ${r.oracle[l].n}`
            : "—";
      return `<tr><td>${l === "all" ? "всего" : l}</td><td class="num">${hits(m.strict.all[l])}</td><td class="num">${fixed(m.strict.all[l].mrr)}</td><td class="num">${hits(m.strict.holdout[l])}</td><td class="num">${hits(m.strict.work[l])}</td><td class="num">${oracle}</td></tr>`;
    })
    .join("");
  return `<h3>Сервис — строго по языкам</h3>
<table><thead><tr><th>Язык</th><th>Hit@5 строго, все запросы</th><th>MRR@10 строго</th><th>Контрольная, строго</th><th>Рабочая, строго</th><th>Оракул рабочей</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Строго — «потолок» считается промахом (ADR-0021). Оракул — лучший из вариантов замера для каждого запроса рабочей части: это потолок любой перестановки выдачи, выше — только новыми словами у иконок или новыми иконками. Худшие запросы рабочей части — на странице <a href="worst.html">worst.html</a>.</p>`;
}

function recommendationText(r: EvalReport): string {
  const rec = r.recommendation;
  if (!rec) return "";
  const leader = r.main.find((m) => m.system.key === `hybrid:${rec.leader}`);
  const hit = leader ? pct(leader.groups.holdout.all.hit) : "?";
  const close =
    rec.closeHoldout.length === 0
      ? "Разница с остальными моделями на контрольной части надёжна (p < 0,05)."
      : `Разница с ${rec.closeHoldout.join(", ")} на контрольной части — в пределах случайности. ${rec.closeAll.length === 0 ? "На всех 200 запросах разница уже надёжна." : `И на всех 200 запросах в пределах случайности с ${rec.closeAll.join(", ")} — по правилу решают цена, скорость и поставщик (ADR-0047).`}`;
  return `<p><b>Лидер — гибрид ${esc(rec.leader)}: Hit@5 ${hit} на контрольной части.</b> ${esc(close)}</p>`;
}

/**
 * Наборы в первой пятёрке варианта на рабочей части: не проседает ли набор без тегов автора и не
 * попадает ли он в пятёрку лишний раз (Material Symbols).
 */
function setSharesSection(s: SetShares | undefined, heading: string): string {
  if (!s) return "";
  const docs = s.sets.reduce((n, x) => n + x.docs, 0);
  const fits = s.sets.reduce((n, x) => n + x.fits, 0);
  const slots = s.sets.reduce((n, x) => n + x.slots, 0);
  const share = (a: number, b: number) => (b === 0 ? "—" : pct(a / b));
  const rows = s.sets
    .map(
      (x) =>
        `<tr><td>${esc(x.set)}</td><td class="num">${share(x.docs, docs)}</td><td class="num">${share(x.fits, fits)}</td><td class="num">${share(x.slots, slots)}</td><td class="num">${share(x.slotFits, x.slots)}</td></tr>`,
    )
    .join("");
  return `<h2>Наборы в первой пятёрке — ${esc(heading)}</h2>
<table><thead><tr><th>Набор</th><th>Карточек каталога</th><th>Подходящих по разметке</th><th>Мест в пятёрке</th><th>Из них подходят</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Рабочая часть, по имеющейся разметке, без новых пар. Если доля мест в пятёрке заметно меньше доли подходящих, набор проседает; если больше, а подходят немногие, — набор попадает в пятёрку лишний раз.</p>`;
}

/** Страница index.html замера. */
export function renderEvalPage(r: EvalReport): string {
  const stops = r.stop
    .map((x) => `<p class="stop">СТОП — ${esc(x)}</p>`)
    .join("");
  const notes = r.notes.map((x) => `<li>${esc(x)}</li>`).join("");
  if (r.main.length === 0) {
    return htmlPage(
      "Замер поиска",
      EVAL_STYLE,
      `<h1>Замер поиска</h1>${stops}${notes ? `<ul>${notes}</ul>` : ""}`,
    );
  }
  const tuned = r.tuned ? [...r.tuned] : [];
  const grid = tuned[0]?.[1].curve.map((p) => p.alpha) ?? [];
  const alphaRows = grid.map(
    (a, i) =>
      `<tr><td class="num">${fixed(a, 1)}</td>${tuned
        .map(([, t]) => {
          const p = t.curve[i];
          return p
            ? `<td class="num${t.alpha === p.alpha ? " best" : ""}">${pct(p.hit)} <span class="muted">${fixed(p.mrr)}</span></td>`
            : "<td></td>";
        })
        .join("")}</tr>`,
  );
  const alphaTable = r.tuned
    ? `<table><thead><tr><th>α</th>${[...r.tuned.keys()].map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${alphaRows.join("")}</tbody></table>
<p class="muted">Рабочая часть: Hit@5 и MRR@10. Жирным — выбранная α: середина лучшего плато, при равенстве — по MRR@10. α = 0 — только текст, 1 — только смысл.</p>`
    : `<p class="muted">Не подобрана: разметка рабочей части неполная — α взята из search/config.ts.</p>`;
  const lengthTable = `<table><thead><tr><th>Модель</th><th>Длина</th><th>Hit@5</th><th>MRR@10</th><th>Векторы каталога</th></tr></thead><tbody>${r.lengths
    .flatMap((l) =>
      l.points.map(
        (p) =>
          `<tr${p.length === l.picked ? ` class="best"` : ""}><td>${esc(l.model)}</td><td class="num">${p.length}</td><td class="num">${pct(p.hit)}</td><td class="num">${fixed(p.mrr)}</td><td class="num">${mb(p.bytes)}</td></tr>`,
      ),
    )
    .join("")}</tbody></table>
<p class="muted">Все запросы, гибрид при выбранной α. Жирным — самая короткая длина, у которой Hit@5 и MRR@10 не хуже полной больше чем на ${Math.round(LENGTH_TOLERANCE.hit * 100)} пункт и ${fixed(LENGTH_TOLERANCE.mrr)} (ADR-0048). Короче вектор — меньше места в поисковом сервисе и быстрее поиск.</p>`;
  const title = (key: string) =>
    r.main.find((m) => m.system.key === key)?.system.title ?? key;
  const pairRows = r.pairs
    .map(
      (p) =>
        `<tr><td>${esc(title(p.a))} — ${esc(title(p.b))}</td><td class="num">${p.holdout.onlyA} / ${p.holdout.onlyB}</td><td class="num">${fixed(p.holdout.p, 3)}${p.holdout.p < SIGNIFICANCE ? " · надёжно" : " · случайность"}</td><td class="num">${p.all.onlyA} / ${p.all.onlyB}</td><td class="num">${fixed(p.all.p, 3)}${p.all.p < SIGNIFICANCE ? " · надёжно" : " · случайность"}</td></tr>`,
    )
    .join("");
  const typeTable = `<table><thead><tr><th>Вариант</th>${TYPES.map((t) => `<th>${TYPE_NAMES[t]}</th>`).join("")}</tr></thead><tbody>${r.main
    .map(
      (m) =>
        `<tr><td>${esc(m.system.title)}</td>${TYPES.map((t) => `<td class="num">${plainCell(m.types[t])} <span class="muted">${m.types[t].n}</span></td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>
<p class="muted">Все запросы. Ячейка — около 40 запросов, поэтому погрешность большая: цифры только для справки.</p>`;
  const perSet = r.perSet
    ? `<h2>По наборам — гибрид ${esc(r.perSet.model)} с фильтром</h2>
<table><thead><tr><th>Набор</th><th>Hit@5</th><th>MRR@10</th><th>Запросов</th></tr></thead><tbody>${r.perSet.sets
        .map(
          (s) =>
            `<tr><td>${esc(s.set)}</td><td class="num">${cell(s.summary)}</td><td class="num">${fixed(s.summary.mrr)}</td><td class="num">${s.summary.n}</td></tr>`,
        )
        .join("")}</tbody></table>
<p class="muted">Запросы, у которых в наборе есть подходящая иконка; поиск только внутри набора. Видно, проседает ли набор без тегов автора (Material Symbols).</p>`
    : "";
  const ceiling = r.ceiling
    .map(
      (q) =>
        `<li><b>${esc(q.id)}</b> «${esc(q.query)}» — ${esc(q.description)}</li>`,
    )
    .join("");
  const leaderKey = r.recommendation ? `hybrid:${r.recommendation.leader}` : "";
  const verdictOf = (q: GoldenQuery, id: string) =>
    r.labels.byQuery.get(q.id)?.get(id);
  const misses = r.misses
    .map((m) => {
      const cards = m.ranked
        .map((id) => {
          const doc = r.catalog.byId.get(id);
          if (doc === undefined) return "";
          const v = verdictOf(m.query, id);
          return resultCard(
            r.catalog,
            { doc, score: 0, exact: false, text: 0 },
            v === "fits" || v === "partial" ? { mark: () => v } : {},
          );
        })
        .join("");
      const fits = m.fits
        .slice(0, 8)
        .map((id) => tile(r.catalog, id, "fits"))
        .join("");
      return `<div class="q"><h4>${esc(m.query.id)} · «${esc(m.query.query)}» <span class="muted">${m.query.lang}, ${TYPE_NAMES[m.query.type] ?? m.query.type}</span></h4>
<p>Ожидание: ${esc(m.query.description)}</p>
<p class="muted">Пятёрка гибрида:</p><div class="cols">${cards}</div>
<p class="muted">Подходящие по разметке (${m.fits.length}):</p><div class="tiles">${fits}</div></div>`;
    })
    .join("");
  return htmlPage(
    "Замер поиска",
    EVAL_STYLE,
    `<h1>Замер поиска</h1>
<p class="muted">ADR-0021, ADR-0048. Hit@5 — доля запросов, у которых подходящая иконка есть в первой пятёрке; MRR@10 — насколько высоко стоит первая подходящая (1 — на первом месте); P@5 — сколько из пятёрки подходят. Разметка — судья ${esc(JUDGE_MODEL)} и ваши правки. Рядом с долей — интервал погрешности 95%. Векторы и разметка: ${Object.entries(
      r.versions,
    )
      .map(([k, v]) => `${esc(k)} ${esc(v)}`)
      .join(", ")}.</p>
${stops}
<h2>Главное</h2>
${recommendationText(r)}
${serviceSection(r)}
<p>В замере ${r.included.length} запросов из ${r.queries.length}. У ${r.ceiling.length} запросов подходящей иконки не нашёл ни один вариант — они в доли не входят, список ниже.</p>
<h3>Контрольная часть — честная цифра</h3>
${mainTable(r.main, "holdout")}
<p class="muted">По ней ничего не настраивается. На 100 запросах погрешность около ±8 пунктов, на 50 запросах одного языка — около ±11. Точное имя срабатывает только у английских запросов: имена иконок английские.</p>
<h3>Все запросы</h3>
${mainTable(r.main, "all")}
<h3>Строго: все 200 запросов, «потолок» — промах</h3>
${mainTable(r.main, "all", true)}
<p class="muted">Запрос, для которого подходящей иконки не нашёл ни один вариант, здесь считается промахом каждого варианта. Сравнение моделей это не меняет, но цифра ниже и честнее для цели к запуску (ADR-0021).</p>
<h3>Рабочая часть — по ней подбирается α</h3>
${mainTable(r.main, "work")}
<h2>Модели попарно</h2>
<table><thead><tr><th>Пара</th><th>Контр.: нашёл только первый / только второй</th><th>Вероятность случайно</th><th>Все: только первый / только второй</th><th>Вероятность случайно</th></tr></thead><tbody>${pairRows}</tbody></table>
<p class="muted">Точный тест Мак-Немара: сравниваются только запросы, где один вариант нашёл, а другой нет. Меньше ${fixed(SIGNIFICANCE)} — разница надёжна.</p>
${r.choice.alpha.size > 0 ? `<h2>Доля смысловой части α</h2>\n${alphaTable}` : ""}
${r.lengths.length > 0 ? `<h2>Длина вектора</h2>\n${lengthTable}` : ""}
<h2>По типам запросов</h2>
${typeTable}
${perSet}
${setSharesSection(r.serviceShares, "сервис")}
${setSharesSection(r.setShares, `гибрид ${r.setShares?.model ?? ""}`)}
<h2>Потолок: подходящей иконки не нашлось</h2>
${ceiling ? `<ul>${ceiling}</ul>` : `<p class="muted">Таких запросов нет.</p>`}
${
  leaderKey === ""
    ? ""
    : `<h2>Промахи — рабочая часть, гибрид ${esc(leaderKey.replace("hybrid:", ""))}</h2>
<p class="muted">Только рабочая часть: контрольную не разглядываем, чтобы не подгонять поиск под неё. Зелёная рамка в пятёрке — подходит, жёлтая — частично.</p>
${misses || `<p class="muted">Промахов нет.</p>`}`
}
${notes ? `<h2>Заметки</h2><ul>${notes}</ul>` : ""}`,
  );
}

// ——— Худшие запросы (шаг 8 фазы 4, ADR-0053) ———

/** Что значит диагноз и что предлагаю — словами для владельца. */
export const DIAGNOSES: Record<Diagnosis, { title: string; fix: string }> = {
  missing: {
    title: "Иконка есть, но её не находят ни слова, ни смысл",
    fix: "Новые слова у иконок — абстрактные понятия, роль в интерфейсе, разговорные слова (этап 3, обогащение).",
  },
  ceiling: {
    title: "Потолок: подходящей иконки не видел никто",
    fix: "Места 11–30 доразмечены; если подходящей нет и там — скорее всего, её нет в каталоге: новые наборы (фаза 5).",
  },
  words: {
    title: "Слова нашли, смысл перебил",
    fix: "По словам подходящая иконка в десятке, а в выдаче — ниже пятёрки: чинит слияние слов и смысла (этап 2).",
  },
  near: {
    title: "Рядом: до 20-го места",
    fix: "Слияние слов и смысла (этап 2); если не поможет — новые слова у иконок (этап 3).",
  },
  weak: {
    title: "Попадание, но не на первых местах",
    fix: "Слияние слов и смысла (этап 2) может поднять подходящую выше.",
  },
};

const placeText = (place?: number) =>
  place === undefined ? "нет в списке" : `${place}-е`;

function worstEntry(r: EvalReport, e: WorstEntry): string {
  const known = r.labels.byQuery.get(e.query.id);
  const top = e.ranked
    .slice(0, 10)
    .map((id, i) => tile(r.catalog, id, known?.get(id), `${i + 1}`))
    .join("");
  const fits = e.fits
    .slice(0, 8)
    .map((id) => tile(r.catalog, id, "fits"))
    .join("");
  const d = DIAGNOSES[e.diagnosis];
  const judge =
    e.partials >= 3
      ? `<p>В пятёрке ${e.partials} «частично» — посмотрите, не строг ли судья. Правка разметки — только по вашему слову и в обе стороны: «подходит» и «не подходит» (ADR-0053).</p>`
      : "";
  return `<div class="q"><h4>${esc(e.query.id)} · «${esc(e.query.query)}» <span class="muted">${e.query.lang}, ${TYPE_NAMES[e.query.type] ?? e.query.type}</span></h4>
<p><b>${esc(d.title)}.</b> ${esc(d.fix)}</p>
<p>Ожидание: ${esc(e.query.description)}</p>
<p class="muted">Первая подходящая: в выдаче — ${placeText(e.at.service)}, только по словам — ${placeText(e.at.words)}, только по смыслу — ${placeText(e.at.meaning)}.</p>
${judge}<p class="muted">Десятка сервиса — зелёная рамка: подходит, жёлтая: частично, бледная: нет; без рамки — не размечено:</p><div class="tiles">${top}</div>
<p class="muted">Подходящие по разметке (${e.fits.length}):</p>${fits ? `<div class="tiles">${fits}</div>` : `<p class="muted">Нет.</p>`}</div>`;
}

/** Страница worst.html: худшие запросы рабочей части у сервиса — выдача, места и диагноз. */
export function renderWorstPage(r: EvalReport): string {
  const counts = new Map<Diagnosis, number>();
  for (const e of r.worst) {
    counts.set(e.diagnosis, (counts.get(e.diagnosis) ?? 0) + 1);
  }
  const summary = (Object.keys(DIAGNOSES) as Diagnosis[])
    .filter((d) => counts.has(d))
    .map(
      (d) =>
        `<tr><td>${esc(DIAGNOSES[d].title)}</td><td class="num">${counts.get(d)}</td><td>${esc(DIAGNOSES[d].fix)}</td></tr>`,
    )
    .join("");
  const ratio = r.service ? fixed(r.service.ratio, 1) : "?";
  return htmlPage(
    "Худшие запросы — сервис",
    EVAL_STYLE,
    `<h1>Худшие запросы рабочей части — сервис</h1>
<p class="muted">Шаг 8 фазы 4, ADR-0053. Выдача функции edge API при доле смысла ${ratio}; первыми — запросы, где подходящей иконки нет и в 30 местах, затем по месту первой подходящей. Только рабочая часть: контрольную не разглядываем, чтобы не подгонять поиск под неё. Место — первой из размеченных подходящих: глубже десятки размечено не всё, поэтому иконка может стоять и выше. «Только по словам» и «только по смыслу» — две части поиска по отдельности, точное имя — впереди. Сводка цифр — на <a href="index.html">странице замера</a>.</p>
<table><thead><tr><th>Диагноз</th><th>Запросов</th><th>Что предлагаю</th></tr></thead><tbody>${summary}</tbody></table>
${r.worst.map((e) => worstEntry(r, e)).join("")}`,
  );
}

/** baseline.json — первый замер для фазы 2: цифры главных вариантов и десятки по каждому запросу. */
export function baselineJson(r: EvalReport): Json {
  const summary = (s: Summary): Json => ({
    n: s.n,
    hit: Number(s.hit.toFixed(4)),
    mrr: Number(s.mrr.toFixed(4)),
    p5: Number(s.p5.toFixed(4)),
  });
  const systems: Record<string, Json> = {};
  for (const m of r.main) {
    const entry: Record<string, Json> = {
      holdout: summary(m.groups.holdout.all),
      all: summary(m.groups.all.all),
      strict: summary(m.strict.all.all),
    };
    if (m.system.mode === "hybrid") {
      entry.alpha = m.system.alpha;
      entry.length = m.system.length ?? null;
    }
    systems[m.system.key] = entry;
  }
  const queries: Record<string, Json> = {};
  r.queries.forEach((q, i) => {
    const lists: Record<string, Json> = {};
    for (const m of r.main) {
      // Десятка: у сервиса список глубже — места 11–30 нужны только диагнозу.
      lists[m.system.key] = (
        r.rankings?.lists.get(m.system.key)?.[i] ?? []
      ).slice(0, m.system.depth);
    }
    queries[q.id] = lists;
  });
  return {
    judge: JUDGE_MODEL,
    sets: r.versions,
    included: r.included.length,
    systems,
    queries,
  };
}
