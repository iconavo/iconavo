// Страница «Рендер» песочницы ядра (фаза 3, шаг 4): сетка вариантов — размеры, повороты, отражения,
// повороты в данных, цвет, толщина линии, одна иконка дважды и подписи для скринридеров. Настройки
// клетки — строками в data-атрибутах, как атрибуты тега (шаг 5); скрипт страницы (render-client.ts)
// разбирает их функциями ядра и рисует renderIcon. Свой набор sandbox приходит блоком JSON и
// добавляется через addIcons — в сеть он не ходит. CSP, import map и хосты — как у главной страницы.

import type { IconavoIconSet } from "@iconavo-ui/core";
import { BASE_STYLE, esc } from "../report/html.js";
import { LIVE_API, PREVIEW_API } from "./config.js";
import {
  IMPORT_MAP,
  jsonInScript,
  type SandboxHost,
  sandboxCsp,
  sandboxHosts,
  sandboxNav,
} from "./page.js";

/** Данные для скрипта страницы: render-client.ts читает их из блока #render-data. */
export interface RenderData {
  api: string;
  hosts: SandboxHost[];
  /** Свой набор песочницы — для addIcons. */
  set: IconavoIconSet;
}

/**
 * Свой набор песочницы — то, чего нет в каталоге:
 * - широкая стрелка 48×24 с точкой в левом верхнем углу: поворот меняет стороны рамки, а точка
 *   показывает и вертикальное отражение;
 * - луна с маской — масок в каталоге нет;
 * - солнце и море — две разные иконки с одинаковым id="a", как бывает в чужих наборах;
 * - алиасы с поворотами и отражениями в данных, как у Iconify.
 */
export const DEMO_SET: IconavoIconSet = {
  prefix: "sandbox",
  width: 24,
  height: 24,
  icons: {
    "wide-arrow": {
      width: 48,
      body: '<g fill="currentColor"><circle cx="5" cy="5" r="3"/><path d="M6 10h26V4l14 8-14 8v-6H6z"/></g>',
    },
    moon: {
      body: '<defs><mask id="moon"><rect width="24" height="24" fill="#fff"/><circle cx="17" cy="7" r="7" fill="#000"/></mask></defs><circle cx="12" cy="12" r="10" fill="currentColor" mask="url(#moon)"/>',
    },
    sun: {
      body: '<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#facc15"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#a)"/>',
    },
    sea: {
      body: '<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect x="2" y="4" width="20" height="16" rx="3" fill="url(#a)"/>',
    },
  },
  aliases: {
    "wide-arrow-down": { parent: "wide-arrow", rotate: 1 },
    "wide-arrow-left": { parent: "wide-arrow", hFlip: true },
    "wide-arrow-up": { parent: "wide-arrow-down", rotate: 2 },
    "wide-arrow-right": { parent: "wide-arrow-left", hFlip: true },
  },
};

/** Что вокруг иконки: текст такого размера, кнопка или фраза. */
export type Around =
  | { kind: "text"; size: number }
  | { kind: "button"; text: string }
  | { kind: "sentence"; before: string; after: string };

/** Клетка сетки: иконка и её настройки строками — так их получит тег. */
export interface Variant {
  caption: string;
  icon: string;
  width?: string;
  height?: string;
  rotate?: string;
  flip?: string;
  color?: string;
  strokeWidth?: string;
  label?: string;
  /** Без уникальных ID — как нарисовал бы рендер без них. */
  raw?: boolean;
  around?: Around;
  /** Цвет текста клетки или тёмный фон. */
  tone?: "crimson" | "dark";
}

export interface VariantSection {
  id: string;
  title: string;
  /** Пояснение — свой HTML. */
  note: string;
  /** Что писать под иконкой: размер, ID внутри рисунка или открывающий тег <svg>. */
  show: "size" | "ids" | "tag";
  variants: Variant[];
}

const big = { width: "48" };

