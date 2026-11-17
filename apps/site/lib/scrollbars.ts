// Полосы прокрутки видны только при прокрутке (решение владельца 12 ноября 2026). CSS сам не знает, что
// идёт прокрутка, поэтому элемент, который прокручивают, получает пометку data-scrolling — по ней стили
// бегунка в app/globals.css показывают его и гасят. Прокрутка страницы приходит на <html>.

/** Атрибут-пометка: "on" — прокручивают, "off" — бегунок гаснет, нет атрибута — бегунка не видно. */
export const SCROLLING_ATTR = "data-scrolling";
/** Сколько бегунок виден после последней прокрутки, мс. */
export const SCROLLBAR_IDLE_MS = 800;
/** Сколько бегунок гаснет, мс: столько же длится анимация [data-scrolling="off"] в globals.css. */
export const SCROLLBAR_FADE_MS = 300;

/** То, чем функция пользуется у элемента. */
export interface ScrollElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** То, чем функция пользуется у документа: слушатель прокрутки и корневой элемент. */
export interface ScrollDocument {
  readonly documentElement: ScrollElement;
  addEventListener(
    type: "scroll",
    listener: (event: Event) => void,
    options: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "scroll",
    listener: (event: Event) => void,
    options: EventListenerOptions,
  ): void;
}

const isElement = (target: unknown): target is ScrollElement =>
  typeof target === "object" &&
  target !== null &&
  typeof (target as ScrollElement).setAttribute === "function";

/**
 * Следит за прокруткой всех элементов документа: событие scroll не всплывает, поэтому слушатель один —
 * на документе, в фазе перехвата. У каждого элемента свой отсчёт: прокрутка страницы не зажигает полосу
 * панели. Возвращает отписку — она снимает и пометки.
 */
export function trackScrolling(doc: ScrollDocument): () => void {
  const timers = new Map<ScrollElement, ReturnType<typeof setTimeout>>();
  const later = (element: ScrollElement, ms: number, next: () => void) => {
    clearTimeout(timers.get(element));
    timers.set(element, setTimeout(next, ms));
  };
  const onScroll = (event: Event) => {
    const target: unknown = event.target;
    const element = target === doc ? doc.documentElement : target;
    if (!isElement(element)) return;
    if (element.getAttribute(SCROLLING_ATTR) !== "on") {
      element.setAttribute(SCROLLING_ATTR, "on");
    }
    later(element, SCROLLBAR_IDLE_MS, () => {
      element.setAttribute(SCROLLING_ATTR, "off");
      later(element, SCROLLBAR_FADE_MS, () => {
        element.removeAttribute(SCROLLING_ATTR);
        timers.delete(element);
      });
    });
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    for (const [element, timer] of timers) {
      clearTimeout(timer);
      element.removeAttribute(SCROLLING_ATTR);
    }
    timers.clear();
  };
}
