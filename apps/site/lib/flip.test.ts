import { describe, expect, it } from "vitest";
import {
  type Box,
  childFrames,
  type Edge,
  easeOut,
  FLIP_STEPS,
  flipFrames,
  nearViewport,
  slideFrames,
} from "./flip";

// Карточка сетки до открытия панели (7 колонок по 152 px) и после (6 по 115,5 px).
const WIDE: Box = { left: 728, top: 415, width: 152, height: 101 };
const NARROW: Box = { left: 391.5, top: 528, width: 115.5, height: 101 };

/** Числа из transform кадра: translate(x, y) scale(a, b) → [x, y, a, b]. */
const numbers = (frame: Keyframe) =>
  String(frame.transform)
    .match(/-?\d+(\.\d+)?/g)
    ?.map(Number) ?? [];

describe("переход раскладки (FLIP)", () => {
  it("первый кадр — старое место и ширина, последний — новое, без сдвига и сжатия", () => {
    const frames = flipFrames(WIDE, NARROW);
    expect(frames?.box).toHaveLength(FLIP_STEPS + 1);
    const [x0, y0, sx0, sy0] = numbers(frames?.box[0] as Keyframe);
    // центр старого прямоугольника минус центр нового
    expect(x0).toBeCloseTo(728 + 76 - (391.5 + 57.75), 1);
    expect(y0).toBeCloseTo(415 - 528, 1);
    expect(sx0).toBeCloseTo(152 / 115.5, 3);
    expect(sy0).toBe(1);
    expect(numbers(frames?.box.at(-1) as Keyframe)).toEqual([0, 0, 1, 1]);
    expect(frames?.box.map((f) => f.offset)).toEqual(
      Array.from({ length: FLIP_STEPS + 1 }, (_, i) => i / FLIP_STEPS),
    );
  });

  it("содержимое сжимается обратно: в каждом кадре произведение сжатий — единица", () => {
    const frames = flipFrames(WIDE, NARROW);
    expect(frames?.content).toHaveLength(FLIP_STEPS + 1);
    frames?.box.forEach((frame, i) => {
      const [, , sx] = numbers(frame);
      const [cx] = numbers(frames.content?.[i] as Keyframe);
      expect(sx * cx).toBeCloseTo(1, 3);
    });
  });

  it("только сдвиг — без кадров содержимого; ничего не изменилось — перехода нет", () => {
    const moved = flipFrames({ ...NARROW, left: 300 }, NARROW);
    expect(moved?.box).toHaveLength(FLIP_STEPS + 1);
    expect(moved?.content).toBeUndefined();
    expect(
      flipFrames(NARROW, { ...NARROW, left: NARROW.left + 0.2 }),
    ).toBeUndefined();
  });

  it("замедление к концу: быстро в начале, у конца почти стоит", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.9);
    expect(easeOut(0.9)).toBeGreaterThan(0.999);
  });

  it("видимость: экран и запас 200 px сверху и снизу", () => {
    expect(
      nearViewport({ left: 0, top: 500, width: 10, height: 100 }, 1100),
    ).toBe(true);
    expect(
      nearViewport({ left: 0, top: 1250, width: 10, height: 100 }, 1100),
    ).toBe(true);
    expect(
      nearViewport({ left: 0, top: 1350, width: 10, height: 100 }, 1100),
    ).toBe(false);
    expect(
      nearViewport({ left: 0, top: -350, width: 10, height: 100 }, 1100),
    ).toBe(false);
  });
});

// Поле поиска над сеткой: без панели — во всю колонку, с панелью — на 383 px уже; левый край на месте.
const FIELD_WIDE: Box = { left: 264, top: 300, width: 1136, height: 46 };
const FIELD_NARROW: Box = { left: 264, top: 300, width: 753, height: 46 };

/** Как ребёнок привязан: прежнее место (замер) или края — когда замера нет. */
interface Hold {
  was?: Box;
  x?: Edge;
  y?: Edge;
}