export const VARIANTS: VariantSection[] = [
  {
    id: "size",
    title: "Размер",
    note: "По умолчанию высота — <code>1em</code>, как у текста вокруг, ширина — по пропорции. Пунктир — рамка <code>&lt;svg&gt;</code>. В клетках текст 24 px.",
    show: "size",
    variants: [
      {
        caption: "1em в тексте 16 px",
        icon: "lucide:house",
        around: { kind: "text", size: 16 },
      },
      {
        caption: "1em в тексте 24 px",
        icon: "lucide:house",
        around: { kind: "text", size: 24 },
      },
      {
        caption: "1em в тексте 48 px",
        icon: "lucide:house",
        around: { kind: "text", size: 48 },
      },
      { caption: "width=32", icon: "lucide:house", width: "32" },
      { caption: "height=48", icon: "lucide:house", height: "48" },
      { caption: "width=2em", icon: "lucide:house", width: "2em" },
      { caption: "auto — размер сетки", icon: "lucide:house", width: "auto" },
      { caption: "своя 48×24: 2em × 1em", icon: "sandbox:wide-arrow" },
      {
        caption: "только width=48 — высота по пропорции",
        icon: "sandbox:wide-arrow",
        width: "48",
      },
      {
        caption: "только height=48 — ширина по пропорции",
        icon: "sandbox:wide-arrow",
        height: "48",
      },
      {
        caption: "width=48 и height=48 — рисунок по центру",
        icon: "sandbox:wide-arrow",
        width: "48",
        height: "48",
      },
      { caption: "swan — 32×33", icon: "fluent-emoji-flat:swan", ...big },
    ],
  },
  {
    id: "rotate",
    title: "Поворот",
    note: "Поворот — внутри SVG, по часовой стрелке: рамка поворачивается вместе с рисунком, при 90° и 270° стороны меняются местами, ничего не обрезано.",
    show: "size",
    variants: [
      { caption: "без поворота → вправо", icon: "lucide:arrow-right" },
      { caption: "90deg → вниз", icon: "lucide:arrow-right", rotate: "90deg" },
      {
        caption: "180deg → влево",
        icon: "lucide:arrow-right",
        rotate: "180deg",
      },
      {
        caption: "270deg → вверх",
        icon: "lucide:arrow-right",
        rotate: "270deg",
      },
      {
        caption: "rotate=1 — то же, что 90deg",
        icon: "lucide:arrow-right",
        rotate: "1",
      },
      { caption: "без поворота: рамка 2:1", icon: "sandbox:wide-arrow" },
      {
        caption: "90deg: рамка 1:2",
        icon: "sandbox:wide-arrow",
        rotate: "90deg",
      },
      { caption: "180deg", icon: "sandbox:wide-arrow", rotate: "180deg" },
      {
        caption: "270deg: рамка 1:2",
        icon: "sandbox:wide-arrow",
        rotate: "270deg",
      },
      {
        caption: "swan, 90deg: 33×32",
        icon: "fluent-emoji-flat:swan",
        rotate: "90deg",
        ...big,
      },
    ],
  },
  {
    id: "flip",
    title: "Отражение",
    note: "Сначала отражение, потом поворот — как у Iconify.",
    show: "size",
    variants: [
      { caption: "без отражения", icon: "lucide:flag" },
      { caption: "horizontal", icon: "lucide:flag", flip: "horizontal" },
      { caption: "vertical", icon: "lucide:flag", flip: "vertical" },
      {
        caption: "horizontal,vertical — как 180°",
        icon: "lucide:flag",
        flip: "horizontal,vertical",
      },
      {
        caption: "без отражения: точка слева вверху",
        icon: "sandbox:wide-arrow",
      },
      {
        caption: "horizontal: точка справа вверху",
        icon: "sandbox:wide-arrow",
        flip: "horizontal",
      },
      {
        caption: "vertical: точка слева внизу",
        icon: "sandbox:wide-arrow",
        flip: "vertical",
      },
      {
        caption: "horizontal и 90deg → вверх: сначала отражение",
        icon: "lucide:arrow-right",
        flip: "horizontal",
        rotate: "90deg",
      },
    ],
  },
  {
    id: "data",
    title: "Поворот в данных",
    note: "В чужих данных (IconifyJSON) поворот и отражение бывают записаны в самом алиасе. Ядро складывает их по цепочке и с настройками: каждая пара клеток должна совпасть.",
    show: "size",
    variants: [
      {
        caption: "алиас: в данных поворот 90°",
        icon: "sandbox:wide-arrow-down",
      },
      {
        caption: "то же атрибутом rotate=90deg",
        icon: "sandbox:wide-arrow",
        rotate: "90deg",
      },
      {
        caption: "алиас: в данных отражение",
        icon: "sandbox:wide-arrow-left",
      },
      {
        caption: "то же атрибутом flip=horizontal",
        icon: "sandbox:wide-arrow",
        flip: "horizontal",
      },
      {
        caption: "цепочка алиасов: 90° + 180° = 270°",
        icon: "sandbox:wide-arrow-up",
      },
      {
        caption: "то же атрибутом rotate=270deg",
        icon: "sandbox:wide-arrow",
        rotate: "270deg",
      },
      {
        caption: "цепочка: два отражения гасят друг друга",
        icon: "sandbox:wide-arrow-right",
      },
      { caption: "то же без настроек", icon: "sandbox:wide-arrow" },
      {
        caption: "в данных 90° и rotate=90deg = 180°",
        icon: "sandbox:wide-arrow-down",
        rotate: "90deg",
      },
      {
        caption: "то же атрибутом rotate=180deg",
        icon: "sandbox:wide-arrow",
        rotate: "180deg",
      },
    ],
  },
  {
    id: "color",
    title: "Цвет",
    note: "Монохромная иконка рисуется цветом текста (<code>currentColor</code>); атрибут <code>color</code> его заменяет. Цветная иконка свои цвета не меняет.",
    show: "size",
    variants: [
      { caption: "цвет текста клетки", icon: "lucide:heart", tone: "crimson" },
      {
        caption: "color=#2563eb главнее цвета текста",
        icon: "lucide:heart",
        color: "#2563eb",
        tone: "crimson",
      },
      {
        caption: "тёмный фон: цвет текста",
        icon: "lucide:heart",
        tone: "dark",
      },
      {
        caption: "залитая, color=crimson",
        icon: "tabler:heart-filled",
        color: "crimson",
      },
      {
        caption: "двухтоновая: оба слоя",
        icon: "ph:heart-duotone",
        color: "#2563eb",
      },
      {
        caption: "цветная: color не меняет",
        icon: "fluent-emoji-flat:red-heart",
        color: "#2563eb",
      },
    ],
  },
  {
    id: "stroke",
    title: "Толщина линии",
    note: "<code>stroke-width</code> — в единицах сетки набора. Меняет линии там, где они заданы: у Lucide и контурных Tabler. Залитые и цветные иконки не меняются.",
    show: "size",
    variants: [
      {
        caption: "stroke-width=1",
        icon: "lucide:house",
        strokeWidth: "1",
        ...big,
      },
      { caption: "1.5", icon: "lucide:house", strokeWidth: "1.5", ...big },
      {
        caption: "без настройки: 2, как у Lucide",
        icon: "lucide:house",
        ...big,
      },
      { caption: "2.5", icon: "lucide:house", strokeWidth: "2.5", ...big },
      { caption: "3", icon: "lucide:house", strokeWidth: "3", ...big },
      { caption: "Tabler, 1", icon: "tabler:heart", strokeWidth: "1", ...big },
      { caption: "Tabler, 3", icon: "tabler:heart", strokeWidth: "3", ...big },
      {
        caption: "залитая, 3: не меняется",
        icon: "material-symbols:favorite",
        strokeWidth: "3",
        ...big,
      },
      {
        caption: "цветная, 1: не меняется",
        icon: "fluent-emoji-flat:wing",
        strokeWidth: "1",
        ...big,
      },
    ],
  },
  {
    id: "twice",
    title: "Одна иконка дважды",
    note: "У каждой отрисовки свои ID масок, градиентов и обрезок, поэтому одинаковые иконки выглядят одинаково. Под иконкой — её ID.",
    show: "ids",
    variants: [
      {
        caption: "violin — градиенты",
        icon: "fluent-emoji-flat:violin",
        ...big,
      },
      { caption: "violin ещё раз", icon: "fluent-emoji-flat:violin", ...big },
      {
        caption: "violin, 90deg",
        icon: "fluent-emoji-flat:violin",
        rotate: "90deg",
        ...big,
      },
      {
        caption: "teacher — обрезка и фильтр",
        icon: "fluent-emoji-flat:teacher",
        ...big,
      },
      { caption: "teacher ещё раз", icon: "fluent-emoji-flat:teacher", ...big },
      {
        caption: "teacher, horizontal",
        icon: "fluent-emoji-flat:teacher",
        flip: "horizontal",
        ...big,
      },
      {
        caption: "phoenix-bird — градиент",
        icon: "fluent-emoji-flat:phoenix-bird",
        ...big,
      },
      {
        caption: "phoenix-bird ещё раз",
        icon: "fluent-emoji-flat:phoenix-bird",
        ...big,
      },
      { caption: "moon — маска", icon: "sandbox:moon", ...big },
      { caption: "moon ещё раз", icon: "sandbox:moon", ...big },
      {
        caption: "moon, 90deg",
        icon: "sandbox:moon",
        rotate: "90deg",
        ...big,
      },
      {
        caption: "moon, vertical",
        icon: "sandbox:moon",
        flip: "vertical",
        ...big,
      },
    ],
  },
  {
    id: "why",
    title: "Зачем уникальные ID",
    note: 'У <code>sun</code> и <code>sea</code> градиент с одним и тем же <code>id="a"</code>, как бывает в чужих наборах. Без уникальных ID море берёт первый градиент страницы — солнечный.',
    show: "ids",
    variants: [
      {
        caption: "sun без уникальных ID",
        icon: "sandbox:sun",
        raw: true,
        ...big,
      },
      {
        caption: "sea без уникальных ID — чужой градиент",
        icon: "sandbox:sea",
        raw: true,
        ...big,
      },
      { caption: "sun с уникальными ID", icon: "sandbox:sun", ...big },
      {
        caption: "sea с уникальными ID — свой градиент",
        icon: "sandbox:sea",
        ...big,
      },
    ],
  },
  {
    id: "label",
    title: "Подпись для скринридеров",
    note: 'Без <code>label</code> иконка декоративная — <code>aria-hidden</code>, скринридер её пропускает. С <code>label</code> — <code>role="img"</code> и <code>aria-label</code>, без всплывающей подсказки. Под каждой — тег <code>&lt;svg&gt;</code>, как он лежит на странице.',
    show: "tag",
    variants: [
      {
        caption: "кнопка-иконка с label: «Удалить», кнопка",
        icon: "lucide:trash",
        label: "Удалить",
        around: { kind: "button", text: "" },
      },
      {
        caption: "иконка и текст: имя кнопки — из текста",
        icon: "lucide:trash",
        around: { kind: "button", text: "Удалить" },
      },
      {
        caption: "плохо: кнопка-иконка без label — просто «кнопка»",
        icon: "lucide:trash",
        around: { kind: "button", text: "" },
      },
      {
        caption: "иконка с label в тексте",
        icon: "lucide:star",
        label: "Избранное",
        around: { kind: "sentence", before: "Добавлено в", after: "" },
      },
      {
        caption: "декоративная иконка в тексте",
        icon: "lucide:star",
        around: { kind: "sentence", before: "", after: "Избранное" },
      },
    ],
  },
];

