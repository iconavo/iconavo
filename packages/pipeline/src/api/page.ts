// Страница превью edge API для глаз (ADR-0024): сетка SVG с параметрами рядом с файлом статики,
// CSS-иконки в маске и на фоне, пачка в двух порядках и примеры ошибок. Картинки и CSS браузер берёт
// у функции — локальной или живой на api.iconavo.dev; тексты примеров сервер превью запрашивает сам.

import { BASE_STYLE, esc } from "../report/html.js";
import { API_HOST } from "./config.js";

export const LIVE_BASE = `https://${API_HOST}`;

/** Откуда страница берёт ответы функции. */
export interface PreviewSource {
  build: string;
  /** «» — локальная функция превью; иначе живой API. */
  base: "" | typeof LIVE_BASE;
  /** Версии наборов из манифеста dist-cdn/ — для файлов статики рядом. */
  versions: ReadonlyMap<string, string>;
  fetch: (path: string) => Promise<Response>;
}

const ICONS: readonly { set: string; name: string; note?: string }[] = [
  { set: "lucide", name: "heart" },
  { set: "material-symbols", name: "home" },
  { set: "ph", name: "arrow-right" },
  { set: "tabler", name: "star" },
  { set: "fluent-emoji-flat", name: "swan", note: "32×33" },
  { set: "fluent-emoji-flat", name: "phoenix-bird", note: "градиенты в defs" },
];

/** natural — картинка своего размера; остальные — высотой 48 px для сравнения. */
const VARIANTS: readonly { query: string; natural?: boolean }[] = [
  { query: "" },
  { query: "color=red" },
  { query: "color=%230a84ff" },
  { query: "height=48", natural: true },
  { query: "width=48", natural: true },
  { query: "rotate=90deg" },
  { query: "rotate=180deg" },
  { query: "rotate=270deg" },
  { query: "flip=horizontal" },
  { query: "flip=vertical" },
  { query: "flip=horizontal,vertical" },
  { query: "rotate=90deg&flip=horizontal" },
  { query: "box=1" },
];

const BATCH = [
  "/lucide.json?icons=heart,home,_missing",
  "/lucide.json?icons=_missing,home,heart",
];

const ERRORS: readonly [string, string][] = [
  ["Неизвестный набор", "/iconavo-missing.json?icons=heart"],
  ["Нет иконки", "/lucide/iconavo-missing.svg"],
  ["Неверный цвет", "/lucide/heart.svg?color=url(x)"],
  [
    "rotate=90: у Iconify это 180°, здесь ошибка",
    "/lucide/heart.svg?rotate=90",
  ],
  ["Без icons", "/lucide.json"],
  [
    "101 имя",
    `/lucide.json?icons=${Array.from({ length: 101 }, (_, i) => `i${i}`).join(",")}`,
  ],
  ["Неизвестный адрес", "/lucide"],
];

const SHOWN_HEADERS = [
  "content-type",
  "cache-control",
  "x-cache",
  "x-iconavo-version",
  "x-iconavo-index",
  "x-iconavo-build",
  "server-timing",
];

/** Поиск (ADR-0049): точное имя, русский запрос, префикс набора, фильтр и ошибка. */
const SEARCHES: readonly [string, string][] = [
  ["Точное имя", "/search?query=house&limit=8"],
  [
    "По-русски",
    `/search?query=${encodeURIComponent("мусорное ведро")}&limit=8`,
  ],
  ["С набором", "/search?query=lucide:house&limit=4"],
  [
    "Фильтр: цветные наборы",
    `/search?query=${encodeURIComponent("сердце")}&palette=1&limit=6`,
  ],
  ["Без query", "/search"],
];

const ICON = /^[a-z0-9-]+:[a-z0-9-]+$/;

/** Картинки найденных иконок из ответа поиска — у той же функции. */
function searchImages(base: string, body: string): string {
  let icons: string[] = [];
  try {
    const data = JSON.parse(body) as { icons?: unknown };
    if (Array.isArray(data.icons)) {
      icons = data.icons.filter(
        (i): i is string => typeof i === "string" && ICON.test(i),
      );
    }
  } catch {
    return "";
  }
  return icons
    .map((icon) => {
      const [set, name] = icon.split(":");
      return `<img src="${esc(`${base}/${set}/${name}.svg`)}" title="${esc(icon)}" alt="">`;
    })
    .join("");
}

const STYLE = `
.grid td, .grid th { text-align: center; vertical-align: middle; }
.grid td img { display: block; margin: 0 auto; background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
.grid td.q { text-align: left; font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
.css-demo span { font-size: 44px; margin-right: 12px; vertical-align: middle; }
.ex h4 code { font-weight: normal; }
.found img { height: 32px; margin: 0 6px 6px 0; background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 4px; }
`;

const decode = (query: string) => {
  try {
    return decodeURIComponent(query);
  } catch {
    return query;
  }
};

async function example(source: PreviewSource, path: string) {
  try {
    const res = await source.fetch(path);
    const body = await res.text();
    return {
      status: String(res.status),
      headers: SHOWN_HEADERS.filter((h) => res.headers.has(h)).map(
        (h) => `${h}: ${res.headers.get(h)}`,
      ),
      body,
    };
  } catch (e) {
    return { status: "нет ответа", headers: [], body: (e as Error).message };
  }
}

