// Скрипт страницы «Рендер» песочницы (фаза 3, шаг 4): работает в браузере, не в Node. Каждое место
// для иконки — span с настройками строками в data-атрибутах, как у тега (шаг 5): скрипт разбирает их
// функциями ядра parseSize, parseRotate и parseFlip, рисует renderIcon и пишет под иконкой её
// размер, ID внутри рисунка или открывающий тег <svg>. Свой набор sandbox приходит блоком JSON и
// добавляется через addIcons — в сеть он не ходит; иконки каталога ядро грузит с хостов режима.

import { addIcons, configure } from "@iconavo-ui/core";
import {
  getIcon,
  iconToSvg,
  loadIcon,
  parseFlip,
  parseRotate,
  parseSize,
  type RenderOptions,
  renderIcon,
  subscribeIcon,
  svgToString,
} from "@iconavo-ui/core/internal";
import type { RenderData } from "./render-page.js";

const data = JSON.parse(
  document.getElementById("render-data")?.textContent ?? "{}",
) as RenderData;
const status = document.getElementById("status") as HTMLParagraphElement;

configure({
  api: data.hosts.filter((h) => h.kind === "api").map((h) => h.url),
  cdn: data.hosts.filter((h) => h.kind === "cdn").map((h) => h.url),
});
addIcons(data.set);

/** Настройки места для иконки — из data-атрибутов, как тег возьмёт их из своих атрибутов. */
function options(el: HTMLElement): RenderOptions {
  const { width, height, rotate, flip, color, strokeWidth, label } = el.dataset;
  const o: RenderOptions = {};
  const w = width === undefined ? null : parseSize(width);
  if (w !== null) o.width = w;
  const h = height === undefined ? null : parseSize(height);
  if (h !== null) o.height = h;
  const r = rotate === undefined ? null : parseRotate(rotate);
  if (r !== null) o.rotate = r;
  const f = flip === undefined ? null : parseFlip(flip);
  if (f !== null) Object.assign(o, f);
  if (color !== undefined) o.color = color;
  if (strokeWidth !== undefined) o.strokeWidth = Number(strokeWidth);
  if (label !== undefined) o.label = label;
  return o;
}

const px = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** Под иконкой: размер (атрибуты и пиксели), ID внутри рисунка или открывающий тег <svg>. */
function info(svg: SVGSVGElement, show: string): string {
  if (show === "ids") {
    const ids = [...svg.querySelectorAll("[id]")].map((e) => e.id);
    return ids.length > 0 ? `ID: ${ids.join(", ")}` : "без ID";
  }
  const html = svg.outerHTML;
  if (show === "tag") return html.slice(0, html.indexOf(">") + 1);
  const box = svg.getBoundingClientRect();
  return `${svg.getAttribute("width") ?? "—"} × ${svg.getAttribute("height") ?? "—"} = ${px(box.width)} × ${px(box.height)} px · viewBox ${svg.getAttribute("viewBox")}`;
}

function draw(el: HTMLElement, caption: HTMLElement | null, show: string) {
  const state = getIcon(el.dataset.icon as string);
  if (typeof state !== "object") {
    el.replaceChildren();
    if (caption) {
      caption.textContent =
        state === "loading"
          ? "грузится…"
          : state === "missing"
            ? "нет такой иконки"
            : "не загрузилась";
    }
    return;
  }
  const o = options(el);
  // Без уникальных ID — только в разделе «Зачем уникальные ID»: как нарисовал бы рендер без них.
  el.innerHTML = svgToString(
    "raw" in el.dataset ? iconToSvg(state, o) : renderIcon(state, o),
  );
  const svg = el.querySelector("svg");
  if (caption && svg) caption.textContent = info(svg, show);
}

const slots = [...document.querySelectorAll<HTMLElement>("[data-icon]")];

function renderStatus(): void {
  const drawn = slots.filter(
    (el) => typeof getIcon(el.dataset.icon as string) === "object",
  ).length;
  status.textContent =
    drawn === slots.length
      ? `Нарисовано ${drawn} из ${slots.length}.`
      : `Нарисовано ${drawn} из ${slots.length}, остальные грузятся…`;
}

for (const el of slots) {
  const name = el.dataset.icon as string;
  const show = el.closest<HTMLElement>("[data-show]")?.dataset.show ?? "size";
  const caption =
    el.closest(".cell")?.querySelector<HTMLElement>(".info") ?? null;
  subscribeIcon(name, () => {
    draw(el, caption, show);
    renderStatus();
  });
  loadIcon(name);
  draw(el, caption, show);
}
renderStatus();
