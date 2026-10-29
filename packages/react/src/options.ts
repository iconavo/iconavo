// Настройки компонента из пропсов (ADR-0031, ADR-0033). Значения разбирают те же функции ядра, что у
// тега и edge API, с теми же правилами, что у тега (packages/icon/src/options.ts): размеры без процентов,
// unset и none. Разбор чистый — на сервере и в браузере он один и тот же, иначе разметка разошлась бы при
// гидратации. Поэтому предупреждения здесь только собираются, а печатает их эффект в браузере; цвет
// не проверяется вовсе: CSS.supports на сервере нет. Числа — как строки: width={32} — это "32".

import {
  parseFlip,
  parseRotate,
  parseSize,
  type RenderOptions,
} from "@iconavo-ui/core/internal";

export type Placeholder = "skeleton" | "spinner" | "none";

// Описания пропсов видят разработчики в подсказках редактора — поэтому по-английски.
/** Props that `Icon` reads itself; other props go to the `<svg>`. */
export interface IconOptions {
  /** Icon name, `set:icon`, for example `lucide:house`. */
  icon: string;
  /** Pixels, a CSS length or `auto`. Default height is `1em`, width follows the icon's proportions. */
  width?: number | string;
  height?: number | string;
  /** Any CSS color. Default: the text color. */
  color?: string;
  /** Line width of line icons, in units of the icon's grid. */
  strokeWidth?: number | string;
  /** `90deg`, `180deg`, `270deg`, or quarter turns `1`, `2`, `3`. */
  rotate?: number | string;
  /** `horizontal`, `vertical`, or both: `horizontal,vertical`. */
  flip?: string;
  /** Lowers the icon by `0.125em`, onto the text baseline. */
  inline?: boolean;
  /** Text for screen readers; without it the icon is decorative. */
  label?: string;
  /** What the icon shows while it loads. Default: `skeleton`, or the value from `configure()`. */
  placeholder?: Placeholder;
}

export interface Parsed {
  /** Рисунок для renderIcon: размеры, повороты, отражения, толщина линии. */
  render: RenderOptions;
  /** Место до загрузки: заданные размеры, одна сторона — квадрат, без размеров и auto — 1em. */
  width: string;
  height: string;
  /** Класс заглушки: заданной пропом или iconavo-loading — её вид решает лист стилей по configure(). */
  placeholder: string | undefined;
  /** Тексты предупреждений без «Iconavo:» — печатает эффект браузера. */
  warnings: string[];
}

const PLACEHOLDERS: readonly string[] = ["skeleton", "spinner", "none"];

const SIZES = "a number, a CSS length or auto";

/** Ширина или высота: число, длина CSS или auto — без процентов, unset и none. */
function size(value: string): string | null {
  const parsed = parseSize(value);
  return parsed === null || /^(unset|none)$|%$/.test(parsed) ? null : parsed;
}

/** Настройки по пропсам: неверное значение пропускается, а текст предупреждения — в warnings. */
export function iconOptions(props: Omit<IconOptions, "icon">): Parsed {
  const warnings: string[] = [];
  const read = <T>(
    name: string,
    value: unknown,
    parse: (value: string) => T | null,
    allowed: string,
  ): T | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value);
    const parsed = parse(text);
    if (parsed === null)
      warnings.push(`invalid ${name} "${text}", use ${allowed}`);
    return parsed ?? undefined;
  };
  const width = read("width", props.width, size, SIZES);
  const height = read("height", props.height, size, SIZES);
  const render: RenderOptions = {
    width,
    height,
    rotate: read(
      "rotate",
      props.rotate,
      parseRotate,
      "90deg, 180deg, 270deg or 1, 2, 3",
    ),
    strokeWidth: read(
      "strokeWidth",
      props.strokeWidth,
      (value) => {
        const n = Number(value);
        return n > 0 && n < Infinity ? n : null;
      },
      "a positive number",
    ),
    ...read("flip", props.flip, parseFlip, "horizontal, vertical or both"),
  };
  const placeholder = read(
    "placeholder",
    props.placeholder,
    (value) => (PLACEHOLDERS.includes(value) ? value : null),
    "skeleton, spinner or none",
  );
  // Свой размер иконки (auto) до загрузки неизвестен — место держит квадрат 1em.
  const w = width === "auto" ? undefined : width;
  const h = height === "auto" ? undefined : height;
  return {
    render,
    width: w ?? h ?? "1em",
    height: h ?? w ?? "1em",
    placeholder:
      placeholder === undefined
        ? "iconavo-loading"
        : placeholder === "none"
          ? undefined
          : `iconavo-${placeholder}`,
    warnings,
  };
}
