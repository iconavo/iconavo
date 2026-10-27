// Страница песочницы ядра (фаза 3, шаг 2). Скрипты — только свои: /sandbox.js и файлы ядра с этого
// же сервера; import map разрешён по хэшу. Ядро ходит только на выбранный хост API (connect-src), а
// имена иконок лежат в странице блоком JSON, чтобы в журнале и в DevTools были одни запросы ядра.

import { createHash } from "node:crypto";
import { BASE_STYLE, esc } from "../report/html.js";
import {
  COUNTS,
  DEFAULT_COUNT,
  DEFAULT_SET,
  LIVE_API,
  PER_SET,
  PREVIEW_API,
} from "./config.js";

/** Данные для скрипта страницы: client.ts читает их из блока #sandbox-data. */
export interface SandboxData {
  api: string;
  /** Видимые имена каждого набора, по кодам символов; порядок наборов — как в sources/. */
  names: Record<string, string[]>;
  counts: readonly number[];
  defaultCount: number;
  defaultSet: string;
  perSet: number;
}

/** Ядро — файлами tsc из packages/core/dist, как его импортирует сборщик разработчика. */
export const IMPORT_MAP = JSON.stringify({
  imports: {
    "@iconavo-ui/core": "/core/index.js",
    "@iconavo-ui/core/internal": "/core/internal.js",
  },
});

export const IMPORT_MAP_HASH = `sha256-${createHash("sha256").update(IMPORT_MAP, "utf8").digest("base64")}`;

export const sandboxCsp = (api: string) =>
  `default-src 'none'; script-src 'self' '${IMPORT_MAP_HASH}'; connect-src ${api}; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;

/** JSON внутри <script>: «<» экранируется, и текст не закроет блок раньше времени. */
const jsonInScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const STYLE = `
body { max-width: 1200px; }
.hosts a { margin-right: 12px; } .hosts .current { font-weight: 600; text-decoration: none; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 16px 0 8px; }
.controls label { display: flex; gap: 6px; align-items: center; }
select, button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; }
button { cursor: pointer; } button:hover { border-color: var(--muted); }
#grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 4px; margin: 12px 0; font-size: 24px; }
.cell { height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid transparent; }
.cell.loading { background: var(--code); }
.cell.missing { border: 1px dashed var(--stop); }
.cell.error { border: 1px solid var(--stop); }
.cell svg { display: block; }
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
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(sandboxCsp(data.api))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Песочница ядра</title>
<style>${BASE_STYLE}${STYLE}</style>
<script type="importmap">${IMPORT_MAP}</script>
<script type="application/json" id="sandbox-data">${jsonInScript(data)}</script>
<script type="module" src="/sandbox.js"></script>
</head>
<body>
<h1>Песочница ядра</h1>
<p class="muted">Иконки грузит ядро <code>@iconavo-ui/core</code> с хоста <code>${esc(data.api)}</code>. Иконки, запрошенные в один момент, уходят одним запросом на набор; адрес — не длиннее 500 символов, поэтому 100 иконок — это 3–5 запросов. Загруженная иконка в сеть больше не идёт.</p>
<p class="hosts">Хост API: ${host(LIVE_API, "живой api.iconavo.dev")} ${host(PREVIEW_API, "превью на этом компьютере (pnpm api preview)")}</p>
<div class="controls">
<label>Набор <select id="set">${setOptions}</select></label>
<label>Иконок <select id="count">${countOptions}</select></label>
<button type="button" id="show">Показать</button>
<button type="button" id="again">Показать ещё раз</button>
<button type="button" id="next">Следующие</button>
<button type="button" id="clear">Очистить журнал</button>
</div>
<p id="status" class="muted">Скрипт страницы загружается…</p>
<div id="grid"></div>
<h2>Журнал запросов</h2>
<p id="totals"></p>
<table id="log"><thead><tr><th class="num">№</th><th class="num">С начала</th><th>Адрес</th><th class="num">Имён</th><th class="num">Длина адреса</th><th class="num">Ответ</th><th class="num">Получено</th><th class="num">Нет</th><th class="num">Время</th><th class="num">Размер</th></tr></thead><tbody></tbody></table>
<h2>Как сверить с DevTools</h2>
<ol>
<li>Откройте DevTools → Network и впишите в фильтр <code>${esc(new URL(data.api).host)}</code>.</li>
<li>Нажмите «Показать»: строк в Network столько же, сколько запросов в журнале.</li>
<li>Нажмите «Показать ещё раз»: новых строк нет ни там, ни здесь — иконки уже в памяти страницы.</li>
<li>После перезагрузки страницы память пуста, и запросы пойдут снова, но браузер может ответить из своего кэша — в Network это «(disk cache)».</li>
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
  names,
  counts: COUNTS,
  defaultCount: DEFAULT_COUNT,
  defaultSet: DEFAULT_SET,
  perSet: PER_SET,
});
