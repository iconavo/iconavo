// Панель иконки на компьютере всегда помещается в видимую часть окна (решение владельца 13 ноября 2026).
// Панель прилипает к верху окна (sticky, top 1rem) и бывает высотой до окна без двух отступов. Пока
// страница не прокручена, она начинается ниже шапки сайта — и её низ уходил за край окна, а прокрутка
// внутри панели уводила содержимое как раз туда. Теперь высота панели — от её верха до низа окна с тем
// же отступом: прокрутили страницу — панель поднялась к верху и выросла до полной высоты.
// Число — max-height у самой панели (в стилях — запасное значение до первого замера); на телефоне панель —
// шторка, её высота своя. Не переменная CSS: её смена заставляла бы браузер заново считать стили всего
// содержимого панели на каждом кадре прокрутки страницы у её верха.
//
// Колесо над панелью крутит только её (решение владельца 18 ноября 2026: панель прокручивается независимо
// от страницы). Дошли до конца панели — страница стоит (overscroll-behavior: contain в стилях). Прежде,
// пока панель не прилипла к верху, колесо над ней крутило страницу, чтобы панель «доросла» (13 ноября —
// тогда она начиналась на уровне сетки и была вдвое короче); браузер, начав крутить страницу, крутил её
// до остановки колеса — до содержимого панели было не добраться. Панель во всю высоту страницы короче
// полной только на высоту шапки сайта, и дорастает она вместе с прокруткой страницы.
// Одно исключение: содержимое помещается в панель целиком — прокручивать в ней нечего, и колесо над ней
// крутит страницу, как над любым другим местом (data-fit="whole").
//
// Внизу страницы (план редизайна, шаг 5): место панели кончается над подвалом, и прилипшую панель полной
// высоты оно выталкивало вверх — заголовок и ✕ уходили за край окна. Теперь панель там ниже: от отступа
// у верха окна до конца своего места.

/** Телефон — как раскладка сайта (до 64rem): там панель — шторка. */
const DESKTOP = "(min-width: 64rem)";
/** Ниже этого панель не сжимается: низ уйдёт за край окна, но содержимое останется читаемым. */
const MIN_HEIGHT = 240;

/**
 * Наибольшая высота панели: от её верха (не выше отступа) до низа окна с отступом или до конца места панели
 * на странице (end), если он выше, — не меньше min.
 */
export function panelFit(
  viewport: number,
  top: number,
  inset: number,
  min = MIN_HEIGHT,
  end = Number.POSITIVE_INFINITY,
): number {
  return Math.max(
    min,
    Math.round(Math.min(viewport - inset, end) - Math.max(top, inset)),
  );
}

/**
 * Конец места панели в окне: низ родителя без его нижнего отступа. Место не выше самой панели — его высоту
 * задаёт она (короткая страница), и тогда это не предел: иначе панель, становясь ниже, укорачивала бы и
 * место — и уже не вырастала бы обратно.
 */
function placeEnd(panel: HTMLElement): number {
  const place = panel.parentElement;
  if (place === null) return Number.POSITIVE_INFINITY;
  const style = getComputedStyle(place);
  const top = Number.parseFloat(style.paddingTop) || 0;
  const bottom = Number.parseFloat(style.paddingBottom) || 0;
  if (place.clientHeight - top - bottom <= panel.offsetHeight + 1) {
    return Number.POSITIVE_INFINITY;
  }
  return place.getBoundingClientRect().bottom - bottom;
}

/** Помещается ли содержимое в панель целиком: прокручивать в ней нечего (пиксель — на округление). */
export function panelWhole(content: number, height: number): boolean {
  return content <= height + 1;
}

/** Поставить панели высоту по её месту в окне — один раз, сейчас. */
export function fitNow(panel: HTMLElement): void {
  if (!window.matchMedia(DESKTOP).matches) {
    panel.style.removeProperty("max-height");
    delete panel.dataset.fit;
    return;
  }
  const root = document.documentElement;
  const inset = Number.parseFloat(getComputedStyle(panel).top) || 0;
  const top = panel.getBoundingClientRect().top;
  const fit = panelFit(
    root.clientHeight,
    top,
    inset,
    MIN_HEIGHT,
    placeEnd(panel),
  );
  const whole = panelWhole(panel.scrollHeight, fit);
  panel.style.maxHeight = `${fit}px`;
  if (whole) panel.dataset.fit = "whole";
  else delete panel.dataset.fit;
}

/**
 * Держать высоту панели по месту в окне: при прокрутке и смене размера окна, при смене высоты страницы и
 * содержимого панели — не чаще раза за кадр. Возвращает отписку.
 *
 * Первый замер — в следующем кадре, а не сразу: панель открывается в той же задаче, что и щелчок, и
 * чтение раскладки сразу после запуска переезда карточек (components/panel/PanelLayout.tsx) заставило бы
 * браузер лишний раз пересчитать стили всех едущих элементов. Высоту первого кадра ставит сама раскладка
 * панели (fitNow) — до того, как запустит переезд.
 */
export function fitPanel(panel: HTMLElement): () => void {
  let frame = 0;
  const update = () => {
    frame = 0;
    fitNow(panel);
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(update);
  };
  schedule();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  // Высота страницы над панелью и высота её содержимого: сама панель зажата по высоте, поэтому следим за
  // её разделами — и за их заменой (иконки нет — разделы другие).
  const sizes = new ResizeObserver(schedule);
  const watch = () => {
    sizes.disconnect();
    sizes.observe(document.body);
    for (const section of panel.children) sizes.observe(section);
  };
  watch();
  const sections = new MutationObserver(watch);
  sections.observe(panel, { childList: true });
  return () => {
    cancelAnimationFrame(frame);
    panel.style.removeProperty("max-height");
    delete panel.dataset.fit;
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    sizes.disconnect();
    sections.disconnect();
  };
}
