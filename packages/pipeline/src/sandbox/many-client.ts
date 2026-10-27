// Скрипт страницы «5000 иконок» (фаза 3, шаг 5): работает в браузере, не в Node. configure — из того
// же адреса, что и скрипт тега (import map страницы), как в README для страниц без сборщика. Модули
// вычисляются подряд, без задач между ними, поэтому теги, которые скрипт тега уже зарегистрировал, не
// успеют ничего запросить до configure: грузят их сигналы наблюдателя видимости, а они приходят
// позже. Счётчики обновляются раз в секунду, чтобы не мешать прокрутке.

import { configure } from "@iconavo-ui/icon";
import type { ManyData } from "./many-page.js";

const data = JSON.parse(
  document.getElementById("many-data")?.textContent ?? "{}",
) as ManyData;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

// Запросы ядра — счётчик поверх fetch: столько же строк в DevTools → Network (Fetch/XHR).
let requests = 0;
const original = window.fetch.bind(window);
window.fetch = (input, init) => {
  requests++;
  return original(input, init);
};

configure({
  api: data.hosts.filter((h) => h.kind === "api").map((h) => h.url),
  cdn: data.hosts.filter((h) => h.kind === "cdn").map((h) => h.url),
});

const tags = [...document.querySelectorAll("iconavo-icon")];
const icons = $("icons");

/** Нарисованная иконка — <svg> с viewBox в shadow DOM; у резерва его нет. */
const drawn = () =>
  tags.filter((tag) => tag.shadowRoot?.querySelector("svg[viewBox]")).length;

// Кадры: сколько за последнюю секунду и сколько долгих — дольше 50 мс — с начала. Паузы дольше
// секунды — вкладка была в фоне, это не кадр.
let frames = 0;
let long = 0;
let last = performance.now();
const frame = (now: number) => {
  frames++;
  const gap = now - last;
  if (gap > 50 && gap < 1000) long++;
  last = now;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

function tick(): void {
  $("drawn").textContent = `Нарисовано ${drawn()} из ${tags.length}`;
  $("requests").textContent = `запросов ${requests}`;
  $("frames").textContent =
    `кадров в секунду ${frames} · долгих кадров ${long}`;
  frames = 0;
}
tick();
setInterval(tick, 1000);

// Цвет и размер текста — свойствами стиля из скрипта: строгая политика страницы их не запрещает.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-color]",
)) {
  button.onclick = () => {
    icons.style.color = button.dataset.color ?? "";
  };
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-size]",
)) {
  button.onclick = () => {
    icons.style.fontSize = button.dataset.size ?? "";
  };
}

document.body.dataset.ready = "1";
