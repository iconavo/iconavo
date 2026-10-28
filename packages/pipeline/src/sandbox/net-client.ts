// Скрипт страницы «Сбои сети» (фаза 3, шаг 9): работает в браузере, не в Node. configure — из того же
// адреса, что и скрипт тега (import map страницы), затем теги: так первый же запрос уходит к хостам
// страницы. Рядом с каждой иконкой — её имя: по нему проверка видит, что текст не сдвинулся.

import { configure } from "@iconavo-ui/icon";
import type { NetData } from "./net-page.js";

const data = JSON.parse(
  document.getElementById("net-data")?.textContent ?? "{}",
) as NetData;

configure({
  api: data.hosts.filter((h) => h.kind === "api").map((h) => h.url),
  cdn: data.hosts.filter((h) => h.kind === "cdn").map((h) => h.url),
});

const icons = document.getElementById("icons") as HTMLElement;
for (const name of data.names) {
  const cell = document.createElement("div");
  cell.className = "c";
  const tag = document.createElement("iconavo-icon");
  tag.setAttribute("icon", name);
  tag.setAttribute("noobserver", "");
  const text = document.createElement("span");
  text.textContent = name;
  cell.append(tag, text);
  icons.append(cell);
}

document.body.dataset.ready = "1";
