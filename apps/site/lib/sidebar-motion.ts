// Плавное сворачивание и разворачивание боковой панели (решение владельца 12 ноября 2026).
// - Ширина панели, значки, подписи и шапка переходят стилями (app/globals.css). Переходы включает
//   атрибут data-sidebar-motion у <html> — только на время анимации, поэтому загрузка страницы, смена
//   темы и наведение не анимируются.
// - Страница перестраивается сама, кадр за кадром, вместе с краем панели.
// - Сетки (иконки набора, карточки наборов, выдача поиска) на время перехода сразу получают свою
//   конечную ширину: в них уже новое число колонок и карточки конечного размера — подписи не
//   переносятся. Карточки переезжают со старых мест сдвигом и сжатием (lib/motion.ts), высота сетки
//   меняется плавно — и всё, что ниже, едет вместе с ней.
// Повторный щелчок посреди анимации разворачивает её с того места, где она сейчас. «Уменьшить
// движение» в системе и шторка на телефоне — без этой анимации.

import type { Box } from "./flip";
import { boxOf, motionMs, playFlip, reducedMotion } from "./motion";
import { setCollapsed } from "./sidebar";

/** Сетки, у которых от ширины колонки страницы зависит число колонок. */
export const GRIDS = ".icon-grid, .result-grid, .set-grid";
/** Карточки сетки. */
const CARDS = ":scope > *";
/** Содержимое карточки — обратное сжатие, чтобы иконка и подписи не искажались. */
const CONTENT =
  ":scope > .icon-card-link > *, :scope.result-skeleton > *, :scope.set-card > *";
/** Метки анимаций переезда карточек и высоты сеток: новый переход отменяет недоигранный. */
const FLIP_ID = "iconavo-sidebar-flip";
const HEIGHT_ID = "iconavo-sidebar-height";
/** До 64rem панель — шторка меню со своей анимацией (lib/menu.ts). */
const DESKTOP = "(min-width: 64rem)";
/** Запас к концу перехода — если событие transitionend не придёт. */
const END_SLACK_MS = 120;

interface Run {
  sidebar: HTMLElement;
  /** Ширина каждой сетки до перехода и после. */
  widths: Map<HTMLElement, { from: number; to: number }>;
  timer: number;
  onEnd: (event: TransitionEvent) => void;
}

let run: Run | undefined;

/** Показать свёрнутую или развёрнутую раскладку — без записи в хранилище. */
function showCollapsed(collapsed: boolean) {
  const root = document.documentElement;
  if (collapsed) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
}

const widthsOf = (grids: HTMLElement[]) =>
  new Map(grids.map((grid) => [grid, grid.getBoundingClientRect().width]));

/** Сколько ещё идёт переход ширины панели (CSS-переход виден в Web Animations API). */
function widthLeft(sidebar: HTMLElement, fallback: number): number {
  for (const animation of sidebar.getAnimations()) {
    if ((animation as CSSTransition).transitionProperty !== "width") continue;
    const end = animation.effect?.getComputedTiming().endTime;
    const now = animation.currentTime;
    if (typeof end === "number" && typeof now === "number") {
      return Math.max(0, end - now);
    }
  }
  return fallback;
}

/** Высота сеток — плавно от прежней к новой; недоигранный переход отменяется. */
function playHeights(before: Map<HTMLElement, number>, duration: number) {
  const easing =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-ease-out")
      .trim() || "ease-out";
  for (const [grid, from] of before) {
    if (!grid.isConnected) continue;
    for (const animation of grid.getAnimations()) {
      if (animation.id === HEIGHT_ID) animation.cancel();
    }
    const to = grid.getBoundingClientRect().height;
    if (Math.abs(to - from) < 0.5) continue;
    grid.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration,
      easing,
      id: HEIGHT_ID,
    });
  }
}

/** Конец перехода: сетки снова по ширине колонки страницы, переходы стилей выключаются. */
function finish() {
  if (run === undefined) return;
  const { sidebar, widths, timer, onEnd } = run;
  run = undefined;
  clearTimeout(timer);
  sidebar.removeEventListener("transitionend", onEnd);
  for (const grid of widths.keys()) grid.style.removeProperty("width");
  delete document.documentElement.dataset.sidebarMotion;
}

/** Свернуть или развернуть панель — с микроанимацией, если её можно показать. */
export function toggleSidebar(collapse: boolean): void {
  const sidebar = document.getElementById("sidebar");
  if (
    sidebar === null ||
    reducedMotion() ||
    !window.matchMedia(DESKTOP).matches
  ) {
    finish();
    setCollapsed(collapse);
    return;
  }

  // Где карточки и какой высоты сетки на экране сейчас — со сдвигами, если переход уже идёт.
  const grids = [...document.querySelectorAll<HTMLElement>(GRIDS)];
  const cards = new Map<HTMLElement, Box>();
  const heights = new Map<HTMLElement, number>();
  for (const grid of grids) {
    heights.set(grid, grid.getBoundingClientRect().height);
    for (const card of grid.querySelectorAll<HTMLElement>(CARDS)) {
      cards.set(card, boxOf(card));
    }
  }

  let widths: Map<HTMLElement, { from: number; to: number }>;
  const previous = run;
  if (previous === undefined) {
    // Конечная ширина сеток: на мгновение показать новую раскладку без переходов (атрибута анимации
    // ещё нет) и прочитать, затем вернуть прежнюю. Между этим нет отрисовки — на экране не мигает.
    const from = widthsOf(grids);
    showCollapsed(collapse);
    const to = widthsOf(grids);
    showCollapsed(!collapse);
    // Прежние стили — снова исходные: иначе переход начнётся с замеренной раскладки, а не с экрана.
    void getComputedStyle(sidebar).width;
    widths = new Map(
      grids.map((grid) => [
        grid,
        { from: from.get(grid) ?? 0, to: to.get(grid) ?? 0 },
      ]),
    );
  } else {
    // Повторный щелчок посреди перехода: обратно — к прежней ширине.
    clearTimeout(previous.timer);
    widths = new Map(
      [...previous.widths].map(([grid, { from, to }]) => [
        grid,
        { from: to, to: from },
      ]),
    );
  }
  for (const [grid, { to }] of widths) {
    if (to > 0) grid.style.width = `${to}px`;
  }

  const root = document.documentElement;
  root.dataset.sidebarMotion = collapse ? "collapse" : "expand";
  // Стили с атрибутом анимации — до переключения: скрытым частям панели есть откуда проявляться.
  void getComputedStyle(sidebar).width;
  setCollapsed(collapse);

  const duration = widthLeft(sidebar, motionMs("--motion-sidebar", 260));
  playFlip(cards, { id: FLIP_ID, duration, content: CONTENT });
  playHeights(heights, duration);

  const onEnd =
    previous?.onEnd ??
    ((event: TransitionEvent) => {
      if (event.target === sidebar && event.propertyName === "width") finish();
    });
  if (previous === undefined) sidebar.addEventListener("transitionend", onEnd);
  run = {
    sidebar,
    widths,
    timer: window.setTimeout(finish, duration + END_SLACK_MS),
    onEnd,
  };
}
