// Общее у микроанимаций раскладки (решения владельца 12 ноября 2026): панель иконки
// (components/panel/PanelLayout.tsx) и сворачивание боковой панели (lib/sidebar-motion.ts). Элементы
// переходят со старых мест на новые сдвигом и сжатием (FLIP, математика — lib/flip.ts) через Web
// Animations API; «уменьшить движение» в системе — без анимаций.

import { type Box, flipFrames, nearViewport } from "./flip";

/** Прямоугольник элемента на экране — вместе с текущими сдвигами анимаций. */
export const boxOf = (element: Element): Box => {
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** Включено ли в системе «уменьшить движение». */
export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Длительность из значения CSS: «240ms» → 240, «0.3s» → 300, число без единиц — миллисекунды. */
export function parseMs(value: string, fallback: number): number {
  const text = value.trim();
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return fallback;
  return text.endsWith("ms") ? n : text.endsWith("s") ? n * 1000 : n;
}

/** Длительность из переменной CSS у <html>: одно значение у стилей и у скрипта. */
export const motionMs = (name: string, fallback: number): number =>
  parseMs(
    getComputedStyle(document.documentElement).getPropertyValue(name),
    fallback,
  );

export interface FlipOptions {
  /** Метка анимаций: новый переход с той же меткой отменяет недоигранный. */
  id: string;
  /** Длительность, мс. */
  duration: number;
  /** Дети элемента, которым нужно обратное сжатие (селектор от элемента, :scope). */
  content: string;
}

/**
 * Переход элементов со старых мест (before) на нынешние. Недоигранный переход с той же меткой
 * отменяется, а новый начинается с того вида, что был на экране. Элементы далеко за краем экрана
 * переходят без анимации.
 */
export function playFlip(
  before: Map<HTMLElement, Box>,
  { id, duration, content }: FlipOptions,
) {
  const timing: KeyframeAnimationOptions = { duration, easing: "linear", id };
  const alive = [...before].filter(([element]) => element.isConnected);
  for (const [element] of alive) {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation.id === id) animation.cancel();
    }
  }
  const moves = alive.map(([element, from]) => ({
    element,
    from,
    to: boxOf(element),
  }));
  const height = window.innerHeight;
  for (const { element, from, to } of moves) {
    if (!nearViewport(from, height) && !nearViewport(to, height)) continue;
    const frames = flipFrames(from, to);
    if (frames === undefined) continue;
    element.animate(frames.box, timing);
    if (frames.content === undefined) continue;
    for (const child of element.querySelectorAll<HTMLElement>(content)) {
      child.animate(frames.content, timing);
    }
  }
}
