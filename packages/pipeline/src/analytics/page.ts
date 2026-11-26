// Страница и таблица в терминале отчёта pnpm analytics (шаг 2 фазы 5, ADR-0043). В отчёте — тексты
// запросов людей: он лежит только локально (.cache/reports/analytics/, в git его нет) и в CI не строится —
// логи и артефакты CI открыты.

import { esc, htmlPage } from "../report/html.js";
import {
  type AnalyticsReport,
  FAILED_DAYS,
  type KeyCount,
  successRate,
  type TextCount,
} from "./report.js";

const LANG_TITLES: Record<string, string> = { en: "en", ru: "ru" };

const share = (part: number, total: number) =>
  total === 0 ? "—" : `${Math.round((part / total) * 100)}%`;

function keyTable(title: string, rows: readonly KeyCount[], label: string) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const body =
    rows.length === 0
      ? `<p class="muted">пока нет</p>`
      : `<table><tr><th>${esc(label)}</th><th class="num">Раз</th><th class="num">Доля</th></tr>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.key === "" ? "—" : r.key)}</td><td class="num">${r.count}</td><td class="num">${share(r.count, total)}</td></tr>`,
          )
          .join("")}</table>`;
  return `<h3>${esc(title)}</h3>${body}`;
}

function failedTable(title: string, rows: readonly TextCount[]) {
  const body =
    rows.length === 0
      ? `<p class="muted">нет</p>`
      : `<table><tr><th>Запрос</th><th>Язык</th><th class="num">Повторов</th></tr>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.q)}</td><td>${esc(LANG_TITLES[r.lang] ?? r.lang)}</td><td class="num">${r.count}</td></tr>`,
          )
          .join("")}</table>`;
  return `<h3>${esc(title)}</h3>${body}`;
}

const seconds = (s: number | undefined) =>
  s === undefined
    ? "—"
    : s < 90
      ? `${Math.round(s)} с`
      : `${(s / 60).toFixed(1).replace(".", ",")} мин`;

export function renderAnalyticsPage(r: AnalyticsReport): string {
  const weeks =
    r.weeksTable.length === 0
      ? `<p class="muted">событий поиска пока нет</p>`
      : `<table><tr><th>Неделя</th><th>Язык</th><th class="num">Сессии</th><th class="num">Успехи</th><th class="num">Успех поиска</th><th class="num">Запросы</th><th class="num">Без результатов</th><th class="num">Без кликов</th><th class="num">Просмотры</th></tr>${r.weeksTable
          .map(
            (w) =>
              `<tr><td>${esc(w.week)}</td><td>${esc(LANG_TITLES[w.lang] ?? w.lang)}</td><td class="num">${w.sessions}</td><td class="num">${w.successes}</td><td class="num"><b>${successRate(w.successes, w.sessions)}</b></td><td class="num">${w.queries}</td><td class="num">${w.noresults}</td><td class="num">${w.noclick}</td><td class="num">${w.views}</td></tr>`,
          )
          .join("")}</table>`;
  const countries =
    r.countries.length === 0
      ? `<p class="muted">пока нет</p>`
      : `<table><tr><th>Страна</th><th class="num">Просмотры</th><th class="num">Сессии</th><th class="num">Успехи</th><th class="num">Успех поиска</th></tr>${r.countries
          .map(
            (c) =>
              `<tr><td>${esc(c.country === "" ? "—" : c.country)}</td><td class="num">${c.views}</td><td class="num">${c.sessions}</td><td class="num">${c.successes}</td><td class="num">${successRate(c.successes, c.sessions)}</td></tr>`,
          )
          .join("")}</table>`;
  const body = `
<h1>Аналитика iconavo.dev</h1>
<p class="muted">С ${esc(r.from)} по ${esc(r.to)} (UTC), недель: ${r.weeks}. Сырые события — с ${esc(r.rawFrom)}: всё, что раньше, — из итогов дня, без текстов запросов. Событий людей за 30 дней: ${r.total}.</p>
<p class="muted">Проверочные пачки pnpm api check за 30 дней: событий ${r.tests.events}, отказов ${r.tests.rejects} — в счёт не идут; есть — значит, запись в базу работает.</p>
<h2>Успех поиска</h2>
<p>Доля поисковых сессий, которые закончились копированием или скачиванием; ориентир к запуску — от 50% (docs/roadmap.md). Сессия — от первого засчитанного запроса до первого копирования или скачивания во вкладке.</p>
${weeks}
<h2>Неудачные запросы за ${FAILED_DAYS} дней</h2>
<p class="muted">Сырьё для настройки поиска и пополнения эталона (ADR-0021).</p>
${failedTable("Без результатов", r.noResults)}
${failedTable("Без кликов: выдача была, но иконку не открыли, не скопировали и не скачали", r.noClicks)}
<h2>За 30 дней</h2>
${keyTable("Место первой открытой иконки в выдаче", r.positions, "Место")}
<h3>Время до первой иконки</h3>
<p>Медиана от входа на сайт до первого копирования или скачивания во вкладке: <b>${seconds(r.firstIcon.median)}</b> <span class="muted">(вкладок: ${r.firstIcon.count}; ориентир — меньше минуты)</span></p>
${keyTable("Что копируют", r.copies, "Что")}
${keyTable("Что скачивают", r.downloads, "Формат")}
${keyTable("Наборы скопированных и скачанных иконок", r.sets, "Набор")}
${keyTable("Иконки — первые 20", r.icons, "Иконка")}
${keyTable("Откуда открывают иконку", r.opens, "Откуда")}
${keyTable("Переключения стиля", r.styles, "Где : стиль")}
${keyTable("Просмотры по разделам", r.sections, "Раздел")}
<h3>Страны</h3>
${countries}
${keyTable("Отклонённые события и пачки", r.rejects, "Причина")}
`;
  return htmlPage("Аналитика iconavo.dev", "", body);
}

/** Таблица в терминале: успех поиска по неделям и главное. */
export function formatAnalytics(r: AnalyticsReport): string[] {
  const lines = [
    `Аналитика iconavo.dev: с ${r.from} по ${r.to} (UTC); сырые события — с ${r.rawFrom}, событий людей за 30 дней: ${r.total}.`,
    "",
  ];
  const rows = [
    [
      "Неделя",
      "Язык",
      "Сессии",
      "Успехи",
      "Успех",
      "Запросы",
      "Без результатов",
      "Без кликов",
    ],
    ...r.weeksTable.map((w) => [
      w.week,
      w.lang,
      String(w.sessions),
      String(w.successes),
      successRate(w.successes, w.sessions),
      String(w.queries),
      String(w.noresults),
      String(w.noclick),
    ]),
  ];
  if (r.weeksTable.length === 0) {
    lines.push("Событий поиска пока нет.");
  } else {
    const widths =
      rows[0]?.map((_, i) =>
        Math.max(...rows.map((row) => (row[i] ?? "").length)),
      ) ?? [];
    for (const row of rows) {
      lines.push(
        row
          .map((cell, i) =>
            i < 2 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
          )
          .join("  "),
      );
    }
  }
  lines.push(
    "",
    `Без результатов за ${FAILED_DAYS} дней: ${r.noResults.length} запросов, без кликов: ${r.noClicks.length}. Время до первой иконки (медиана): ${seconds(r.firstIcon.median)}.`,
    `Отклонено за 30 дней: ${r.rejects.reduce((s, x) => s + x.count, 0)}. Проверочные пачки: событий ${r.tests.events}, отказов ${r.tests.rejects}.`,
  );
  return lines;
}
