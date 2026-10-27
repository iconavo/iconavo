// Страница «Тег» песочницы (фаза 3, шаг 5): <iconavo-icon> так, как его подключат разработчики.
// - Две копии пакета на одной странице: скрипт для страниц без сборщика (/icon/iconavo-icon.js) и вывод
//   tsc через import map, как у сборщика. Порядок задаёт скрипт страницы (tag-client.ts): сначала
//   хосты режима и свой загрузчик через ядро, затем скрипт без сборщика — он регистрирует тег, — и
//   последней копия «как у сборщика», которая регистрацию пропускает. Так теги страницы не пойдут в
//   сеть раньше, чем выбраны хосты.
// - Строгая CSP — та, что README предлагает сайтам: Trusted Types с политикой iconavo, стиль — только
//   <style> страницы по хэшу. Поэтому в разметке нет атрибутов style, а скрипт страницы не пишет
//   innerHTML.
// - Разделы: две копии, заглушки на утверждение владельца, иконки нет, подпись для Экранного
//   диктора, inline, цвет и размер от текста, атрибуты и неверные значения.

import { BASE_STYLE, esc } from "../report/html.js";
import { LIVE_API, PREVIEW_API, SLOW_LOADER_MS } from "./config.js";
import {
  jsonInScript,
  NO_FAVICON,
  type SandboxHost,
  sandboxHosts,
  sandboxNav,
  strictCsp,
} from "./page.js";

/** Данные для скрипта страницы: tag-client.ts читает их из блока #tag-data. */
export interface TagData {
  api: string;
  hosts: SandboxHost[];
  /** Задержки своего загрузчика для заглушек, мс. */
  delays: readonly number[];
}

/** Копия «как у сборщика» — вывод tsc пакета и ядра. */
export const TAG_IMPORT_MAP = JSON.stringify({
  imports: {
    "@iconavo-ui/core": "/core/index.js",
    "@iconavo-ui/core/internal": "/core/internal.js",
    "@iconavo-ui/icon": "/icon/index.js",
  },
});

/** Скрипт для страниц без сборщика — тот, что разработчики возьмут с jsDelivr. */
export const STANDALONE_SCRIPT = "/icon/iconavo-icon.js";

/** Строка из README: место 1em × 1em, пока скрипт не загрузился. */
export const UNDEFINED_RULE =
  "iconavo-icon:not(:defined) { display: inline-block; width: 1em; height: 1em; }";

/** Стиль страницы целиком: его хэш стоит в CSP. */
export const TAG_STYLE = `${BASE_STYLE}
${UNDEFINED_RULE}
body { max-width: 1200px; }
.nav { margin: 0 0 16px; }
.hosts a { margin-right: 12px; } .hosts .current { font-weight: 600; text-decoration: none; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 12px 0; }
.controls label { display: flex; gap: 6px; align-items: center; }
button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button[aria-pressed="true"] { font-weight: 600; border-color: var(--muted); }
.cells { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin: 12px 0; }
.cell { margin: 0; border: 1px solid var(--line); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.stage { min-height: 96px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 24px; border-radius: 8px; }
.stage.dark { background: #1c1c1e; color: #ffffff; }
.size-16 { font-size: 16px; } .size-24 { font-size: 24px; } .size-48 { font-size: 48px; }
figcaption { font-size: 13px; } figcaption code { overflow-wrap: anywhere; }
.line { font-size: 24px; margin: 8px 0; } .line .text { text-decoration: underline; text-decoration-color: var(--muted); }
.favorites { font-size: 32px; color: crimson; margin: 8px 0; }
.brand { --brand: #7c3aed; }
.diag td:first-child { color: var(--muted); white-space: nowrap; }
.stage button { font-size: 20px; }
`;

/** Тег с атрибутами; значения экранируются, пустая строка — атрибут без значения. */
export function iconTag(attributes: Record<string, string>): string {
  const list = Object.entries(attributes)
    .map(([name, value]) =>
      value === "" ? ` ${name}` : ` ${name}="${esc(value)}"`,
    )
    .join("");
  return `<iconavo-icon${list}></iconavo-icon>`;
}

/** Клетка: тег с подписью — его атрибутами. */
interface Cell {
  caption: string;
  attributes: Record<string, string>;
  /** Тёмный фон клетки. */
  dark?: boolean;
}

