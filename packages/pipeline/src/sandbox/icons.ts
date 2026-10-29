// Нарисована ли иконка — общее для проверок в браузерах: у <svg> есть viewBox и рисунок. Пока иконка
// грузится, и тег, и React рисуют пустой <svg> без viewBox.

import type { Page } from "playwright";

/** Нарисованы ли иконки по селектору: по значению на каждый <svg>. */
export const drawn = (page: Page, selector: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map(
        (svg) => svg.hasAttribute("viewBox") && svg.childNodes.length > 0,
      ),
    selector,
  );

/** Ждать, пока все иконки по селектору нарисуются. */
export const allDrawn = (page: Page, selector: string, timeout = 120_000) =>
  page.waitForFunction(
    (s) => {
      const list = [...document.querySelectorAll(s)];
      return (
        list.length > 0 && list.every((svg) => svg.hasAttribute("viewBox"))
      );
    },
    selector,
    { timeout },
  );
