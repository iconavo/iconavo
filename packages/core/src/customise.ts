// Настройки иконки из строк — параметров адреса edge API (ADR-0024), а в фазе 3 и атрибутов
// веб-компонента (ADR-0031). Значения те же, что у Iconify, но строже: неподходящее значение — null,
// а не тихо другой результат. Так, «rotate=90» Iconify понимает как поворот на 180°, здесь это ошибка.

/** Поворот на четверть оборота по часовой стрелке: 0–3. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Flip {
  hFlip: boolean;
  vFlip: boolean;
}

const QUARTERS = /^-?\d+$/;
const ANGLE = /^(-?\d+(?:\.\d+)?)(deg|%)$/;
const SIZE =
  /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|ex|ch|%|vw|vh|vmin|vmax|pt|pc|cm|mm|in)?$/;

const quarter = (n: number): Rotation => (((n % 4) + 4) % 4) as Rotation;

/** «90deg», «180deg», «270deg» (и другие кратные 90), «25%», «50%», «75%», четверти «1»–«3» (и −3…−1). */
export function parseRotate(value: string): Rotation | null {
  if (QUARTERS.test(value)) {
    const n = Number(value);
    return Math.abs(n) <= 3 ? quarter(n) : null;
  }
  const match = ANGLE.exec(value);
  if (!match) return null;
  const turns = Number(match[1]) / (match[2] === "deg" ? 90 : 25);
  return Number.isInteger(turns) ? quarter(turns) : null;
}

/** «horizontal», «vertical» или оба — через запятую или пробел. */
export function parseFlip(value: string): Flip | null {
  const flip: Flip = { hFlip: false, vFlip: false };
  for (const word of value.split(/[\s,]+/)) {
    if (word === "") continue;
    if (word === "horizontal") flip.hFlip = true;
    else if (word === "vertical") flip.vFlip = true;
    else return null;
  }
  return flip;
}

/** Ширина или высота: число с единицей CSS или без, «auto» — по холсту, «unset» и «none» — без атрибута. */
export function parseSize(value: string): string | null {
  return value === "auto" ||
    value === "unset" ||
    value === "none" ||
    SIZE.test(value)
    ? value
    : null;
}
