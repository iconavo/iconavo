// Плавное колесо мыши на всём сайте (решение владельца 23 ноября 2026): после щелчка колеса страница мягко
// доезжает до места, а не прыгает. Браузер сам сглаживает колесо примерно за 0,15 с; здесь — дольше, по
// экспоненте с постоянной TAU_MS: 95% пути щелчка — за 3·TAU. Сглаживается только:
// - щелчок колеса мыши: шаг строками (Firefox) или крупный целый шаг в пикселях (Chrome и Edge — ±100 на
//   щелчок). Тачпад, мышь с плавным колесом и наклон колеса — как в браузере: у них своя инерция, и
//   сглаживание поверх неё было бы «вязким»;
// - сама страница. Под курсором область со своей прокруткой — панель иконки, боковое меню, рюкзак, блок
//   кода — и она может прокрутиться в эту сторону или не передаёт прокрутку дальше (overscroll-behavior:
//   contain): колесо остаётся ей, как без сглаживания;
// - без Ctrl, Meta и Shift: масштаб и горизонтальная прокрутка — как в браузере;
// - пока в системе не включено «уменьшить движение».
// Кто-то другой прокрутил страницу — клавиши, полоса прокрутки, поиск по странице, переход по ссылке,
// удержание карточки при открытии панели (lib/panel-anchor.ts) — сглаживание уступает: следующий кадр видит,
// что страница не там, где её оставили, и останавливается. Плавные переходы внутри страницы (номера
// страниц, якоря) — scroll-behavior: smooth в app/globals.css; свою прокрутку этот код ведёт мгновенной
// (behavior: "instant") по кадрам.

/** Постоянная сглаживания, мс: за 3·TAU страница проходит 95% пути щелчка. */
export const TAU_MS = 100;
/** Строка при шаге строками (Firefox): Chrome прокручивает 100 px за щелчок в 3 строки. */
export const LINE_PX = 100 / 3;
/** Меньше этого шага в пикселях — не щелчок колеса, а тачпад или плавное колесо. */
export const NOTCH_MIN_PX = 50;
/** Ближе этого до цели — уже на месте. */
const DONE_PX = 0.5;
/** Кадр не длиннее этого: после паузы (вкладка была в фоне) страница не перескакивает к цели. */
const MAX_FRAME_MS = 64;
/** Первый кадр движения — как обычный кадр при 60 Гц. */
const FIRST_FRAME_MS = 16;

/** То, что функции берут у события колеса. */
export interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** Щелчок колеса мыши вверх или вниз: строками или крупным целым шагом в пикселях, без клавиш. */
export function isMouseNotch(e: WheelLike): boolean {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (e.deltaX !== 0 || e.deltaY === 0) return false;
  if (e.deltaMode !== 0) return true;
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= NOTCH_MIN_PX;
}

/** Путь щелчка в пикселях: строки — по LINE_PX, страницы — по высоте окна. */
export function notchDistance(e: WheelLike, viewport: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * viewport;
  return e.deltaY;
}

/**
 * Следующее положение страницы через dt мс: доля оставшегося пути по экспоненте — одинаково при любой
 * частоте кадров. Ближе полупикселя — уже цель.
 */
export function stepToward(
  current: number,
  target: number,
  dt: number,
  tau = TAU_MS,
): number {
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(target - next) < DONE_PX ? target : next;
}

/** То, что проверка областей со своей прокруткой берёт у элемента. */
export interface ScrollBox {
  readonly parentElement: ScrollBox | null;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}
/** То, что она берёт у его стилей. */
export interface ScrollBoxStyle {
  readonly overflowY: string;
  readonly overscrollBehaviorY: string;
}

/**
 * Колесо остаётся области со своей прокруткой между элементом под курсором и страницей (root): она
 * прокрутится сама в сторону dy или не передаёт прокрутку дальше (contain, none) — так браузер не
 * прокрутил бы и страницу. Область без запаса прокрутки с overscroll-behavior: auto пропускается.
 */
export function ownsWheel(
  start: ScrollBox | null,
  dy: number,
  root: ScrollBox | null,
  styleOf: (element: ScrollBox) => ScrollBoxStyle,
): boolean {
  for (let el = start; el !== null && el !== root; el = el.parentElement) {
    const style = styleOf(el);
    if (!/^(auto|scroll|overlay)$/.test(style.overflowY)) continue;
    if (el.scrollHeight > el.clientHeight + 1) {
      const room =
        dy > 0
          ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
          : el.scrollTop > 0;
      if (room) return true;
    }
    if (
      style.overscrollBehaviorY === "contain" ||
      style.overscrollBehaviorY === "none"
    ) {
      return true;
    }
  }
  return false;
}

/** Сгладить колесо мыши на странице окна win. Возвращает отписку. */
export function smoothWheel(win: Window): () => void {
  const doc = win.document;
  const reduce = win.matchMedia("(prefers-reduced-motion: reduce)");
  /** Куда едет страница. */
  let target = 0;
  /** Где она должна быть сейчас (дробное). */
  let current = 0;
  /** Где она оказалась после нашей прокрутки: иначе — прокрутил кто-то другой. */
  let placed = 0;
  let frame = 0;
  let time = 0;

  const maxScroll = () => {
    const page = doc.scrollingElement ?? doc.documentElement;
    return Math.max(0, page.scrollHeight - page.clientHeight);
  };
  const moved = () => Math.abs(win.scrollY - placed) > 1;

  const tick = (now: number) => {
    frame = 0;
    if (moved()) {
      time = 0;
      return;
    }
    const dt = time === 0 ? FIRST_FRAME_MS : Math.min(now - time, MAX_FRAME_MS);
    time = now;
    current = stepToward(current, target, dt);
    win.scrollTo({ top: current, behavior: "instant" });
    placed = win.scrollY;
    if (current !== target) frame = win.requestAnimationFrame(tick);
    else time = 0;
  };

  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || reduce.matches || !isMouseNotch(e)) return;
    if (
      ownsWheel(
        e.target as Element | null,
        e.deltaY,
        doc.documentElement,
        (element) => win.getComputedStyle(element as Element),
      )
    ) {
      return;
    }
    const max = maxScroll();
    // Начало движения или страницу прокрутил кто-то другой — едем от того места, где она стоит.
    if (frame === 0 || moved()) {
      current = win.scrollY;
      target = current;
      placed = current;
      time = 0;
    }
    target = Math.min(target, max);
    current = Math.min(current, max);
    const next = Math.min(
      max,
      Math.max(0, target + notchDistance(e, win.innerHeight)),
    );
    // Упёрлись в край страницы — дальше как в браузере.
    if (next === target) return;
    e.preventDefault();
    target = next;
    if (frame === 0) frame = win.requestAnimationFrame(tick);
  };

  doc.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    if (frame !== 0) win.cancelAnimationFrame(frame);
    frame = 0;
    doc.removeEventListener("wheel", onWheel);
  };
}