/** Атрибуты и неверные значения: каждая клетка — то, что разработчик напишет в HTML. */
export const ATTRIBUTE_CELLS: Cell[] = [
  { caption: "без атрибутов — 1em", attributes: { icon: "lucide:house" } },
  { caption: 'width="32"', attributes: { icon: "lucide:house", width: "32" } },
  {
    caption: 'height="48"',
    attributes: { icon: "lucide:house", height: "48" },
  },
  {
    caption: 'width="auto" — сетка набора',
    attributes: { icon: "lucide:house", width: "auto" },
  },
  {
    caption: 'rotate="90deg"',
    attributes: { icon: "lucide:arrow-right", rotate: "90deg" },
  },
  {
    caption: 'rotate="2"',
    attributes: { icon: "lucide:arrow-right", rotate: "2" },
  },
  {
    caption: 'flip="horizontal"',
    attributes: { icon: "lucide:arrow-right", flip: "horizontal" },
  },
  {
    caption: 'stroke-width="1"',
    attributes: { icon: "lucide:heart", "stroke-width": "1" },
  },
  {
    caption: 'stroke-width="3"',
    attributes: { icon: "lucide:heart", "stroke-width": "3" },
  },
  {
    caption: 'цветная с color="crimson" — свои цвета',
    attributes: { icon: "fluent-emoji-flat:red-heart", color: "crimson" },
  },
  {
    caption: "hidden — тега не видно",
    attributes: { icon: "lucide:house", hidden: "" },
  },
  {
    caption: 'rotate="45deg" — неверно: без поворота, предупреждение',
    attributes: { icon: "lucide:arrow-right", rotate: "45deg" },
  },
  {
    caption: 'width="50%" — неверно: 1em, предупреждение',
    attributes: { icon: "lucide:house", width: "50%" },
  },
  {
    caption: 'color="bogus" — неверно: цвет текста, предупреждение',
    attributes: { icon: "lucide:house", color: "bogus" },
  },
];

/** Иконки, которых нет: имени нет в наборе, набора нет, имя не по правилу ADR-0001. */
export const MISSING_CELLS: Cell[] = [
  {
    caption: "lucide:no-such-icon — имени нет",
    attributes: { icon: "lucide:no-such-icon" },
  },
  { caption: "nope:house — набора нет", attributes: { icon: "nope:house" } },
  {
    caption: "Lucide:House — имя не по правилу",
    attributes: { icon: "Lucide:House" },
  },
  { caption: "рядом — есть", attributes: { icon: "lucide:house" } },
];

/** Перекраска: монохромные наборы следуют за цветом текста, Fluent Emoji — со своими цветами. */
export const RECOLOR_ICONS = [
  "lucide:heart",
  "tabler:heart",
  "material-symbols:favorite-outline",
  "ph:heart",
  "fluent-emoji-flat:red-heart",
];

const cell = (c: Cell) =>
  `<figure class="cell"><div class="stage${c.dark ? " dark" : ""}">${iconTag(c.attributes)}</div><figcaption>${esc(c.caption)}</figcaption></figure>`;

