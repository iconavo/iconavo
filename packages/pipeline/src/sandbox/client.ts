// Скрипт страницы песочницы (фаза 3, шаг 2): работает в браузере, не в Node. Ядро подключается
// import map страницы из packages/core/dist — так же, как его импортирует сборщик разработчика.
// fetch оборачивается до первой иконки: журнал видит ровно те запросы, что уходят в сеть, и их
// число совпадает со вкладкой Network в DevTools.

import { configure } from "@iconavo-ui/core";
import {
  getIcon,
  iconToSvg,
  loadIcon,
  subscribeIcon,
  svgToString,
} from "@iconavo-ui/core/internal";
import type { SandboxData } from "./page.js";

const data = JSON.parse(
  document.getElementById("sandbox-data")?.textContent ?? "{}",
) as SandboxData;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const grid = $<HTMLDivElement>("grid");
const status = $<HTMLParagraphElement>("status");
const totals = $<HTMLParagraphElement>("totals");
const log = $<HTMLTableElement>("log").tBodies[0] as HTMLTableSectionElement;
const setSelect = $<HTMLSelectElement>("set");
const countSelect = $<HTMLSelectElement>("count");

// Журнал запросов.

interface Row {
  names: number;
  received?: number;
  missing?: number;
}
const rows: Row[] = [];
const started = performance.now();
const original = window.fetch.bind(window);

const cell = (text: string, className = "num") => {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
};

function renderTotals(): void {
  const sum = (key: keyof Row) =>
    rows.reduce((n, row) => n + (row[key] ?? 0), 0);
  totals.textContent = `Запросов: ${rows.length} · имён в них: ${sum("names")} · получено: ${sum("received")} · нет: ${sum("missing")}`;
}

window.fetch = async (input, init) => {
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  const icons = new URL(url, location.href).searchParams.get("icons");
  const row: Row = { names: icons ? icons.split(",").length : 0 };
  rows.push(row);
  const tr = log.insertRow();
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = url;
  const address = cell("", "url");
  address.append(link);
  tr.append(
    cell(String(rows.length)),
    cell(`${Math.round(performance.now() - started)} мс`),
    address,
    cell(String(row.names)),
    cell(String(url.length)),
  );
  renderTotals();
  const begin = performance.now();
  try {
    const response = await original(input, init);
    const text = await response.clone().text();
    try {
      const body = JSON.parse(text) as {
        icons?: object;
        aliases?: object;
        not_found?: unknown[];
      };
      row.received =
        Object.keys(body.icons ?? {}).length +
        Object.keys(body.aliases ?? {}).length;
      row.missing = body.not_found?.length ?? 0;
    } catch {
      row.received = 0;
    }
    tr.append(
      cell(String(response.status)),
      cell(String(row.received)),
      cell(String(row.missing ?? 0)),
      cell(`${Math.round(performance.now() - begin)} мс`),
      cell(`${(new TextEncoder().encode(text).length / 1024).toFixed(1)} КБ`),
    );
    renderTotals();
    return response;
  } catch (e) {
    tr.append(cell(`сбой: ${(e as Error).message}`, ""));
    throw e;
  }
};

configure({ api: [data.api] });

// Сетка иконок.

let stops: (() => void)[] = [];
let shown: string[] = [];
let page = 0;

function draw(div: HTMLDivElement, name: string): void {
  const state = getIcon(name);
  div.className = `cell ${typeof state === "object" ? "loaded" : state}`;
  div.title =
    typeof state === "object" || state === "loading"
      ? name
      : `${name} — ${state === "missing" ? "нет такой иконки" : "ошибка загрузки"}`;
  // Данные с нашего хоста очищены конвейером (ADR-0013); рендер ядра с ID и доступностью — шаг 4.
  div.innerHTML =
    typeof state === "object" ? svgToString(iconToSvg(state)) : "";
}

function render(names: string[]): void {
  for (const stop of stops) stop();
  stops = [];
  grid.replaceChildren();
  shown = names;
  for (const name of names) {
    const div = document.createElement("div");
    grid.append(div);
    stops.push(subscribeIcon(name, () => draw(div, name)));
    loadIcon(name);
    draw(div, name);
  }
}

/** Имена текущей страницы: набор или по perSet из каждого набора. */
function pick(): string[] {
  const set = setSelect.value;
  const count = Number(countSelect.value);
  if (set === "all") {
    return Object.entries(data.names).flatMap(([id, names]) =>
      names
        .slice(page * data.perSet, (page + 1) * data.perSet)
        .map((name) => `${id}:${name}`),
    );
  }
  const names = data.names[set] ?? [];
  return names
    .slice(page * count, (page + 1) * count)
    .map((name) => `${set}:${name}`);
}

function show(): void {
  const names = pick();
  const set = setSelect.value === "all" ? "все пять наборов" : setSelect.value;
  status.textContent =
    names.length === 0
      ? `Дальше иконок нет: ${set}. Нажмите «Показать» — начнём сначала.`
      : `Показано ${names.length}: ${set}, страница ${page + 1}. Сверьте журнал с DevTools → Network.`;
  render(names);
}

$<HTMLButtonElement>("show").onclick = () => {
  page = 0;
  show();
};
$<HTMLButtonElement>("next").onclick = () => {
  page++;
  show();
};
$<HTMLButtonElement>("again").onclick = () => {
  const again = shown.length > 0 ? shown : pick();
  render([]);
  // Кадр без сетки — и те же имена заново: они уже в памяти страницы, в сеть не уходят.
  requestAnimationFrame(() => render(again));
};
$<HTMLButtonElement>("clear").onclick = () => {
  rows.length = 0;
  log.replaceChildren();
  renderTotals();
};
setSelect.onchange = countSelect.onchange = () => {
  page = 0;
};

// Сама страница ничего не грузит: сначала DevTools → Network, потом «Показать» — так вкладка
// увидит все запросы, а память страницы пуста.
renderTotals();
status.textContent =
  "Откройте DevTools → Network, выберите набор и нажмите «Показать».";
