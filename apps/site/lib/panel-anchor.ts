// Сетка не прыгает, когда открывается и закрывается панель иконки во всю высоту (план редизайна, шаг 5).
// Панель сужает левую колонку: шапка набора и строка поиска в ней становятся выше, и карточки ниже
// уезжали вместе с той, по которой щёлкнули. Браузеры держат прокрутку сами по-разному: Chrome не держал
// её, когда строка поиска переходила в два ряда, WebKit — то держал, то нет, а Safari этого не умеет
// вовсе. Поэтому на время перехода колонок прокрутку держит сайт: опора — карточка, каждый кадр страница
// докручивается так, чтобы опора осталась на месте в окне; браузерное «держание» на это время выключено
// (data-panel-anchor у <html>, app/globals.css). Страница в самом верху — без опоры: шапка видна, и
// страница растёт вниз, как у браузеров.

/** Где элемент в окне по вертикали. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * Опора: карточка иконки панели, если она видна в окне, иначе первая карточка, видная целиком; нет такой —
 * без опоры (-1). Чистая функция: места карточек — по порядку на странице.
 */
export function anchorIndex(
  cards: readonly Span[],
  own: number,
  viewport: number,
): number {
  const ownCard = cards[own];
  if (ownCard !== undefined && ownCard.bottom > 0 && ownCard.top < viewport) {
    return own;
  }
  return cards.findIndex((c) => c.top >= 0 && c.bottom <= viewport);
}

/** Какой сдвиг страницы вернёт опору на место; меньше полупикселя — не сдвигать. */
export function anchorShift(was: number, now: number): number {
  const delta = now - was;
  return Math.abs(delta) < 0.5 ? 0 : delta;
}

/** Опора и её место в окне до перемены. */
export interface Anchor {
  element: HTMLElement;
  top: number;
}

/** Опора на странице: карточки-ссылки сеток (a.icon-card-link) внутри root. */
export function findAnchor(
  root: ParentNode,
  icon: string | undefined,
): Anchor | undefined {
  if (window.scrollY < 1) return undefined;
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>("a.icon-card-link"),
  );
  const spans = cards.map((card) => card.getBoundingClientRect());
  const own =
    icon === undefined ? -1 : cards.findIndex((c) => c.dataset.icon === icon);
  const index = anchorIndex(spans, own, document.documentElement.clientHeight);
  const element = cards[index];
  const span = spans[index];
  return element === undefined || span === undefined
    ? undefined
    : { element, top: span.top };
}

/** Удержание, которое идёт сейчас: новое заменяет его. */
let current: (() => void) | undefined;

/**
 * Держать опору на месте в окне ms миллисекунд: сразу и каждый кадр (переход колонок в стилях). Колесо,
 * касание и клавиши — прокрутка пользователя: удержание сразу кончается.
 */
export function holdAnchor(anchor: Anchor, ms: number): void {
  current?.();
  const root = document.documentElement;
  root.dataset.panelAnchor = "";
  const until = performance.now() + ms;
  let frame = 0;
  const fix = () => {
    if (!anchor.element.isConnected) return;
    const shift = anchorShift(
      anchor.top,
      anchor.element.getBoundingClientRect().top,
    );
    if (shift !== 0) window.scrollBy({ top: shift, behavior: "instant" });
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    delete root.dataset.panelAnchor;
    for (const type of USER) window.removeEventListener(type, stop);
    if (current === stop) current = undefined;
  };
  const tick = (now: number) => {
    fix();
    if (now < until) frame = requestAnimationFrame(tick);
    else stop();
  };
  for (const type of USER) {
    window.addEventListener(type, stop, { passive: true });
  }
  current = stop;
  fix();
  frame = requestAnimationFrame(tick);
}

/** Прокрутка пользователя. */
const USER = ["wheel", "touchmove", "keydown"] as const;
