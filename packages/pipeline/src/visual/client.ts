// Скрипт страницы визуального сравнения (фаза 3, шаг 9): работает в браузере, не в Node. Хосты
// выключены, иконки куска — через addIcons, теги — в средней сетке, с noobserver: рисуются сразу, без
// ожидания видимости. Готовность в body[data-ready]: «1» — теги нарисованы и картинки эталона
// разобраны, иначе — что не так.

import { addIcons, configure } from "@iconavo-ui/icon";
import type { VisualData } from "./page.js";

async function main(): Promise<string> {
  const data = JSON.parse(
    document.getElementById("visual-data")?.textContent ?? "{}",
  ) as VisualData;
  configure({ api: [], cdn: [] });
  addIcons(data.sets);
  const grid = document.getElementById("tag") as HTMLElement;
  for (const cell of data.cells) {
    const tag = document.createElement("iconavo-icon");
    tag.setAttribute("icon", cell.icon);
    tag.setAttribute("width", String(cell.width));
    tag.setAttribute("height", String(cell.height));
    tag.setAttribute("noobserver", "");
    grid.append(tag);
  }
  const images = [...document.images];
  await Promise.all(images.map((img) => img.decode().catch(() => {})));
  // Два кадра: всё, что нарисовано, — уже на экране.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const undrawn = [...grid.querySelectorAll("iconavo-icon")]
    .filter((tag) => !tag.shadowRoot?.querySelector("svg[viewBox]"))
    .map((tag) => tag.getAttribute("icon"));
  if (undrawn.length > 0) {
    return `не нарисованы теги: ${undrawn.slice(0, 5).join(", ")}`;
  }
  const broken = images.filter((img) => img.naturalWidth === 0).length;
  if (broken > 0) return `не разобраны картинки эталона: ${broken}`;
  return "1";
}

main().then(
  (state) => {
    document.body.dataset.ready = state;
  },
  (e: unknown) => {
    document.body.dataset.ready = `ошибка: ${(e as Error).message}`;
  },
);
