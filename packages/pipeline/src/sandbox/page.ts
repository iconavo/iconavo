// Страница песочницы ядра (фаза 3, шаги 2 и 3): загрузка и сеть; сетка вариантов рендера — на
// странице /render (render-page.ts). Скрипты — только свои: /sandbox.js и файлы ядра с этого же
// сервера; import map разрешён по хэшу. Ядро ходит только на хосты режима (connect-src), а имена
// иконок лежат в странице блоком JSON, чтобы в журнале и в DevTools были одни запросы ядра.

import { createHash } from "node:crypto";
import {
  DEFAULT_API,
  DEFAULT_CDN,
  RETRIES,
  ROTATE,
  ROTATE_CDN,
  TIMEOUT,
} from "@iconavo-ui/core/internal";
import { BASE_STYLE, esc } from "../report/html.js";
import {
  COUNTS,
  DEFAULT_COUNT,
  DEFAULT_SET,
  LIVE_API,
  MISSING_NAMES,
  PER_SET,
  PREVIEW_API,
  PREVIEW_STATIC,
  SLOW_MS,
} from "./config.js";

/** Хост ядра: пачки (api) или по одной иконке со статики (cdn). */
export interface SandboxHost {
  url: string;
  kind: "api" | "cdn";
}

/** Данные для скрипта страницы: client.ts читает их из блока #sandbox-data. */
export interface SandboxData {
  /** Хост API режима: живой edge API или превью на этом компьютере. */
  api: string;
  /** Хосты ядра по порядку: их ядро получает через configure, их состояния меняет имитация. */
  hosts: SandboxHost[];
  /** Видимые имена каждого набора, по кодам символов; порядок наборов — как в sources/. */
  names: Record<string, string[]>;
  counts: readonly number[];
  defaultCount: number;
  defaultSet: string;
  perSet: number;
  /** Задержка «медленного» хоста, мс. */
  slow: number;
  /** Иконки, которых нет, — для флажка. */
  missing: readonly string[];
}

/**
 * Хосты режима: у живого — хосты ядра по умолчанию; у превью всё на этом компьютере — API превью и
 * его статика из dist-cdn/.
 */
export function sandboxHosts(api: string): SandboxHost[] {
  if (api !== LIVE_API) {
    return [
      { url: api, kind: "api" },
      { url: `${api}${PREVIEW_STATIC}`, kind: "cdn" },
    ];
  }
  return [
    ...DEFAULT_API.map((url): SandboxHost => ({ url, kind: "api" })),
    ...DEFAULT_CDN.map((url): SandboxHost => ({ url, kind: "cdn" })),
  ];
}

/** Ядро — файлами tsc из packages/core/dist, как его импортирует сборщик разработчика. */
export const IMPORT_MAP = JSON.stringify({
  imports: {
    "@iconavo-ui/core": "/core/index.js",
    "@iconavo-ui/core/internal": "/core/internal.js",
  },
});

/** Хэш встроенного скрипта или стиля для CSP. */
export const cspHash = (text: string) =>
  `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;

export const IMPORT_MAP_HASH = cspHash(IMPORT_MAP);

/** Источники запросов ядра — хосты режима. */
const origins = (hosts: SandboxHost[]) =>
  [...new Set(hosts.map((h) => new URL(h.url).origin))].join(" ");

/** Политика страницы: сеть — только хосты режима. */
export const sandboxCsp = (hosts: SandboxHost[]) =>
  `default-src 'none'; script-src 'self' '${IMPORT_MAP_HASH}'; connect-src ${origins(hosts)}; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;

/**
 * Строгая политика страниц тега — какую README предлагает сайтам (ADR-0032): скрипты — свои и import
 * map по хэшу, стиль — только <style> страницы по хэшу, без 'unsafe-inline', разметка — только через
 * политику Trusted Types iconavo. Стили тега (adoptedStyleSheets) и свойства стиля из скрипта она
 * не запрещает.
 */
export const strictCsp = (
  hosts: SandboxHost[],
  importMap: string,
  style: string,
) =>
  `default-src 'none'; script-src 'self' '${cspHash(importMap)}'; connect-src ${origins(hosts)}; img-src data:; style-src '${cspHash(style)}'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types iconavo`;

/** Пустая иконка вкладки: иначе браузер сам просит /favicon.ico, а строгая политика это запрещает. */
export const NO_FAVICON = '<link rel="icon" href="data:,">';

/** Страницы песочницы по порядку в меню. */
export const SANDBOX_PAGES = [
  ["/", "Загрузка и сеть"],
  ["/render", "Рендер"],
  ["/tag", "Тег"],
  ["/many", "5000 иконок"],
  ["/net", "Сбои сети"],
] as const;