const STYLE = `
body { max-width: 1200px; }
.nav { margin: 0 0 16px; }
.hosts a { margin-right: 12px; } .hosts .current { font-weight: 600; text-decoration: none; }
.cells { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin: 12px 0; }
.cell { margin: 0; border: 1px solid var(--line); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.stage { min-height: 112px; display: flex; align-items: center; justify-content: center; font-size: 24px; border-radius: 8px; }
.cell.crimson .stage { color: crimson; }
.cell.dark .stage { background: #1c1c1e; color: #ffffff; }
.stage svg { outline: 1px dashed var(--muted); }
.around { margin: 0; text-align: center; white-space: nowrap; }
.around.sentence { font-size: 16px; }
.stage button { font: inherit; font-size: 20px; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
figcaption { font-size: 13px; }
figcaption .info { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
`;

/** Настройки клетки — data-атрибутами у места для иконки; неверных значений в сетке нет. */
function iconSlot(v: Variant): string {
  const pairs: [string, string | undefined][] = [
    ["icon", v.icon],
    ["width", v.width],
    ["height", v.height],
    ["rotate", v.rotate],
    ["flip", v.flip],
    ["color", v.color],
    ["stroke-width", v.strokeWidth],
    ["label", v.label],
  ];
  const attributes = pairs
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([name, value]) => ` data-${name}="${esc(value)}"`)
    .join("");
  return `<span class="icon"${attributes}${v.raw ? " data-raw" : ""}></span>`;
}

