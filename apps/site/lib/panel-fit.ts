// Панель иконки на компьютере всегда помещается в видимую часть окна (решение владельца 13 ноября 2026).
// Панель прилипает к верху окна (sticky, top 1rem) и бывает высотой до окна без двух отступов. Пока
// страница не прокручена, она начинается ниже шапки и фильтров — и её низ уходил за край окна, а
// прокрутка внутри панели уводила содержимое как раз туда. Теперь высота панели — от её верха до низа
// окна с тем же отступом: прокрутили страницу — панель поднялась к верху и выросла до полной высоты.
// Число — --panel-fit у панели (app/globals.css); на телефоне панель — шторка, её высота своя.

/** Телефон — как раскладка сайта (до 64rem): там панель — шторка. */
const DESKTOP = "(min-width: 64rem)";
/** Ниже этого панель не сжимается: низ уйдёт за край окна, но содержимое останется читаемым. */
const MIN_HEIGHT = 240;

/** Наибольшая высота панели: от её верха (не выше отступа) до низа окна с отступом, не меньше min. */
export function panelFit(
  viewport: number,
  top: number,
  inset: number,
  min = MIN_HEIGHT,
): number {
  return Math.max(min, Math.round(viewport - Math.max(top, inset) - inset));
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
      return;
    }
    const inset = Number.parseFloat(getComputedStyle(panel).top) || 0;
    const fit = panelFit(
      document.documentElement.clientHeight,
      panel.getBoundingClientRect().top,
      inset,
    );
    panel.style.setProperty("--panel-fit", `${fit}px`);
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
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    observer.disconnect();
  };
}