/**
 * Где ребёнок на экране в кадре i: сжатие родителя вокруг его середины, сдвиг и обратное сжатие ребёнка
 * вокруг своей — как их сложит браузер. Ответ — расстояния краёв ребёнка до краёв родителя и его размер.
 */
function onScreen(from: Box, to: Box, child: Box, hold: Hold, i: number) {
  const parent = flipFrames(from, to)?.box[i] as Keyframe;
  const own = childFrames(from, to, child, hold.was, hold.x, hold.y)?.[
    i
  ] as Keyframe;
  const [tx = 0, ty = 0, sx = 1, sy = 1] = numbers(parent);
  const [ux = 0, uy = 0, kx = 1, ky = 1] = numbers(own);
  const axis = (
    pStart: number,
    pSize: number,
    cStart: number,
    cSize: number,
    t: number,
    s: number,
    u: number,
    k: number,
  ) => {
    const pMiddle = pStart + pSize / 2;
    const middle = pMiddle + t + (cStart + cSize / 2 + u - pMiddle) * s;
    const size = cSize * k * s;
    return {
      size,
      start: middle - size / 2 - (pMiddle + t - (pSize * s) / 2),
      end: pMiddle + t + (pSize * s) / 2 - (middle + size / 2),
    };
  };
  return {
    x: axis(to.left, to.width, child.left, child.width, tx, sx, ux, kx),
    y: axis(to.top, to.height, child.top, child.height, ty, sy, uy, ky),
  };
}

