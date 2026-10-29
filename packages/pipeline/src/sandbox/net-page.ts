// Страница «Сбои сети» песочницы (фаза 3, шаг 9; ADR-0030, ADR-0035): десяток иконок, которые грузит
// ядро из скрипта для страниц без сборщика. Отказы и молчание хостов задаёт проверка pnpm sandbox
// --check — правилами Playwright в настоящем браузере, страница их не имитирует: она только показывает
// иконки и что с ними стало. Хосты — как у режима, а с ?cdn2= — ещё второй хост статики: та же папка
// dist-cdn/ у второго превью API на другом порту. Теги ставит скрипт страницы после configure, поэтому
// в сеть они идут только к выбранным хостам. Политика — строгая, как на странице тега.

import { BASE_STYLE, esc } from "../report/html.js";
import { LIVE_API, PREVIEW_STATIC } from "./config.js";
import {
  jsonInScript,
  NO_FAVICON,
  type SandboxHost,
  sandboxHosts,
  sandboxNav,
  strictCsp,
} from "./page.js";
import { STANDALONE_SCRIPT, UNDEFINED_RULE } from "./tag-page.js";

/**
 * Иконки страницы: иконки Lucide, алиас (home → house) и иконка, которой нет. Имена проверяет тест:
 * все, кроме последней, есть в data/.
 */
export const NET_NAMES = [
  "lucide:bell",
  "lucide:heart",
  "lucide:home",
  "lucide:search",
  "lucide:settings",
  "lucide:star",
  "lucide:trash",
  "lucide:user",
  "lucide:no-such-icon",
] as const;

/** Данные для скрипта страницы: net-client.ts читает их из блока #net-data. */
export interface NetData {
  api: string;
  hosts: SandboxHost[];
  names: readonly string[];
}

/** Хосты страницы: хосты режима и второй хост статики, если он задан. */
export function netHosts(api: string, cdn2: string | null): SandboxHost[] {
  return [
    ...sandboxHosts(api),
    ...(cdn2
      ? [{ url: `${cdn2}${PREVIEW_STATIC}`, kind: "cdn" as const }]
      : []),
  ];
}

export const netData = (api: string, cdn2: string | null): NetData => ({
  api,
  hosts: netHosts(api, cdn2),
  names: NET_NAMES,
});

/** Пакет — скрипт для страниц без сборщика: configure скрипт страницы берёт из того же адреса. */
export const NET_IMPORT_MAP = JSON.stringify({
  imports: { "@iconavo-ui/icon": STANDALONE_SCRIPT },
});

/** Стиль страницы целиком: его хэш стоит в CSP. */
export const NET_STYLE = `${BASE_STYLE}
${UNDEFINED_RULE}
body { max-width: 1000px; }
.nav { margin: 0 0 16px; }
#icons { font-size: 32px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; }
.c { display: flex; align-items: center; gap: 8px; min-width: 0; }
.c span { font-size: 14px; overflow-wrap: anywhere; }
.hosts td:first-child { color: var(--muted); white-space: nowrap; }
`;

export function renderNetPage(data: NetData): string {
  const hosts = data.hosts
    .map(
      (h) =>
        `<tr><td>${h.kind === "api" ? "пачки (api)" : "по одной (cdn)"}</td><td><code>${esc(h.url)}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(strictCsp(data.hosts, NET_IMPORT_MAP, NET_STYLE))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${NO_FAVICON}
<title>Песочница: сбои сети</title>
<style>${NET_STYLE}</style>
<script type="importmap">${NET_IMPORT_MAP}</script>
<script type="application/json" id="net-data">${jsonInScript(data)}</script>
<script type="module" src="/net.js"></script>
</head>
<body>
${sandboxNav(data.api, "/net")}
<h1>Песочница: сбои сети</h1>
<p class="muted">Страница для проверки <code>pnpm sandbox --check</code>: она открывает её в Chrome, Firefox и WebKit и правилами браузера роняет или задерживает хосты — API отказал, API и первый хост статики отказали, API молчит, медленная сеть, ничего не отвечает. Ядро о проверке не знает. Вручную то же делает DevTools → Network → Block request domain или троттлинг.${data.api === LIVE_API ? "" : " Хосты — превью на этом компьютере."}</p>
<table class="hosts"><tbody>${hosts}</tbody></table>
<main id="icons"></main>
</body>
</html>
`;
}
