// Скрипт страницы песочницы (фаза 3, шаги 2 и 3): работает в браузере, не в Node. Ядро подключается
// import map страницы из packages/core/dist — так же, как его импортирует сборщик разработчика.
// fetch оборачивается до первой иконки: журнал видит каждый запрос ядра, а сбои хостов изображает
// сама обёртка — ядро о них не знает. Что обёртка не пропустила, в сеть не уходит, поэтому «ушло в
// сеть» в журнале совпадает с числом строк во вкладке Network в DevTools.

import { configure } from "@iconavo-ui/core";
import {
  getIcon,
  iconToSvg,
  loadIcon,
  subscribeIcon,
  svgToString,
} from "@iconavo-ui/core/internal";
import type { SandboxData, SandboxHost } from "./page.js";

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
const missingBox = $<HTMLInputElement>("missing");

// Условия сети: состояние каждого хоста ядра.

type Mode = "ok" | "down" | "silent" | "slow";

const modes = new Map<string, Mode>(data.hosts.map((h) => [h.url, "ok"]));
const selects = [
  ...document.querySelectorAll<HTMLSelectElement>("select[data-host]"),
];
for (const select of selects) {
  select.onchange = () => {
    modes.set(select.dataset.host as string, select.value as Mode);
  };
}

/** Сценарии: состояние хоста по его месту в очереди ядра (0 — основной, edge API). */
const PRESETS: Record<string, (index: number) => Mode> = {
  ok: () => "ok",
  primary: (index) => (index === 0 ? "down" : "ok"),
  slow: () => "slow",
  silent: () => "silent",
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-preset]",
)) {
  button.onclick = () => {
    const preset = PRESETS[button.dataset.preset as string];
    if (!preset) return;
    data.hosts.forEach((host, index) => {
      const mode = preset(index);
      modes.set(host.url, mode);
      const select = selects.find((s) => s.dataset.host === host.url);
      if (select) select.value = mode;
    });
  };
}

/** Хост ядра для адреса — по самому длинному совпадению: статика превью лежит внутри адреса API. */
const hostOf = (url: string): SandboxHost | undefined =>
  data.hosts
    .filter((h) => url.startsWith(`${h.url}/`))
    .sort((a, b) => b.url.length - a.url.length)[0];

/** Пауза, которую прерывает отмена запроса ядром; без срока — пока ядро не отменит. */
const pause = (signal: AbortSignal | null | undefined, ms?: number) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

// Журнал запросов.

interface Row {
  /** Адрес хоста ядра; чужой адрес — пусто. */
  host: string;
  /** Запрос ушёл в сеть — есть строка в DevTools. */
  sent: boolean;
  names: number;
  received?: number;
  missing?: number;
}
const rows: Row[] = [];
const started = performance.now();
const original = window.fetch.bind(window);

const short = (url: string) => url.replace(/^https?:\/\//, "");

const cell = (text: string, className = "num") => {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
};

const since = (from: number) => `${Math.round(performance.now() - from)} мс`;

function renderTotals(): void {
  const sum = (key: "names" | "received" | "missing") =>
    rows.reduce((n, row) => n + (row[key] ?? 0), 0);
  const sent = rows.filter((row) => row.sent).length;
  const byHost = data.hosts
    .map(
      (h) =>
        `${short(h.url)}: ${rows.filter((row) => row.host === h.url).length}`,
    )
    .join(" · ");
  totals.textContent = `Запросов ядра: ${rows.length} · ушло в сеть: ${sent} — столько строк в DevTools · ${byHost} · имён в них: ${sum("names")} · получено: ${sum("received")} · нет: ${sum("missing")}`;
}

/**
 * Итог ответа — по копии тела. Её журнал дочитывает до того, как отдать ответ ядру: ядро, получив
 * ответы на все имена, отменяет запросы попытки, и недочитанная копия оборвалась бы. Ядро тело ждёт
 * всё равно, поэтому задержки нет.
 */
function describe(
  tr: HTMLTableRowElement,
  row: Row,
  response: Response,
  text: string,
  what: string,
  begin: number,
): void {
  if (response.status === 404) {
    row.received = 0;
    row.missing = row.names;
  } else if (what !== "манифест") {
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
  }
  tr.append(
    cell(String(response.status), ""),
    cell(row.received === undefined ? "—" : String(row.received)),
    cell(row.missing === undefined ? "—" : String(row.missing)),
    cell(since(begin)),
    cell(`${(new TextEncoder().encode(text).length / 1024).toFixed(1)} КБ`),
  );
  renderTotals();
}

window.fetch = async (input, init) => {
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  const host = hostOf(url);
  const mode = host ? (modes.get(host.url) ?? "ok") : "ok";
  const what =
    host?.kind === "api"
      ? "пачка"
      : url.endsWith("/manifest.json")
        ? "манифест"
        : "иконка";
  const icons = new URL(url, location.href).searchParams.get("icons");
  const row: Row = {
    host: host?.url ?? "",
    sent: false,
    names:
      what === "пачка"
        ? icons
          ? icons.split(",").length
          : 0
        : what === "иконка"
          ? 1
          : 0,
  };
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
    cell(since(started)),
    cell(host ? short(host.url) : "—", ""),
    cell(what, ""),
    address,
    cell(row.names > 0 ? String(row.names) : "—"),
    cell(String(url.length)),
  );
  renderTotals();
  const signal = init?.signal;
  const begin = performance.now();
  try {
    if (mode === "down") throw new TypeError("Failed to fetch");
    if (mode === "silent") await pause(signal);
    if (mode === "slow") await pause(signal, data.slow);
    row.sent = true;
    renderTotals();
    const response = await original(input, init);
    describe(tr, row, response, await response.clone().text(), what, begin);
    return response;
  } catch (e) {
    const outcome =
      mode === "down"
        ? "недоступен — имитация"
        : signal?.aborted
          ? row.sent
            ? "отменён ядром"
            : "отменён ядром до отправки"
          : `сбой: ${(e as Error).message}`;
    tr.append(cell(outcome, ""), cell(""), cell(""), cell(since(begin)));
    renderTotals();
    throw e;
  }
};

configure({
  api: data.hosts.filter((h) => h.kind === "api").map((h) => h.url),
  cdn: data.hosts.filter((h) => h.kind === "cdn").map((h) => h.url),
});

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
      : `${name} — ${state === "missing" ? "нет такой иконки" : "не загрузилась после всех повторов"}`;
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

/** Имена текущей страницы: набор или по perSet из каждого набора; с флажком — и иконки, которых нет. */
function pick(): string[] {
  const set = setSelect.value;
  const count = Number(countSelect.value);
  const names =
    set === "all"
      ? Object.entries(data.names).flatMap(([id, names]) =>
          names
            .slice(page * data.perSet, (page + 1) * data.perSet)
            .map((name) => `${id}:${name}`),
        )
      : (data.names[set] ?? [])
          .slice(page * count, (page + 1) * count)
          .map((name) => `${set}:${name}`);
  return missingBox.checked && names.length > 0
    ? [...data.missing, ...names]
    : names;
}

function show(): void {
  const names = pick();
  const set = setSelect.value === "all" ? "все пять наборов" : setSelect.value;
  status.textContent =
    names.length === 0
      ? `Дальше иконок нет: ${set}. Нажмите «Показать» — начнём сначала.`
      : `Показано ${names.length}: ${set}, страница ${page + 1}. Сверьте журнал с DevTools → Network (Fetch/XHR).`;
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
  "Откройте DevTools → Network (Fetch/XHR), выберите набор и нажмите «Показать».";
