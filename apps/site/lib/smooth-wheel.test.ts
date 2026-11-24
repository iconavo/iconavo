import { describe, expect, it } from "vitest";
import {
  isMouseNotch,
  LINE_PX,
  notchDistance,
  ownsWheel,
  type ScrollBox,
  type ScrollBoxStyle,
  smoothWheel,
  stepToward,
  TAU_MS,
  type WheelLike,
  wheelOf,
} from "./smooth-wheel";

const wheel = (init: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...init,
});

/**
 * Щелчок колеса в Firefox: deltaMode — строки (1), только если его прочитали раньше deltaX и deltaY;
 * иначе шаг пересчитан в пиксели, дробно (3 строки — 57,6 px).
 */
function firefoxNotch(): WheelLike {
  let pixels: boolean | undefined;
  const mode = () => {
    pixels ??= false;
    return pixels ? 0 : 1;
  };
  const delta = (lines: number) => {
    pixels ??= true;
    return pixels ? lines * 19.2 : lines;
  };
  return {
    get deltaMode() {
      return mode();
    },
    get deltaX() {
      return delta(0);
    },
    get deltaY() {
      return delta(3);
    },
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
}

describe("колесо Firefox (ревизия фазы 5, С-15)", () => {
  it("снимок события читает deltaMode первым — щелчок узнаётся строками", () => {
    expect(isMouseNotch(firefoxNotch())).toBe(false);
    const wheel = wheelOf(firefoxNotch());
    expect(wheel.deltaMode).toBe(1);
    expect(isMouseNotch(wheel)).toBe(true);
    expect(notchDistance(wheel, 800)).toBe(3 * LINE_PX);
  });
});

describe("какое колесо сглаживается", () => {
  it("щелчок колеса мыши: целый крупный шаг в пикселях или строки", () => {
    expect(isMouseNotch(wheel({ deltaY: 100 }))).toBe(true);
    expect(isMouseNotch(wheel({ deltaY: -100 }))).toBe(true);
    expect(isMouseNotch(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(true);
  });

  it("тачпад и плавное колесо — мелкий или дробный шаг, как в браузере", () => {
    expect(isMouseNotch(wheel({ deltaY: 4 }))).toBe(false);
    expect(isMouseNotch(wheel({ deltaY: 33.5 }))).toBe(false);
    expect(isMouseNotch(wheel({ deltaY: 60, deltaX: 2 }))).toBe(false);
  });

  it("масштаб и горизонтальная прокрутка — как в браузере", () => {
    expect(isMouseNotch(wheel({ deltaY: 100, ctrlKey: true }))).toBe(false);
    expect(isMouseNotch(wheel({ deltaY: 100, shiftKey: true }))).toBe(false);
    expect(isMouseNotch(wheel({ deltaX: 100 }))).toBe(false);
  });

  it("путь щелчка: пиксели как есть, строки — по 33⅓ px, страница — высота окна", () => {
    expect(notchDistance(wheel({ deltaY: 100 }), 900)).toBe(100);
    expect(notchDistance(wheel({ deltaY: 3, deltaMode: 1 }), 900)).toBeCloseTo(
      3 * LINE_PX,
    );
    expect(notchDistance(wheel({ deltaY: -1, deltaMode: 2 }), 900)).toBe(-900);
  });
});

describe("шаг сглаживания", () => {
  it("за 3·TAU — 95% пути, ближе полупикселя — уже на месте", () => {
    expect(stepToward(0, 100, 3 * TAU_MS)).toBeCloseTo(95, 0);
    expect(stepToward(99.7, 100, 16)).toBe(100);
  });

  it("одинаково при любой частоте кадров", () => {
    let at60 = 0;
    for (let i = 0; i < 18; i++) at60 = stepToward(at60, 100, 1000 / 60);
    let at144 = 0;
    for (let i = 0; i < 43; i++) at144 = stepToward(at144, 100, 1000 / 144);
    // 0,3 с при 60 и 144 кадрах в секунду.
    expect(Math.abs(at60 - at144)).toBeLessThan(0.5);
  });
});

/** Элемент со своей прокруткой. */
const box = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  parentElement: ScrollBox | null = null,
): ScrollBox => ({ scrollTop, scrollHeight, clientHeight, parentElement });
const styles = new Map<ScrollBox, ScrollBoxStyle>();
const styleOf = (el: ScrollBox): ScrollBoxStyle =>
  styles.get(el) ?? { overflowY: "visible", overscrollBehaviorY: "auto" };

describe("область со своей прокруткой забирает колесо", () => {
  const page = box(0, 3000, 900);

  it("панель может прокрутиться в эту сторону — колесо ей", () => {
    const panel = box(0, 1400, 850, page);
    styles.set(panel, { overflowY: "scroll", overscrollBehaviorY: "contain" });
    expect(ownsWheel(panel, 100, page, styleOf)).toBe(true);
  });

  it("панель в конце, но не передаёт прокрутку (contain) — колесо ей, страница стоит", () => {
    const panel = box(550, 1400, 850, page);
    styles.set(panel, { overflowY: "scroll", overscrollBehaviorY: "contain" });
    expect(ownsWheel(panel, 100, page, styleOf)).toBe(true);
  });

  it("содержимое панели помещается целиком (overscroll auto) — колесо странице", () => {
    const panel = box(0, 850, 850, page);
    styles.set(panel, { overflowY: "scroll", overscrollBehaviorY: "auto" });
    expect(ownsWheel(panel, 100, page, styleOf)).toBe(false);
  });

  it("обычный элемент сетки — колесо странице", () => {
    const card = box(0, 100, 100, page);
    expect(ownsWheel(card, 100, page, styleOf)).toBe(false);
  });
});

/** Окно для smoothWheel: страница высотой height в окне viewport, кадры — по команде run. */
function fakeWindow(height = 3000, viewport = 900, reduce = false) {
  let y = 0;
  let id = 0;
  const frames = new Map<number, (time: number) => void>();
  let listener: ((e: WheelEvent) => void) | undefined;
  const page = {
    scrollHeight: height,
    clientHeight: viewport,
    scrollTop: 0,
    parentElement: null,
  };
  const win = {
    get scrollY() {
      return y;
    },
    innerHeight: viewport,
    scrollTo({ top }: ScrollToOptions) {
      y = Math.max(0, Math.min(height - viewport, top ?? y));
    },
    requestAnimationFrame(callback: (time: number) => void) {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(handle: number) {
      frames.delete(handle);
    },
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: (el: ScrollBox) => styleOf(el),
    document: {
      scrollingElement: page,
      documentElement: page,
      addEventListener: (_type: string, l: (e: WheelEvent) => void) => {
        listener = l;
      },
      removeEventListener: () => {
        listener = undefined;
      },
    },
  };
  let now = 0;
  return {
    win: win as unknown as Window,
    page,
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
    /** Прогнать кадры на ms миллисекунд, по 16 мс. */
    run(ms: number) {
      const end = now + ms;
      while (frames.size > 0 && now < end) {
        now += 16;
        const [key, callback] = frames.entries().next().value as [
          number,
          (time: number) => void,
        ];
        frames.delete(key);
        callback(now);
      }
    },
    /** Колесо: true — сглаживание взяло его себе (preventDefault). */
    wheel(init: Partial<WheelLike>, target: ScrollBox | null = null) {
      let prevented = false;
      listener?.({
        ...wheel(init),
        defaultPrevented: false,
        target,
        preventDefault() {
          prevented = true;
        },
      } as unknown as WheelEvent);
      return prevented;
    },
  };
}

describe("плавное колесо на странице", () => {
  it("щелчок колеса — страница доезжает до места за несколько кадров", () => {
    const w = fakeWindow();
    smoothWheel(w.win);
    expect(w.wheel({ deltaY: 100 })).toBe(true);
    w.run(16);
    expect(w.y).toBeGreaterThan(0);
    expect(w.y).toBeLessThan(40);
    w.run(1000);
    expect(w.y).toBe(100);
  });

  it("щелчки подряд складываются: цель — от прежней цели, а не от места", () => {
    const w = fakeWindow();
    smoothWheel(w.win);
    w.wheel({ deltaY: 100 });
    w.run(32);
    w.wheel({ deltaY: 100 });
    w.run(1000);
    expect(w.y).toBe(200);
  });

  it("тачпад — как в браузере", () => {
    const w = fakeWindow();
    smoothWheel(w.win);
    expect(w.wheel({ deltaY: 7.5 })).toBe(false);
  });

  it("кто-то другой прокрутил страницу — сглаживание уступает", () => {
    const w = fakeWindow();
    smoothWheel(w.win);
    w.wheel({ deltaY: 100 });
    w.run(16);
    w.y = 500;
    w.run(1000);
    expect(w.y).toBe(500);
    // Следующий щелчок — от нового места.
    w.wheel({ deltaY: 100 });
    w.run(1000);
    expect(w.y).toBe(600);
  });

  it("на краю страницы и при «уменьшить движение» — как в браузере", () => {
    const end = fakeWindow();
    smoothWheel(end.win);
    end.y = 2100;
    expect(end.wheel({ deltaY: 100 })).toBe(false);
    expect(end.wheel({ deltaY: -100 })).toBe(true);
    const calm = fakeWindow(3000, 900, true);
    smoothWheel(calm.win);
    expect(calm.wheel({ deltaY: 100 })).toBe(false);
  });

  it("колесо над панелью, которая прокручивается сама, — панели", () => {
    const w = fakeWindow();
    smoothWheel(w.win);
    const panel = box(0, 1400, 850, w.page);
    styles.set(panel, { overflowY: "scroll", overscrollBehaviorY: "contain" });
    expect(w.wheel({ deltaY: 100 }, panel)).toBe(false);
  });

  it("отписка снимает слушатель", () => {
    const w = fakeWindow();
    const off = smoothWheel(w.win);
    off();
    expect(w.wheel({ deltaY: 100 })).toBe(false);
  });
});
