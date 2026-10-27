// Настройки тега из атрибутов (ADR-0031, ADR-0032). Строки разбирают те же функции ядра, что у edge
// API; неверное значение пропускается, а в консоли — одно предупреждение с допустимыми значениями
// (warn ядра: одно на текст за жизнь страницы). Размеры строже, чем у edge API: проценты, unset и none
// внутри тега ломают размер, а README их не обещает. Без DOM — разбор проверяется в Node.

import {
  parseFlip,
  parseRotate,
  parseSize,
  type RenderOptions,
  store,
  warn,
} from "@iconavo-ui/core/internal";

export type Placeholder = "skeleton" | "spinner" | "none";

export interface TagOptions {
  /** Рисунок для renderIcon: размеры, повороты, отражения, толщина линии — без цвета и подписи. */
  render: RenderOptions;
  /** Цвет — свойством стиля внутреннего <svg>: так работает и var(--x). */
  color: string | undefined;
  /** Заглушка — она же класс резерва; у none стилей нет. */
  placeholder: Placeholder;
  /** Место до загрузки: заданные размеры, одна сторона — квадрат, без размеров и auto — 1em. */
  width: string;
  height: string;
  /** Значения атрибутов строкой: та же строка и то же состояние — перерисовывать не нужно. */
  key: string;
}

const PLACEHOLDERS: readonly string[] = ["skeleton", "spinner", "none"];

const SIZES = "a number, a CSS length or auto";

/** Ширина или высота: число, длина CSS или auto — без процентов, unset и none. */
function size(value: string): string | null {
  const parsed = parseSize(value);
  return parsed === null || /^(unset|none)$|%$/.test(parsed) ? null : parsed;
}

/** Настройки по атрибутам тега; get — значение атрибута или null. */
export function tagOptions(get: (name: string) => string | null): TagOptions {
  let key = "";
  const read = <T>(
    name: string,
    parse: (value: string) => T | null,
    allowed: string,
  ): T | undefined => {
    const value = get(name);
    key += `${value},`;
    if (value === null) return undefined;
    const parsed = parse(value);
    if (parsed === null) warn(`invalid ${name} "${value}", use ${allowed}`);
    return parsed ?? undefined;
  };
  const width = read("width", size, SIZES);
  const height = read("height", size, SIZES);
  const render: RenderOptions = {
    width,
    height,
    rotate: read("rotate", parseRotate, "90deg, 180deg, 270deg or 1, 2, 3"),
    strokeWidth: read(
      "stroke-width",
      (value) => {
        const n = Number(value);
        return n > 0 && n < Infinity ? n : null;
      },
      "a positive number",
    ),
    ...read("flip", parseFlip, "horizontal, vertical or both"),
  };
  const color = read(
    "color",
    (value) =>
      typeof CSS !== "object" || CSS.supports("color", value) ? value : null,
    "a CSS color",
  );
  const placeholder = read(
    "placeholder",
    (value) => (PLACEHOLDERS.includes(value) ? (value as Placeholder) : null),
    "skeleton, spinner or none",
  );
  // Свой размер иконки (auto) до загрузки неизвестен — место держит квадрат 1em.
  const w = width === "auto" ? undefined : width;
  const h = height === "auto" ? undefined : height;
  return {
    render,
    color,
    placeholder: placeholder ?? store.settings.placeholder,
    width: w ?? h ?? "1em",
    height: h ?? w ?? "1em",
    key,
  };
}
