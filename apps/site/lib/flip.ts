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

/** Виден ли прямоугольник на экране высотой viewportHeight — с запасом VIEWPORT_MARGIN. */
export function nearViewport(
  box: Box,
  viewportHeight: number,
  margin: number = VIEWPORT_MARGIN,
): boolean {
  return box.top + box.height > -margin && box.top < viewportHeight + margin;
}