function stage(v: Variant): string {
  const icon = iconSlot(v);
  const around = v.around;
  if (around?.kind === "text") {
    return `<p class="around" style="font-size: ${around.size}px">Аа ${icon}</p>`;
  }
  if (around?.kind === "button") {
    return `<button type="button">${icon}${around.text ? ` ${esc(around.text)}` : ""}</button>`;
  }
  if (around?.kind === "sentence") {
    return `<p class="around sentence">${[esc(around.before), icon, esc(around.after)].filter(Boolean).join(" ")}</p>`;
  }
  return icon;
}

const cell = (v: Variant) =>
  `<figure class="cell${v.tone ? ` ${v.tone}` : ""}"><div class="stage">${stage(v)}</div><figcaption>${esc(v.caption)}<code class="info"></code></figcaption></figure>`;

const section = (s: VariantSection) =>
  `<section id="${s.id}"><h2>${esc(s.title)}</h2><p class="muted">${s.note}</p><div class="cells" data-show="${s.show}">${s.variants.map(cell).join("")}</div></section>`;

export function renderVariantsPage(data: RenderData): string {
  const host = (href: string, label: string) => {
    const link = `/render?api=${encodeURIComponent(href)}`;
    return data.api === href
      ? `<a class="current" href="${esc(link)}">${esc(label)}</a>`
      : `<a href="${esc(link)}">${esc(label)}</a>`;
  };
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(sandboxCsp(data.hosts))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Песочница ядра: рендер</title>
<style>${BASE_STYLE}${STYLE}</style>
<script type="importmap">${IMPORT_MAP}</script>
<script type="application/json" id="render-data">${jsonInScript(data)}</script>
<script type="module" src="/render.js"></script>
</head>
<body>
${sandboxNav(data.api, "/render")}
<h1>Песочница ядра: рендер</h1>
<p class="muted">Каждую клетку рисует <code>renderIcon</code> ядра — так иконку нарисуют тег и React. Настройки клетки записаны строками, как атрибуты тега, и разбираются функциями ядра. Иконки каталога ядро грузит с хостов, свой набор <code>sandbox</code> добавлен через <code>addIcons</code>.</p>
<p class="hosts">Хост API: ${host(LIVE_API, "живой api.iconavo.dev")} ${host(PREVIEW_API, "превью на этом компьютере (pnpm api preview)")}</p>
<h2>Как проверить</h2>
<ol>
<li>Подписи клеток совпадают с картинкой: стрелки смотрят, куда написано, пары в разделе «Поворот в данных» одинаковые.</li>
<li>У повёрнутых иконок ничего не обрезано: рисунок внутри пунктирной рамки.</li>
<li>Одинаковые иконки выглядят одинаково, и ID под ними разные.</li>
<li>Скринридер — по инструкции в конце страницы.</li>
</ol>
<p id="status" class="muted">Скрипт страницы загружается…</p>
${VARIANTS.map(section).join("\n")}
<h2>Проверка Экранным диктором</h2>
<ol>
<li>Откройте эту страницу в Edge — с ним Экранный диктор работает лучше всего — или в Chrome.</li>
<li>Включите Экранный диктор: Win + Ctrl + Enter.</li>
<li>Нажимайте Tab: диктор идёт по кнопкам раздела «Подпись для скринридеров». Первые две он называет «Удалить», кнопка; третью — просто «кнопка».</li>
<li>Чтобы прочитать текст по порядку, включите режим просмотра: Caps Lock + Пробел, затем стрелка вниз. Звезду с подписью диктор читает как «Избранное», изображение; декоративную пропускает.</li>
<li>Выключить — снова Win + Ctrl + Enter.</li>
</ol>
<p class="muted">Без скринридера: правый клик по иконке → «Просмотреть код» → в DevTools вкладка Accessibility. У иконки с подписью Role — img, Name — «Удалить»; декоративная скрыта от скринридеров (aria-hidden).</p>
</body>
</html>
`;
}

export const renderData = (api: string): RenderData => ({
  api,
  hosts: sandboxHosts(api),
  set: DEMO_SET,
});