describe("дети элемента, который сжимается (FLIP)", () => {
  it("значок слева у поля поиска: весь переход — своего размера и в 16 px от левого края", () => {
    const icon: Box = { left: 280, top: 311, width: 24, height: 24 };
    for (let i = 0; i <= FLIP_STEPS; i++) {
      // Замер прежнего места: значок стоял там же.
      const at = onScreen(FIELD_WIDE, FIELD_NARROW, icon, { was: icon }, i);
      expect(at.x.size).toBeCloseTo(24, 1);
      expect(at.x.start).toBeCloseTo(16, 1);
      expect(at.y.size).toBeCloseTo(24, 1);
    }
  });

  it("подсказка «Ctrl K» справа: в 16 px от правого края поля, пока оно сужается", () => {
    const keys: Box = { left: 953, top: 310, width: 48, height: 26 };
    // До перемены поле было на 383 px шире — и подсказка стояла на 383 px правее.
    const was: Box = { ...keys, left: 953 + 383 };
    for (let i = 0; i <= FLIP_STEPS; i++) {
      const at = onScreen(FIELD_WIDE, FIELD_NARROW, keys, { was }, i);
      expect(at.x.size).toBeCloseTo(48, 1);
      expect(at.x.end).toBeCloseTo(16, 1);
    }
  });

  it("подпись карточки: начинается там же, где была, и доезжает до нового места", () => {
    // Панель закрывается: карточка была узкой (подпись с многоточием, от края 8 px), стала широкой —
    // подпись помещается целиком и стоит посередине (от края 18,5 px).
    const from: Box = { left: 520, top: 415, width: 97, height: 101 };
    const to: Box = { left: 728, top: 415, width: 152, height: 101 };
    const was: Box = { left: 528, top: 480, width: 81, height: 18 };
    const name: Box = { left: 746.5, top: 480, width: 115, height: 18 };
    const first = onScreen(from, to, name, { was }, 0);
    expect(first.x.start).toBeCloseTo(8, 1);
    expect(first.x.size).toBeCloseTo(115, 1);
    const last = onScreen(from, to, name, { was }, FLIP_STEPS);
    expect(last.x.start).toBeCloseTo(18.5, 1);
    // По пути — между прежним и новым местом, без возвратов.
    let previous = first.x.start;
    for (let i = 1; i <= FLIP_STEPS; i++) {
      const at = onScreen(from, to, name, { was }, i).x.start;
      expect(at).toBeGreaterThanOrEqual(previous - 0.05);
      expect(at).toBeLessThanOrEqual(18.55);
      previous = at;
    }
  });

  it("без замера прежнего места — по краям: кнопки по углам карточки", () => {
    // Карточка сдвигается и сужается; кнопки 20 × 20 в 8 px от её краёв.
    const from: Box = { left: 728, top: 415, width: 152, height: 101 };
    const to: Box = { left: 520, top: 415, width: 97, height: 101 };
    const bag: Box = { left: 528, top: 423, width: 20, height: 20 };
    const check: Box = { left: 589, top: 423, width: 20, height: 20 };
    for (let i = 0; i <= FLIP_STEPS; i++) {
      const left = onScreen(from, to, bag, { x: "start", y: "start" }, i);
      expect(left.x.start).toBeCloseTo(8, 1);
      expect(left.y.start).toBeCloseTo(8, 1);
      expect(left.x.size).toBeCloseTo(20, 1);
      const right = onScreen(from, to, check, { x: "end", y: "start" }, i);
      expect(right.x.end).toBeCloseTo(8, 1);
      expect(right.y.start).toBeCloseTo(8, 1);
    }
  });

  it("иконка посередине карточки: только обратное сжатие, как у flipFrames", () => {
    const icon: Box = { left: 437.25, top: 552, width: 24, height: 24 };
    const frames = childFrames(WIDE, NARROW, icon);
    const legacy = flipFrames(WIDE, NARROW)?.content;
    frames?.forEach((frame, i) => {
      const [ux, uy, kx, ky] = numbers(frame);
      const [lx, ly] = numbers(legacy?.[i] as Keyframe);
      expect(ux).toBeCloseTo(0, 1);
      expect(kx).toBeCloseTo(lx as number, 3);
      expect(ky).toBeCloseTo(ly as number, 3);
      // Высота карточки не меняется — по вертикали ребёнок стоит.
      expect(uy).toBeCloseTo(0, 1);
    });
  });

  it("родитель только сдвинулся, ребёнок в нём на месте — детям ничего не нужно", () => {
    const child: Box = { left: 400, top: 540, width: 24, height: 24 };
    expect(
      childFrames({ ...NARROW, left: 300 }, NARROW, child),
    ).toBeUndefined();
    // Замер: ребёнок ехал вместе с родителем.
    expect(
      childFrames({ ...NARROW, left: 300 }, NARROW, child, {
        ...child,
        left: 400 - (NARROW.left - 300),
      }),
    ).toBeUndefined();
  });

  it("родитель того же размера, а ребёнок в нём переехал — ребёнок доезжает сам", () => {
    const child: Box = { left: 400, top: 540, width: 24, height: 24 };
    const frames = childFrames(NARROW, NARROW, child, { ...child, left: 420 });
    expect(numbers(frames?.[0] as Keyframe).slice(0, 2)).toEqual([20, 0]);
    expect(numbers(frames?.at(-1) as Keyframe)).toEqual([0, 0, 1, 1]);
  });
});

describe("панель выезжает из-за края в такт с колонкой", () => {
  it("въезд: с расстояния до нуля, по тем же кадрам, что переезд карточек", () => {
    const frames = slideFrames(383);
    expect(frames).toHaveLength(FLIP_STEPS + 1);
    expect(numbers(frames[0] as Keyframe)).toEqual([383, 0]);
    expect(numbers(frames.at(-1) as Keyframe)).toEqual([0, 0]);
    // Правый край колонки и левый край панели едут вместе: тот же остаток пути в каждом кадре.
    const card = flipFrames(
      { left: 383, top: 0, width: 100, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 },
    )?.box;
    frames.forEach((frame, i) => {
      expect(numbers(frame)[0]).toBeCloseTo(
        numbers(card?.[i] as Keyframe)[0] as number,
        1,
      );
    });
  });

  it("уход: от нуля до расстояния", () => {
    const frames = slideFrames(383, true);
    expect(numbers(frames[0] as Keyframe)).toEqual([0, 0]);
    expect(numbers(frames.at(-1) as Keyframe)).toEqual([383, 0]);
  });
});