export function renderTagPage(data: TagData): string {
  const host = (href: string, label: string) => {
    const link = `/tag?api=${encodeURIComponent(href)}`;
    return data.api === href
      ? `<a class="current" href="${esc(link)}">${esc(label)}</a>`
      : `<a href="${esc(link)}">${esc(label)}</a>`;
  };
  // Кнопки, а не <select>: у выпадающего списка WebKit на Windows свой встроенный стиль, и строгая
  // политика страницы отмечает его как нарушение.
  const delays = data.delays
    .map(
      (ms, i) =>
        `<button type="button" data-delay="${ms}" aria-pressed="${i === data.delays.length - 1}">${ms / 1000} с</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(strictCsp(data.hosts, TAG_IMPORT_MAP, TAG_STYLE))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${NO_FAVICON}
<title>Песочница: тег</title>
<style>${TAG_STYLE}</style>
<script type="importmap">${TAG_IMPORT_MAP}</script>
<script type="application/json" id="tag-data">${jsonInScript(data)}</script>
<script type="module" src="/tag.js"></script>
</head>
<body>
${sandboxNav(data.api, "/tag")}
<h1>Песочница: тег &lt;iconavo-icon&gt;</h1>
<p class="muted">Тег <code>@iconavo-ui/icon</code> — так, как его подключат разработчики. На странице две копии пакета: скрипт для страниц без сборщика и копия «как у сборщика». Политика безопасности — строгая, из README: Trusted Types с политикой <code>iconavo</code>, стили — только по хэшу.</p>
<p class="hosts">Хост API: ${host(LIVE_API, "живой api.iconavo.dev")} ${host(PREVIEW_API, "превью на этом компьютере (pnpm api preview)")}</p>
<h2>Как проверить</h2>
<ol>
<li>«Две копии»: тег зарегистрирован один раз, ошибок нет, политика Trusted Types одна.</li>
<li>«Заглушки»: в первые 150 мс место пустое, потом скелетон или спиннер, пока иконка грузится. Вид заглушек утверждаете вы.</li>
<li>Без анимации (Windows: Параметры → Специальные возможности → Визуальные эффекты → Эффекты анимации — выкл.; или DevTools → Rendering → prefers-reduced-motion: reduce) заглушки не мерцают и не крутятся.</li>
<li>«Цвет и размер от текста»: кнопки цвета перекрашивают монохромные иконки, Fluent Emoji остаются цветными.</li>
<li>Экранный диктор — по инструкции в разделе «Подпись».</li>
</ol>
<p id="status" class="muted">Скрипт страницы загружается…</p>
<section id="copies">
<h2>Две копии на странице</h2>
<table class="diag"><tbody>
<tr><td>Тег зарегистрировал</td><td id="diag-first">—</td></tr>
<tr><td>Копия «как у сборщика»</td><td id="diag-second">—</td></tr>
<tr><td>Политика Trusted Types</td><td id="diag-policy">—</td></tr>
<tr><td>Ошибки и нарушения CSP</td><td id="diag-problems">нет</td></tr>
</tbody></table>
</section>
<section id="placeholders">
<h2>Заглушки</h2>
<p class="muted">Свой набор <code>slow</code> через <code>setLoader</code>: иконка приходит с задержкой. Слева направо — 16, 24 и 48 px; сверху — светлый фон, снизу — тёмный. Каждый показ — новые имена, иначе иконки взялись бы из памяти.</p>
<div class="controls"><span>Ответ через</span>${delays}<button type="button" id="again">Показать заново</button></div>
<div class="cells" id="placeholder-cells"></div>
</section>
<section id="missing">
<h2>Иконки нет</h2>
<p class="muted">Пустое место того же размера и одно предупреждение в консоли на имя. В режиме разработки — пунктирная рамка: у скрипта без сборщика он включён на 127.0.0.1.</p>
<div class="controls"><button type="button" id="dev-on">Режим разработки — вкл.</button><button type="button" id="dev-off">Режим разработки — выкл.</button></div>
<div class="cells" id="missing-cells">${MISSING_CELLS.map(cell).join("")}</div>
</section>
<section id="label">
<h2>Подпись для скринридеров</h2>
<p class="muted">Две кнопки из README. Скринридер называет обе «Delete»: первую — по подписи <code>label</code> у тега, вторую — по тексту, а иконку пропускает.</p>
<div class="cells">
<figure class="cell"><div class="stage"><button type="button">${iconTag({ icon: "lucide:trash", label: "Delete" })}</button></div><figcaption>label="Delete"</figcaption></figure>
<figure class="cell"><div class="stage"><button type="button">${iconTag({ icon: "lucide:trash" })} Delete</button></div><figcaption>иконка и текст</figcaption></figure>
</div>
<ol>
<li>Откройте страницу в Edge или Chrome и включите Экранный диктор: Win + Ctrl + Enter.</li>
<li>Нажимайте Tab: обе кнопки диктор называет «Delete», кнопка.</li>
<li>Выключить — снова Win + Ctrl + Enter.</li>
</ol>
<p class="muted">Без скринридера: правый клик по первой иконке → «Просмотреть код» → в DevTools вкладка Accessibility. У тега Role — img, Name — «Delete»; внутренний &lt;svg&gt; скрыт (aria-hidden).</p>
</section>
<section id="inline">
<h2>Иконка в строке текста</h2>
<p class="line"><span class="text">Без inline</span> ${iconTag({ icon: "lucide:heart" })} <span class="text">низ иконки на линии текста</span></p>
<p class="line"><span class="text">С inline</span> ${iconTag({ icon: "lucide:heart", inline: "" })} <span class="text">иконка ниже на 0,125em, как буква</span></p>
</section>
<section id="color">
<h2>Цвет и размер от текста</h2>
<p class="muted">Пример из README: текст 32 px цвета crimson — иконка такая же.</p>
<p class="favorites">${iconTag({ icon: "lucide:heart" })} Favorites</p>
<p>${iconTag({ icon: "lucide:heart", width: "32", color: "crimson", "stroke-width": "1.5" })} <code>width="32" color="crimson" stroke-width="1.5"</code></p>
<p class="brand">${iconTag({ icon: "lucide:heart", width: "32", color: "var(--brand)" })} <code>color="var(--brand)"</code> — цвет из переменной CSS</p>
<div class="controls"><span>Цвет текста:</span><button type="button" data-color="">обычный</button><button type="button" data-color="#2563eb">синий</button><button type="button" data-color="#dc2626">красный</button></div>
<p class="line" id="recolor">${RECOLOR_ICONS.map((icon) => iconTag({ icon })).join(" ")} текст рядом</p>
</section>
<section id="attributes">
<h2>Атрибуты</h2>
<p class="muted">Атрибуты README; неверные значения тег пропускает — в консоли по одному предупреждению с допустимыми значениями.</p>
<div class="cells">${ATTRIBUTE_CELLS.map(cell).join("")}</div>
</section>
</body>
</html>
`;
}

export const tagData = (api: string): TagData => ({
  api,
  hosts: sandboxHosts(api),
  delays: SLOW_LOADER_MS,
});
