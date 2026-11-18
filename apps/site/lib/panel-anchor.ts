// Сетка не прыгает, когда открывается и закрывается панель иконки во всю высоту (план редизайна, шаг 5).
// Панель сужает левую колонку: шапка набора и строка поиска в ней становятся выше, и карточки ниже
// уезжали вместе с той, по которой щёлкнули. Браузеры держат прокрутку сами по-разному: Chrome не держал
// её, когда строка поиска переходила в два ряда, WebKit — то держал, то нет, а Safari этого не умеет
// вовсе. Поэтому прокрутку держит сайт: опора — карточка, страница докручивается так, чтобы опора
// осталась на месте в окне; браузерное «держание» на это время выключено (data-panel-anchor у <html>,
// app/globals.css). Страница в самом верху — без опоры: шапка видна, и страница растёт вниз, как у
// браузеров.
//
// Место опоры — по раскладке, без сдвигов анимаций (18 ноября 2026): карточки переезжают сдвигом
// (transform, components/panel/PanelLayout.tsx), и место «как на экране» посреди переезда — не то, где
// карточка стоит. Раскладка меняется один раз, сразу, поэтому и опора ставится на место сразу; дальше —
// только страховка от поздних сдвигов: проверка в следующем кадре и в конце. В каждом кадре её нет:
// чтение места заставляло бы браузер пересчитывать стили всех едущих карточек посреди их движения.

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

/**
 * Верх элемента в окне по раскладке — без сдвигов и сжатий (transform) его и его предков: сумма offsetTop
 * вверх по цепочке минус прокрутка страницы.
 */
export function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (
    let e: HTMLElement | null = element;
    e !== null;
    e = e.offsetParent instanceof HTMLElement ? e.offsetParent : null
  ) {
    top += e.offsetTop;
  }
  return top - window.scrollY;
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
  return element === undefined
    ? undefined
    : { element, top: layoutTop(element) };
}

/** Удержание, которое идёт сейчас: новое заменяет его. */
let current: (() => void) | undefined;

/**
 * Держать опору на месте в окне ms миллисекунд: сразу, в следующем кадре и в конце — на случай поздних
 * сдвигов раскладки. Колесо, касание и клавиши — прокрутка пользователя: удержание сразу кончается.
 */
export function holdAnchor(anchor: Anchor, ms: number): void {
  current?.();
  const root = document.documentElement;
  root.dataset.panelAnchor = "";
  let frame = 0;
  let timer = 0;
  const fix = () => {
    if (!anchor.element.isConnected) return;
    const shift = anchorShift(anchor.top, layoutTop(anchor.element));
    if (shift !== 0) window.scrollBy({ top: shift, behavior: "instant" });
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    delete root.dataset.panelAnchor;
    for (const type of USER) window.removeEventListener(type, stop);
    if (current === stop) current = undefined;
  };
  for (const type of USER) {
    window.addEventListener(type, stop, { passive: true });
  }
  current = stop;
  fix();
  frame = requestAnimationFrame(fix);
  timer = window.setTimeout(() => {
    fix();
    stop();
  }, ms);
}

/** Прокрутка пользователя. */
const USER = ["wheel", "touchmove", "keydown"] as const;
