// Ссылки на живые примеры (ADR-0050) — одно место для README пакета, README примеров и сайта: тест
// согласованности сверяет их со всеми текстами. HTML и React открываются в WebContainer StackBlitz
// командой dev: HTML — маленьким статическим сервером servor. Шаблон template=html (статика без
// установки) выполняет внешний скрипт-модуль как обычный скрипт, и тег падает на export (30 октября
// 2026). Next.js 16 StackBlitz пока не запускает (webcontainer-core#1978), а в 15.4, которую он
// запускает, — критические уязвимости: пример Next.js создают у себя командой create-next-app.

import { BRANCH, REPO, type StarterId } from "./config.js";

/** Папка примера на GitHub. */
export const starterTree = (id: StarterId) =>
  `https://github.com/${REPO}/tree/${BRANCH}/examples/starters/${id}`;

/** Открыть пример в StackBlitz: файлы, которые сразу видны, и параметры запуска. */
function stackblitz(
  id: StarterId,
  params: [name: string, value: string][],
): string {
  const query = new URLSearchParams(params).toString();
  return `https://stackblitz.com/github/${REPO}/tree/${BRANCH}/examples/starters/${id}?${query}`;
}

/** Примеры, которые открываются в StackBlitz по ссылке. */
export const STACKBLITZ_LINKS: Partial<Record<StarterId, string>> = {
  html: stackblitz("html", [
    ["file", "index.html"],
    ["startScript", "dev"],
  ]),
  react: stackblitz("react", [
    ["file", "src/App.tsx"],
    ["startScript", "dev"],
  ]),
};

/** Проект из примера Next.js одной командой. */
export const CREATE_NEXT_APP = `npx create-next-app@latest --example ${starterTree("next")} my-icons`;