export type SandboxPage = (typeof SANDBOX_PAGES)[number][0];

/** JSON внутри <script>: «<» экранируется, и текст не закроет блок раньше времени. */
export const jsonInScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** Ссылки между страницами песочницы с тем же хостом API; текущая — без ссылки. */
export function sandboxNav(api: string, current: SandboxPage): string {
  const query = api === LIVE_API ? "" : `?api=${encodeURIComponent(api)}`;
  return `<p class="nav">${SANDBOX_PAGES.map(([path, label]) =>
    path === current
      ? `<b>${label}</b>`
      : `<a href="${esc(`${path}${query}`)}">${label}</a>`,
  ).join(" · ")}</p>`;
}

/** Адрес хоста без схемы — для подписей. */
const short = (url: string) => url.replace(/^https?:\/\//, "");

/** Паузы перед повторами ядра в секундах: 1, 2 и 4. */
const PAUSES = Array.from({ length: RETRIES }, (_, i) => 2 ** i);

const STYLE = `
body { max-width: 1200px; }
.hosts a { margin-right: 12px; } .hosts .current { font-weight: 600; text-decoration: none; }
.nav { margin: 0 0 16px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 16px 0 8px; }
.controls label { display: flex; gap: 6px; align-items: center; }
select, button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; }
button { cursor: pointer; } button:hover { border-color: var(--muted); }
.network { border: 1px solid var(--line); border-radius: 12px; padding: 4px 16px 12px; margin: 16px 0; }
.network h2 { margin-top: 12px; }
.network table { width: auto; } .network td { padding: 4px 16px 4px 0; border: none; vertical-align: middle; }
#grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 4px; margin: 12px 0; font-size: 24px; }
.cell { height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid transparent; }
.cell.loading { background: var(--code); }
.cell.missing { border: 1px dashed var(--stop); }
.cell.error { border: 1px solid var(--stop); }
.cell svg { display: block; }
.legend .cell { display: inline-block; width: 16px; height: 16px; vertical-align: middle; margin: 0 4px 0 12px; border-radius: 4px; }
#totals { font-variant-numeric: tabular-nums; }
#log td { font-size: 13px; } #log .url { word-break: break-all; }
`;

export function renderSandboxPage(data: SandboxData): string {
  const sets = Object.keys(data.names);
  const host = (href: string, label: string) =>
    data.api === href
      ? `<a class="current" href="/?api=${esc(encodeURIComponent(href))}">${esc(label)}</a>`
      : `<a href="/?api=${esc(encodeURIComponent(href))}">${esc(label)}</a>`;
  const setOptions = [...sets, "all"]
    .map((id) => {
      const label =
        id === "all"
          ? `все пять — по ${data.perSet} из каждого`
          : `${id} — ${data.names[id]?.length ?? 0}`;
      return `<option value="${esc(id)}"${id === data.defaultSet ? " selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
  const countOptions = data.counts
    .map(
      (n) =>
        `<option value="${n}"${n === data.defaultCount ? " selected" : ""}>${n}</option>`,
    )
    .join("");
  const seconds = (ms: number) => `${ms / 1000} с`.replace(".", ",");
  const modes = [
    ["ok", "работает"],
    ["down", "недоступен"],
    ["silent", "молчит"],
    ["slow", `медленный (+${seconds(data.slow)})`],
  ]
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  const hostRows = data.hosts
    .map(
      (h) =>
        `<tr><td><code>${esc(short(h.url))}</code></td><td class="muted">${h.kind === "api" ? "пачки" : "по одной"}</td><td><select data-host="${esc(h.url)}" aria-label="${esc(short(h.url))}">${modes}</select></td></tr>`,
    )
    .join("");
  const cdn = data.hosts.filter((h) => h.kind === "cdn");
  const missing = data.missing
    .map((name) => `<code>${esc(name)}</code>`)
    .join(", ");
  const pauses = `${PAUSES.slice(0, -1).join(", ")} и ${PAUSES.at(-1)} с`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(sandboxCsp(data.hosts))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Песочница ядра</title>
<style>${BASE_STYLE}${STYLE}</style>
<script type="importmap">${IMPORT_MAP}</script>
<script type="application/json" id="sandbox-data">${jsonInScript(data)}</script>
<script type="module" src="/sandbox.js"></script>
</head>
<body>
${sandboxNav(data.api, "/")}
<h1>Песочница ядра</h1>
<p class="muted">Иконки грузит ядро <code>@iconavo-ui/core</code>. Иконки, запрошенные в один момент, уходят одним запросом на набор; адрес — не длиннее 500 символов, поэтому 100 иконок — это 3–5 запросов. Загруженная иконка и иконка, которой нет, в сеть больше не идут.</p>
<p class="muted">Хосты — по очереди: пачками через <code>${esc(short(data.api))}</code>, затем по одной иконке со статики ${cdn.map((h) => `<code>${esc(short(h.url))}</code>`).join(" → ")}. API молчит ${seconds(ROTATE_CDN)} — тот же запрос уходит и на статику; хост статики молчит ${ROTATE} мс — и на следующий; побеждает первый ответ. Попытка — не дольше ${seconds(TIMEOUT)}; неудавшаяся повторяется через ${pauses}, пока иконка на странице.</p>
<p class="hosts">Хост API: ${host(LIVE_API, "живой api.iconavo.dev")} ${host(PREVIEW_API, "превью на этом компьютере (pnpm api preview) — и статика тоже")}</p>
<section class="network">
<h2>Условия сети — имитация в песочнице</h2>
<div class="controls">
<button type="button" data-preset="ok">Всё работает</button>
<button type="button" data-preset="primary">Основной хост недоступен</button>
<button type="button" data-preset="slow">Медленная сеть</button>
<button type="button" data-preset="silent">Ничего не отвечает</button>
</div>
<table>${hostRows}</table>
<p class="muted">Недоступен — ошибка сети сразу, как Block request domain в DevTools. Молчит — не отвечает, пока ядро не отменит запрос. Медленный — запрос уходит на ${seconds(data.slow)} позже. Ядро об имитации не знает; что песочница не пропустила, в сеть не уходит. Состояния действуют сразу, и на повторы тоже.</p>
<label><input type="checkbox" id="missing"> Добавить иконки, которых нет: ${missing}</label>
</section>
<div class="controls">
<label>Набор <select id="set">${setOptions}</select></label>
<label>Иконок <select id="count">${countOptions}</select></label>
<button type="button" id="show">Показать</button>
<button type="button" id="again">Показать ещё раз</button>
<button type="button" id="next">Следующие</button>
<button type="button" id="clear">Очистить журнал</button>
</div>
<p id="status" class="muted">Скрипт страницы загружается…</p>
<p class="legend muted"><span class="cell loading"></span>грузится, в том числе пока идут повторы <span class="cell missing"></span>иконки нет <span class="cell error"></span>не загрузилась после всех повторов</p>
<div id="grid"></div>
<h2>Журнал запросов</h2>
<p id="totals"></p>
<table id="log"><thead><tr><th class="num">№</th><th class="num">С начала</th><th>Хост</th><th>Что</th><th>Адрес</th><th class="num">Имён</th><th class="num">Длина адреса</th><th>Итог</th><th class="num">Получено</th><th class="num">Нет</th><th class="num">Время</th><th class="num">Размер</th></tr></thead><tbody></tbody></table>
<h2>Как сверить с DevTools</h2>
<ol>
<li>Откройте DevTools → Network и выберите фильтр Fetch/XHR.</li>
<li>Нажмите «Показать»: строк в Network столько же, сколько «ушло в сеть» в итоге журнала. Запросы, которые песочница не пропустила («недоступен — имитация», «отменён ядром до отправки»), есть только в журнале.</li>
<li>Нажмите «Показать ещё раз»: новых строк нет ни там, ни здесь — иконки уже в памяти страницы. Запрашиваются снова только иконки в рамке, не загрузившиеся после всех повторов.</li>
<li>После перезагрузки страницы память пуста, и запросы пойдут снова, но браузер может ответить из своего кэша — в Network это «(disk cache)».</li>
</ol>
<h2>Проверка через DevTools</h2>
<p class="muted">Три ручные проверки шага 3 из docs/phase-3.md — на настоящей сети, без имитации. После них снимите блокировку и троттлинг.</p>
<ol>
<li>Network → правый клик по запросу к <code>${esc(new URL(data.api).host)}</code> → Block request domain, затем «Следующие»: иконки приходят по одной со статики. В режиме превью API и статика на одном адресе — блокировка выключит оба.</li>
<li>Network → троттлинг Slow 4G, затем «Следующие»: иконки появляются, клетки не прыгают.</li>
<li>Флажок «Добавить иконки, которых нет», затем «Показать»: клетки с пунктиром и в Console по одному предупреждению на имя.</li>
</ol>
</body>
</html>
`;
}

export const sandboxData = (
  api: string,
  names: Record<string, string[]>,
): SandboxData => ({
  api,
  hosts: sandboxHosts(api),
  names,
  counts: COUNTS,
  defaultCount: DEFAULT_COUNT,
  defaultSet: DEFAULT_SET,
  perSet: PER_SET,
  slow: SLOW_MS,
  missing: MISSING_NAMES,
});
