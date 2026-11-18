// Микроанимация раскладки (FLIP, решение владельца 12 ноября 2026): элемент рисуется со старого места
// и размера и переходит в новое — сдвигом и сжатием (transform), а его дети — обратным сжатием, чтобы
// иконка и подписи карточки не растягивались. Здесь только математика; анимации запускает
// components/panel/PanelLayout.tsx через Web Animations API.

/** Прямоугольник на экране, как у getBoundingClientRect. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Замедление к концу (ease-out quart); в CSS ему соответствует --motion-ease-out. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 4;

/**
 * Сколько кадров у перехода. Между кадрами — линейно: так кадры элемента и обратного сжатия детей
 * совпадают в каждой точке, и дети не «плывут».
 */
export const FLIP_STEPS = 10;

/** Запас сверху и снизу экрана: элементы дальше него переходят без анимации. */
export const VIEWPORT_MARGIN = 200;

export interface FlipFrames {
  /** Кадры самого элемента: сдвиг и сжатие от старого прямоугольника к новому. */
  box: Keyframe[];
  /** Кадры его содержимого — обратное сжатие; нет, если размер не меняется. */
  content?: Keyframe[];
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const k = (n: number) => `${Math.round(n * 10000) / 10000}`;

/**
 * Кадры перехода элемента со старого места (from) на новое (to); undefined — элемент не сдвинулся
 * и не изменил размер. Сжатие — от центра элемента (transform-origin по умолчанию).
 */
export function flipFrames(
  from: Box,
  to: Box,
  ease: (t: number) => number = easeOut,
  steps: number = FLIP_STEPS,
): FlipFrames | undefined {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = to.width > 0 && from.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 && from.height > 0 ? from.height / to.height : 1;
  const resized = Math.abs(sx - 1) >= 0.002 || Math.abs(sy - 1) >= 0.002;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) return undefined;
  const box: Keyframe[] = [];
  const content: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const rest = 1 - ease(offset);
    const scaleX = 1 + (sx - 1) * rest;
    const scaleY = 1 + (sy - 1) * rest;
    box.push({
      offset,
      transform: `translate(${px(dx * rest)}, ${px(dy * rest)}) scale(${k(scaleX)}, ${k(scaleY)})`,
    });
    content.push({
      offset,
      transform: `scale(${k(1 / scaleX)}, ${k(1 / scaleY)})`,
    });
  }
  return resized ? { box, content } : { box };
}

/**
 * К чему в родителе привязан ребёнок по одной оси, когда его прежнее место неизвестно: начало (левый или
 * верхний край), середина или конец. Этот край держит своё расстояние до того же края родителя.
 */
export type Edge = "start" | "center" | "end";

/** Расстояние от начала родителя до начала ребёнка, при котором ребёнок привязан к краю edge. */
function edgeGap(
  parentSize: number,
  gap: number,
  childSize: number,
  size: number,
  edge: Edge,
): number {
  if (edge === "start") return gap;
  // До конца родителя — как в новой раскладке; середина — посередине между началом и концом.
  const end = size - (parentSize - gap - childSize) - childSize;
  return edge === "end" ? end : (gap + end) / 2;
}

/**
 * Сдвиг ребёнка по одной оси, когда родитель нарисован сжатым в s раз вокруг своей середины, а сам ребёнок —
 * в 1/s раз вокруг своей: после обоих сжатий ребёнок своего размера, а от начала родителя на экране до
 * начала ребёнка — gap.
 */
function childShift(
  parentStart: number,
  parentSize: number,
  childStart: number,
  childSize: number,
  s: number,
  gap: number,
): number {
  const offset = childStart + childSize / 2 - (parentStart + parentSize / 2);
  return (gap + childSize / 2 - (parentSize * s) / 2) / s - offset;
}

/**
 * Кадры ребёнка внутри элемента, который переходит со старого прямоугольника (from) на новый (to) сжатием
 * (flipFrames). Ребёнок остаётся своего нового размера (child — его прямоугольник в новой раскладке), а
 * его место в родителе плавно переходит от прежнего (was — прямоугольник до перемены) к новому: подпись
 * карточки начинается там же, где была, значок поля поиска стоит у левого края, подсказка — у правого.
 * Прежнее место неизвестно — ребёнок привязан к краю x и y. undefined — родитель не меняет размер и
 * ребёнок в нём не сдвинулся: ему ничего не нужно.
 */
export function childFrames(
  from: Box,
  to: Box,
  child: Box,
  was?: Box,
  x: Edge = "center",
  y: Edge = "center",
  ease: (t: number) => number = easeOut,
  steps: number = FLIP_STEPS,
): Keyframe[] | undefined {
  const sx = to.width > 0 && from.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 && from.height > 0 ? from.height / to.height : 1;
  const gapX = child.left - to.left;
  const gapY = child.top - to.top;
  // Где ребёнок был в родителе: по замеру или — без замера — у того же края, что и теперь.
  const wasX =
    was === undefined
      ? edgeGap(to.width, gapX, child.width, from.width, x)
      : was.left - from.left;
  const wasY =
    was === undefined
      ? edgeGap(to.height, gapY, child.height, from.height, y)
      : was.top - from.top;
  const resized = Math.abs(sx - 1) >= 0.002 || Math.abs(sy - 1) >= 0.002;
  const moved = Math.abs(wasX - gapX) >= 0.5 || Math.abs(wasY - gapY) >= 0.5;
  if (!resized && !moved) return undefined;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const rest = 1 - ease(offset);
    const scaleX = 1 + (sx - 1) * rest;
    const scaleY = 1 + (sy - 1) * rest;
    const dx = childShift(
      to.left,
      to.width,
      child.left,
      child.width,
      scaleX,
      gapX + (wasX - gapX) * rest,
    );
    const dy = childShift(
      to.top,
      to.height,
      child.top,
      child.height,
      scaleY,
      gapY + (wasY - gapY) * rest,
    );
    frames.push({
      offset,
      transform: `translate(${px(dx)}, ${px(dy)}) scale(${k(1 / scaleX)}, ${k(1 / scaleY)})`,
    });
  }
  return frames;
}

/**
 * Кадры выезда из-за края: элемент приезжает на своё место справа, с расстояния distance (out — уезжает
 * туда же). Замедление и число кадров — те же, что у flipFrames: панель иконки движется ровно вместе с
 * краем колонки, которую она сдвигает, и не наезжает на то, что ещё не доехало.
 */
export function slideFrames(
  distance: number,
  out = false,
  ease: (t: number) => number = easeOut,
  steps: number = FLIP_STEPS,
): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const part = out ? ease(offset) : 1 - ease(offset);
    frames.push({ offset, transform: `translate(${px(distance * part)}, 0)` });
  }
  return frames;
}

/** Виден ли прямоугольник на экране высотой viewportHeight — с запасом VIEWPORT_MARGIN. */
export function nearViewport(
  box: Box,
  viewportHeight: number,
  margin: number = VIEWPORT_MARGIN,
): boolean {
  return box.top + box.height > -margin && box.top < viewportHeight + margin;
}
