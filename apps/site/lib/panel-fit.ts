// Панель иконки на компьютере всегда помещается в видимую часть окна (решение владельца 13 ноября 2026).
// Панель прилипает к верху окна (sticky, top 1rem) и бывает высотой до окна без двух отступов. Пока
// страница не прокручена, она начинается ниже шапки и фильтров — и её низ уходил за край окна, а
// прокрутка внутри панели уводила содержимое как раз туда. Теперь высота панели — от её верха до низа
// окна с тем же отступом: прокрутили страницу — панель поднялась к верху и выросла до полной высоты.
// Число — --panel-fit у панели (app/globals.css); на телефоне панель — шторка, её высота своя.
//
// Колесо над панелью (замечание владельца 13 ноября 2026: панель «подвисала» сжатой): пока панель не
// выросла до полной высоты, а страницу ещё можно прокрутить вниз, у панели data-fit="grow" — её
// содержимое не прокручивается, и колесо над ней крутит страницу: панель поднимается и растёт. Когда она
// прилипла к верху, колесо крутит уже её содержимое. Раньше колесо над сжатой панелью крутило только
// её содержимое, а до конца — ничего: страница стояла, панель оставалась сжатой.
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

/** Растёт ли ещё панель: не прилипла к верху, страницу можно прокрутить вниз, содержимое не помещается. */
export function panelGrows(
  top: number,
  inset: number,
  scrollY: number,
  maxScrollY: number,
  overflowing: boolean,
): boolean {
  return overflowing && top > inset + 0.5 && scrollY < maxScrollY - 0.5;
}

/**
 * Держать высоту панели по месту в окне: сразу, при прокрутке и смене размера окна, при смене высоты
 * страницы над панелью — не чаще раза за кадр. Возвращает отписку.
 */
export function fitPanel(panel: HTMLElement): () => void {
  let frame = 0;
  const update = () => {
    frame = 0;
    if (!window.matchMedia(DESKTOP).matches) {
      panel.style.removeProperty("--panel-fit");
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
    panel.style.setProperty("--panel-fit", `${fit}px`);
    // Не помещается ли содержимое в панель такой высоты.
    const overflowing = panel.scrollHeight > fit + 1;
    if (
      panelGrows(
        top,
        inset,
        window.scrollY,
        root.scrollHeight - root.clientHeight,
        overflowing,
      )
    ) {
      panel.dataset.fit = "grow";
    } else {
      delete panel.dataset.fit;
    }
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(update);
  };
  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  return () => {
    cancelAnimationFrame(frame);
    delete panel.dataset.fit;
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    observer.disconnect();
  };
}
