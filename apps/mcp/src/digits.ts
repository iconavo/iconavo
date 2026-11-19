// Цифры номеров клеток картинки-сетки — контурами, без шрифтов (шаг 10 фазы 4): resvg в Workers
// шрифтов не знает, а свой шрифт пришлось бы разбирать при каждой отрисовке. Знак — штрих в поле
// 6 × 10, рисуется линией с круглыми концами.

const GLYPHS: Readonly<Record<string, string>> = {
  "0": "M3 1C1.6 1 1 2.6 1 5s.6 4 2 4 2-1.6 2-4-.6-4-2-4Z",
  "1": "M1.6 2.6 3.6 1v8",
  "2": "M1.2 2.6C1.5 1.6 2.2 1 3.1 1 4.3 1 5 1.8 5 2.9 5 4.9 1 6.6 1 9h4",
  "3": "M1.2 1.7C1.7 1.2 2.3 1 3 1c1.1 0 1.9.7 1.9 1.8S4.1 4.7 2.9 4.7h-.5.5c1.3 0 2.1.8 2.1 2.1S4.1 9 2.9 9C2.2 9 1.5 8.7 1 8.3",
  "4": "M3.9 9V1L1 6.4h4.4",
  "5": "M4.8 1H1.6l-.4 3.7c.4-.3 1-.5 1.7-.5C4.2 4.2 5 5.1 5 6.6S4.1 9 2.8 9C2.1 9 1.5 8.8 1 8.4",
  "6": "M4.6 1.4C4.2 1.1 3.7 1 3.2 1 1.8 1 1 2.6 1 5.3 1 7.8 1.8 9 3 9s2-1 2-2.4c0-1.4-.8-2.2-2-2.2S1 5.1 1 6.2",
  "7": "M1 1h4L2.4 9",
  "8": "M3 4.8c-1.1 0-1.8-.7-1.8-1.9S1.9 1 3 1s1.8.8 1.8 1.9S4.1 4.8 3 4.8Zm0 0c1.2 0 2 .8 2 2.1S4.2 9 3 9 1 8.2 1 6.9s.8-2.1 2-2.1Z",
  "9": "M1.4 8.6c.4.3.9.4 1.4.4C4.2 9 5 7.4 5 4.7 5 2.2 4.2 1 3 1S1 2 1 3.4c0 1.4.8 2.2 2 2.2s2-.7 2-1.8",
};

/** Ширина знака с промежутком, в единицах поля. */
const ADVANCE = 6.4;
const FIELD_HEIGHT = 10;

/**
 * Число контурами: `<g>` в точке (x, y) — верхний левый угол, высота знака height px. Только
 * цифры 0–9: номер клетки — целое положительное число.
 */
export function numberSvg(
  value: number,
  x: number,
  y: number,
  height: number,
  color: string,
): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`номер клетки — целое число от 0, а не ${value}`);
  }
  const scale = height / FIELD_HEIGHT;
  const paths = [...String(value)]
    .map(
      (digit, i) =>
        `<path transform="translate(${round(i * ADVANCE)} 0)" d="${GLYPHS[digit]}"/>`,
    )
    .join("");
  return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