const block = (
  title: string,
  path: string,
  r: Awaited<ReturnType<typeof example>>,
) => `<div class="ex"><h4>${esc(title)} <code>${esc(path.length > 90 ? `${path.slice(0, 90)}…` : path)}</code> → ${esc(r.status)}</h4>
<pre>${esc([...r.headers, "", r.body.length > 1500 ? `${r.body.slice(0, 1500)}…` : r.body].join("\n"))}</pre></div>`;

export async function renderPreviewPage(
  source: PreviewSource,
): Promise<string> {
  const base = source.base;
  const live = base !== "";
  const csp = `default-src 'none'; img-src 'self' data:${live ? ` ${base}` : ""}; style-src 'self' 'unsafe-inline'${live ? ` ${base}` : ""}; base-uri 'none'; form-action 'none'`;

  const head = `<tr><th>Параметры</th>${ICONS.map((i) => `<th>${esc(`${i.set}:${i.name}`)}${i.note ? `<br><span class="muted">${esc(i.note)}</span>` : ""}</th>`).join("")}</tr>`;
  const rows: string[] = [];
  if (!live) {
    rows.push(
      `<tr><td class="q">файл статики</td>${ICONS.map((i) => {
        const version = source.versions.get(i.set);
        return version === undefined
          ? "<td>—</td>"
          : `<td><img src="/_static/v/${version}/${i.set}/${i.name}.svg" style="height:48px" alt=""></td>`;
      }).join("")}</tr>`,
    );
  }
  for (const v of VARIANTS) {
    const style = v.natural ? "" : ' style="height:48px"';
    rows.push(
      `<tr><td class="q">${esc(v.query === "" ? "без параметров" : decode(v.query))}</td>${ICONS.map(
        (i) =>
          `<td><img src="${esc(`${base}/${i.set}/${i.name}.svg${v.query === "" ? "" : `?${v.query}`}`)}"${style} alt=""></td>`,
      ).join("")}</tr>`,
    );
  }

  const first = await example(source, BATCH[0] as string);
  const second = await example(source, BATCH[1] as string);
  const css = await example(source, "/lucide.css?icons=heart,home");
  const errors = [];
  for (const [title, path] of ERRORS) {
    errors.push(block(title, path, await example(source, path)));
  }
  const searches = [];
  for (const [title, path] of SEARCHES) {
    const r = await example(source, path);
    const images = searchImages(base, r.body);
    searches.push(
      `${images === "" ? "" : `<p class="found">${images}</p>`}${block(title, path, r)}`,
    );
  }
  const same =
    first.status === "200" && first.body === second.body
      ? '<span class="ok">да</span>'
      : '<span class="stop">нет</span>';

  const versions = [...source.versions]
    .map(([set, version]) => `${set} ${version}`)
    .join(", ");
  const body = `<h1>Edge API — превью</h1>
<p class="muted">${
    live
      ? `Живой API ${esc(base)}; тексты примеров запрошены с этого компьютера.`
      : `Локальная функция: сборка ${esc(source.build)}, данные из dist-cdn/ (${esc(versions)}).`
  }</p>
<nav>${live ? '<a href="/">Локальная функция</a>' : `<a href="/?base=${esc(LIVE_BASE)}">Те же картинки с живого ${esc(API_HOST)}</a>`}</nav>

<h2>SVG с параметрами</h2>
<p class="muted">Без размеров иконка высотой 1em; здесь — 48 px. height=48 и width=48 — своего размера. Цвет есть только у монохромных наборов: у Fluent Emoji он не меняется.</p>
<table class="grid">${head}${rows.join("")}</table>

<h2>CSS-иконки</h2>
<link rel="stylesheet" href="${esc(`${base}/lucide.css?icons=heart,house,star`)}">
<link rel="stylesheet" href="${esc(`${base}/fluent-emoji-flat.css?icons=red-heart,swan,phoenix-bird`)}">
<p class="css-demo">
<span class="icon--lucide icon--lucide--heart" style="color:#e5484d"></span>
<span class="icon--lucide icon--lucide--house"></span>
<span class="icon--lucide icon--lucide--star" style="color:#f5a524"></span>
<span class="icon--fluent-emoji-flat icon--fluent-emoji-flat--red-heart"></span>
<span class="icon--fluent-emoji-flat icon--fluent-emoji-flat--swan"></span>
<span class="icon--fluent-emoji-flat icon--fluent-emoji-flat--phoenix-bird"></span>
</p>
<p class="muted">Lucide — маской: цвет берётся из текста (красный, обычный, жёлтый). Fluent Emoji — фоном, со своими цветами.</p>
${block("CSS", "/lucide.css?icons=heart,home", css)}

<h2>Пачка</h2>
<p>Те же имена в другом порядке — побайтно тот же ответ: ${same}. Второй запрос — из кэша (x-cache: HIT).</p>
${block("Первый запрос", BATCH[0] as string, first)}
${block("Другой порядок", BATCH[1] as string, second)}

<h2>Поиск</h2>
<p class="muted">Ответ совместим с Iconify (icons, total, limit, start), плюс results — карточки с вариантами — и semantic: full — слова и смысл, pending — смысл ещё считается (повторите запрос), text — только слова. Нет ключей Meilisearch в .env — 503.</p>
${searches.join("\n")}

<h2>Ошибки</h2>
${errors.join("\n")}
`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge API — превью</title>
<style>${BASE_STYLE}${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
