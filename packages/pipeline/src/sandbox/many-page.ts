// Страница «5000 иконок» песочницы (фаза 3, шаг 5): по 1000 первых видимых имён каждого из пяти
// наборов тегами <iconavo-icon> прямо в HTML, рядом — имя иконки. Подключение — как в README для
// страниц без сборщика: строка CSS :not(:defined) и скрипт /icon/iconavo-icon.js, а configure скрипт
// страницы импортирует из того же адреса (import map). Иконки грузятся, когда подходят к видимой
// части страницы. Сверху — счётчики (нарисовано, запросов, кадры), кнопки цвета и размера текста;
// ?slow-script=1 отдаёт скрипт тега на 2 с позже — видно место до его загрузки. Политика — строгая,
// как на странице тега.

import { BASE_STYLE, esc } from "../report/html.js";
import {
  LIVE_API,
  MANY_PER_SET,
  PREVIEW_API,
  SLOW_SCRIPT_MS,
} from "./config.js";
import {
  jsonInScript,
  NO_FAVICON,
  type SandboxHost,
  sandboxHosts,
  sandboxNav,
  strictCsp,
} from "./page.js";
import { STANDALONE_SCRIPT, UNDEFINED_RULE } from "./tag-page.js";

/** Данные для скрипта страницы: many-client.ts читает их из блока #many-data. */
export interface ManyData {
  api: string;
  hosts: SandboxHost[];
  slowScript: boolean;
}

/** Пакет — скрипт для страниц без сборщика; с ?slow-script — с задержкой на сервере. */
export const manyImportMap = (slowScript: boolean) =>
  JSON.stringify({
    imports: {
      "@iconavo-ui/icon": slowScript
        ? `${STANDALONE_SCRIPT}?delay=${SLOW_SCRIPT_MS}`
        : STANDALONE_SCRIPT,
    },
  });

/** Стиль страницы целиком: его хэш стоит в CSP. */
export const MANY_STYLE = `${BASE_STYLE}
${UNDEFINED_RULE}
body { max-width: 1400px; }
.nav { margin: 0 0 16px; }
.hosts a { margin-right: 12px; } .hosts .current { font-weight: 600; text-decoration: none; }
.bar { position: sticky; top: 0; z-index: 1; background: var(--bg); border-bottom: 1px solid var(--line); padding: 8px 0; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 14px; font-variant-numeric: tabular-nums; }
.bar button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
#icons { font-size: 20px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 12px; }
.c { display: flex; align-items: center; gap: 8px; min-width: 0; }
.c span { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** По MANY_PER_SET первых видимых имён каждого набора — в порядке наборов. */
export function manySets(
  names: Record<string, string[]>,
): [string, string[]][] {
  return Object.entries(names).map(([set, list]) => [
    set,
    list.slice(0, MANY_PER_SET),
  ]);
}

export function renderManyPage(
  data: ManyData,
  sets: [string, string[]][],
): string {
  const importMap = manyImportMap(data.slowScript);
  const query = (api: string, slow: boolean) => {
    const params = new URLSearchParams();
    if (api !== LIVE_API) params.set("api", api);
    if (slow) params.set("slow-script", "1");
    const text = params.toString();
    return `/many${text ? `?${text}` : ""}`;
  };
  const host = (href: string, label: string) =>
    data.api === href
      ? `<a class="current" href="${esc(query(href, data.slowScript))}">${esc(label)}</a>`
      : `<a href="${esc(query(href, data.slowScript))}">${esc(label)}</a>`;
  const total = sets.reduce((n, [, list]) => n + list.length, 0);
  const sections = sets
    .map(
      ([set, list]) =>
        `<section><h2>${esc(set)} — ${list.length}</h2><div class="grid">${list
          .map(
            (name) =>
              `<div class="c"><iconavo-icon icon="${esc(`${set}:${name}`)}"></iconavo-icon><span>${esc(name)}</span></div>`,
          )
          .join("")}</div></section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(strictCsp(data.hosts, importMap, MANY_STYLE))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${NO_FAVICON}
<title>Песочница: 5000 иконок</title>
<style>${MANY_STYLE}</style>
<script type="importmap">${importMap}</script>
<script type="application/json" id="many-data">${jsonInScript(data)}</script>
<script type="module" src="/many.js"></script>
</head>
<body>
${sandboxNav(data.api, "/many")}
<h1>Песочница: ${total} иконок</h1>
<p class="muted">Теги стоят прямо в HTML страницы. Подключение — как в README для страниц без сборщика: строка CSS и скрипт <code>${STANDALONE_SCRIPT}</code>. Иконка грузится, когда подходит к видимой части страницы, — за полэкрана до появления; иконки, запрошенные в один момент, уходят пачкой.</p>
<p class="hosts">Хост API: ${host(LIVE_API, "живой api.iconavo.dev")} ${host(PREVIEW_API, "превью на этом компьютере (pnpm api preview)")} · ${
    data.slowScript
      ? `<a href="${esc(query(data.api, false))}">скрипт без задержки</a>`
      : `<a href="${esc(query(data.api, true))}">медленный скрипт (${SLOW_SCRIPT_MS / 1000} с)</a>`
  }</p>
<h2>Как проверить</h2>
<ol>
<li>Прокрутите страницу до конца и обратно: прокрутка плавная, кадров в секунду — около частоты экрана, долгих кадров почти нет.</li>
<li>Пока иконка грузится, её место уже занято: имена рядом с иконками не сдвигаются. С медленным скриптом место держит строка CSS из README.</li>
<li>Кнопки цвета: монохромные иконки перекрашиваются вместе с текстом, Fluent Emoji остаются цветными. Кнопки размера: иконки растут вместе с текстом.</li>
<li>Сначала нарисованы только иконки у видимой части страницы, остальные — по мере прокрутки. Пачка API, которой ещё нет в кэше, бывает дольше 750 мс — тогда ядро берёт те же иконки по одной со статики (ADR-0030), и запросов больше, чем пачек.</li>
</ol>
<div class="bar"><span id="drawn">Скрипт страницы загружается…</span><span id="requests"></span><span id="frames"></span>
<span>Цвет текста:</span><button type="button" data-color="">обычный</button><button type="button" data-color="#2563eb">синий</button><button type="button" data-color="#dc2626">красный</button>
<span>Размер:</span><button type="button" data-size="16px">16</button><button type="button" data-size="">20</button><button type="button" data-size="32px">32</button></div>
<main id="icons">
${sections}
</main>
</body>
</html>
`;
}

export const manyData = (api: string, slowScript: boolean): ManyData => ({
  api,
  hosts: sandboxHosts(api),
  slowScript,
});
