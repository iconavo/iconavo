// Общее у микроанимаций раскладки (решения владельца 12 ноября 2026): панель иконки
// (components/panel/PanelLayout.tsx) и сворачивание боковой панели (lib/sidebar-motion.ts). Элементы
// переходят со старых мест на новые сдвигом и сжатием (FLIP, математика — lib/flip.ts) через Web
// Animations API; «уменьшить движение» в системе — без анимаций.
//
// Такое движение — только transform: браузер рисует его отдельно от скриптов и раскладки страницы, и
// оно не дёргается, когда страница занята (18 ноября 2026 — открытие панели иконки переведено на него с
// перехода ширины колонок, который заново раскладывал страницу в каждом кадре). Запуск перехода — в той
// же задаче, что и щелчок, поэтому здесь считается каждая миллисекунда: места читаются только у того,
// что видно, запущенные анимации помнятся, а длительности из стилей читаются один раз.

import {
  type Box,
  childFrames,
  type Edge,
  flipFrames,
  nearViewport,
  VIEWPORT_MARGIN,
} from "./flip";

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

/** Длительности, уже прочитанные из стилей: переменные --motion-* заданы один раз и не меняются. */
const durations = new Map<string, number>();

/**
 * Длительность из переменной CSS у <html>: одно значение у стилей и у скрипта. Читается один раз: вычислить
 * стиль корня сразу после перемены на странице — несколько миллисекунд, а переход запускается в той же
 * задаче, что и щелчок.
 */
export function motionMs(name: string, fallback: number): number {
  let ms = durations.get(name);
  if (ms === undefined) {
    ms = parseMs(
      getComputedStyle(document.documentElement).getPropertyValue(name),
      fallback,
    );
    durations.set(name, ms);
  }
  return ms;
}

/**
 * Дети элемента, которые не должны растягиваться вместе с ним: селектор от элемента (:scope).
 * - track — место ребёнка в элементе меряется до и после перемены (childBoxes), и ребёнок плавно едет с
 *   прежнего места на новое: подпись карточки, значок и текст поля поиска.
 * - x и y — без замера прежнего места ребёнок привязан к краю (по умолчанию — к середине); его новое
 *   место всё равно меряется.
 * - Ни track, ни краёв — ребёнок стоит посередине элемента (иконка карточки): ему хватает обратного
 *   сжатия, и его место не меряется вовсе. Каждый замер — работа в задаче щелчка.
 */
export interface ContentRule {
  selector: string;
  track?: boolean;
  x?: Edge;
  y?: Edge;
}

export interface FlipOptions {
  /** Метка анимаций: новый переход с той же меткой отменяет недоигранный. */
  id: string;
  /** Длительность, мс. */
  duration: number;
  /**
   * Дети элемента, которым нужно обратное сжатие: селектор (от элемента, :scope) — дети посередине; правила
   * — у каждого свой край.
   */
  content: string | readonly ContentRule[];
}

/** Идущие переходы по меткам: отменить недоигранный — без расспросов каждого элемента об его анимациях. */
const running = new Map<string, Set<Animation>>();

/** Отменить недоигранный переход с этой меткой. */
export function cancelFlip(id: string) {
  const own = running.get(id);
  if (own === undefined) return;
  running.delete(id);
  for (const animation of own) animation.cancel();
}

/** Группа элементов одного перехода: их места до перемены и как вести себя детям. */
export interface FlipGroup {
  before: Map<HTMLElement, Box>;
  /** Дети, которым нужно обратное сжатие; нет — элемент сжимается целиком. */
  content?: string | readonly ContentRule[];
  /** Места детей с track до перемены (childBoxes). */
  children?: Map<HTMLElement, Box>;
  /**
   * Элемент не сжимается: сразу нового размера, едет только его левый верхний угол. Для рядов со своей
   * прокруткой и для текста — их содержимое при сжатии исказилось бы.
   */
  keepSize?: boolean;
}

/**
 * Места элементов сейчас — до перемены. Только у тех, что на экране или рядом (margin пикселей сверху и
 * снизу): остальные переедут без анимации, и читать их места незачем. ordered — элементы идут по порядку
 * сверху вниз (карточки сетки): первый ниже экрана — дальше можно не смотреть.
 */
export function boxesNear(
  scope: ParentNode,
  selector: string,
  margin: number = VIEWPORT_MARGIN,
  ordered = false,
): Map<HTMLElement, Box> {
  const boxes = new Map<HTMLElement, Box>();
  const height = window.innerHeight;
  for (const element of scope.querySelectorAll<HTMLElement>(selector)) {
    const box = boxOf(element);
    if (nearViewport(box, height, margin)) boxes.set(element, box);
    else if (ordered && box.top >= height + margin) break;
  }
  return boxes;
}

