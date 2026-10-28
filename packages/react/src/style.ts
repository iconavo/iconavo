// Стили компонента (решение владельца 28 октября 2026, ADR-0031): один лист на страницу через
// document.adoptedStyleSheets — строгая CSP его не запрещает, а атрибутов style в серверном HTML нет
// (ADR-0033). Правила — как у тега (packages/icon/src/style.ts), но без shadow DOM: классы и анимации
// с префиксом iconavo-, они общие на всю страницу.
// - display не трогается: <svg> остаётся строчным, остальное решает CSS страницы. Иначе в проектах с
//   preflight Tailwind, где svg — блок, иконка прыгала бы при гидратации.
// - Что зависит от настроек, решает лист, а не разметка: вид iconavo-loading — заглушка по умолчанию из
//   configure(), рамка iconavo-missing — только в режиме разработки. Поэтому configure() и режим,
//   разные на сервере и в браузере, не ломают гидратацию.
// - Лист ставится из useInsertionEffect, а не при загрузке модуля: в модуле нет побочных эффектов
//   (sideEffects: false). Он один на все копии пакета — под ключом Symbol.for с версией формата.
// - Пока скрипты страницы не загрузились, стилей нет: вместо скелетона — пустое место нужного размера,
//   inline опускает иконку после загрузки (решение владельца).

import type { Placeholder } from "./options.js";

const KEY = Symbol.for("iconavo.react.css.1");

interface Shared {
  /** Лист и его текст; null — листов в этой среде нет. */
  [KEY]?: { sheet: CSSStyleSheet; text: string } | null;
}

/** Текст листа: заглушка по умолчанию и режим разработки — из настроек этой страницы. */
export function css(placeholder: Placeholder, dev: boolean): string {
  const as = (name: string) =>
    `.iconavo-${name}${placeholder === name ? ",.iconavo-loading" : ""}`;
  return (
    ".iconavo-inline{vertical-align:-.125em}" +
    `${as("skeleton")}{border-radius:15%;background:currentColor;opacity:.12;` +
    "animation:iconavo-h .15s step-end,iconavo-p 1s .15s infinite alternate}" +
    `${as("spinner")}{border-radius:50%;background:conic-gradient(#0000 20%,currentColor);` +
    "mask:radial-gradient(closest-side,#0000 64%,#000 66%);" +
    "animation:iconavo-h .15s step-end,iconavo-s 1s .15s linear infinite}" +
    (dev ? ".iconavo-missing{outline:1px dashed}" : "") +
    "@keyframes iconavo-h{from{visibility:hidden}}@keyframes iconavo-p{to{opacity:.24}}" +
    "@keyframes iconavo-s{to{transform:rotate(1turn)}}" +
    `@media(prefers-reduced-motion:reduce){${as("skeleton")},${as("spinner")}{animation:iconavo-h .15s step-end}}`
  );
}

/** Лист страницы с этим текстом: создать и добавить, если его нет, переписать, если текст другой. */
export function adopt(text: string): void {
  const shared = globalThis as Shared;
  let own = shared[KEY];
  if (own === null) return;
  try {
    if (!own) {
      own = { sheet: new CSSStyleSheet(), text: "" };
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, own.sheet];
      shared[KEY] = own;
    }
    if (own.text !== text) {
      own.sheet.replaceSync(text);
      own.text = text;
    }
  } catch {
    shared[KEY] = null;
  }
}