/** Места детей с track до перемены. Скрытые дети (display: none) не в счёт. */
export function childBoxes(
  before: Map<HTMLElement, Box>,
  content: readonly ContentRule[],
): Map<HTMLElement, Box> {
  const boxes = new Map<HTMLElement, Box>();
  const tracked = content.filter((rule) => rule.track);
  if (tracked.length === 0) return boxes;
  for (const element of before.keys()) {
    for (const rule of tracked) {
      for (const child of element.querySelectorAll<HTMLElement>(
        rule.selector,
      )) {
        const own = boxOf(child);
        if (own.width !== 0 || own.height !== 0) boxes.set(child, own);
      }
    }
  }
  return boxes;
}

/**
 * Кадры для element.animate в виде «свойство → значения по кадрам»: браузер разбирает такую запись на
 * треть быстрее, чем список кадров-объектов (замер 18 ноября 2026: 120 анимаций по 11 кадров — 2,4 мс
 * против 3,7 мс).
 */
function compact(frames: readonly Keyframe[]): PropertyIndexedKeyframes {
  return {
    offset: frames.map((frame) => frame.offset ?? null),
    transform: frames.map((frame) => String(frame.transform)),
  };
}

/**
 * Переход элементов со старых мест на нынешние — несколько групп разом. Недоигранный переход с той же
 * меткой отменяется, а новый начинается с того вида, что был на экране. Сначала читаются все места,
 * потом запускаются все анимации: раскладка страницы считается один раз. extra — ещё анимации в тот же
 * запуск (панель иконки): их кадры готовы заранее.
 */
export function playFlips(
  groups: readonly FlipGroup[],
  { id, duration }: { id: string; duration: number },
  extra: readonly (readonly [HTMLElement, Keyframe[]])[] = [],
) {
  const timing: KeyframeAnimationOptions = { duration, easing: "linear", id };
  cancelFlip(id);
  const plays: (readonly [HTMLElement, Keyframe[]])[] = [...extra];
  for (const { before, content, children, keepSize } of groups) {
    for (const [element, was] of before) {
      if (!element.isConnected) continue;
      const to = boxOf(element);
      const from = keepSize
        ? { ...was, width: to.width, height: to.height }
        : was;
      const frames = flipFrames(from, to);
      if (frames !== undefined) plays.push([element, frames.box]);
      if (content === undefined) continue;
      if (typeof content === "string") {
        if (frames?.content === undefined) continue;
        for (const child of element.querySelectorAll<HTMLElement>(content)) {
          plays.push([child, frames.content]);
        }
        continue;
      }
      for (const rule of content) {
        const still =
          !rule.track && rule.x === undefined && rule.y === undefined;
        // Ребёнок посередине: только обратное сжатие, без замеров; элемент не сжимается — ничего.
        if (still && frames?.content === undefined) continue;
        for (const child of element.querySelectorAll<HTMLElement>(
          rule.selector,
        )) {
          if (still) {
            if (frames?.content !== undefined) {
              plays.push([child, frames.content]);
            }
            continue;
          }
          const box = boxOf(child);
          // Скрытый ребёнок (display: none) — без анимации.
          if (box.width === 0 && box.height === 0) continue;
          const own = childFrames(
            from,
            to,
            box,
            children?.get(child),
            rule.x,
            rule.y,
          );
          if (own !== undefined) plays.push([child, own]);
        }
      }
    }
  }
  if (plays.length === 0) return;
  const own = new Set<Animation>();
  running.set(id, own);
  for (const [element, frames] of plays) {
    own.add(element.animate(compact(frames), timing));
  }
  // Доиграл — список больше не нужен (если его не заменил следующий переход).
  const [first] = own;
  first?.finished.then(
    () => {
      if (running.get(id) === own) running.delete(id);
    },
    () => {},
  );
}

/**
 * Переход одной группы элементов со старых мест (before) на нынешние. Элементы далеко за краем экрана
 * переходят без анимации.
 */
export function playFlip(
  before: Map<HTMLElement, Box>,
  { id, duration, content }: FlipOptions,
) {
  const height = window.innerHeight;
  const near = new Map(
    [...before].filter(
      ([element, box]) =>
        nearViewport(box, height) ||
        (element.isConnected && nearViewport(boxOf(element), height)),
    ),
  );
  playFlips([{ before: near, content }], { id, duration });
}
