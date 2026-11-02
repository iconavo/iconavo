// Общая шкала стилей (ADR-0052): у каждого набора свои названия вариантов, а фильтр «Стиль» и
// переключатель карточек нужны одни на весь каталог. Толщина (thin…bold) и форма (rounded, sharp) —
// не стили: это варианты внутри стиля. Оттенки кожи Fluent — тоже не стили, они сворачиваются в
// карточку отдельно (ADR-0048). Тот же список — в схеме metadata.json (@iconavo-ui/schema).

/** Стили в порядке показа: контур, заливка, двухцветные, цветные. */
export const STYLES = ["outline", "filled", "duotone", "color"] as const;

export type Style = (typeof STYLES)[number];

/** Стиль из шкалы, а не произвольная строка. */
export const isStyle = (value: unknown): value is Style =>
  typeof value === "string" && (STYLES as readonly string[]).includes(value);

/**
 * Таблица стилей набора: стиль → суффиксы его вариантов в порядке показа (у Phosphor контур — thin,
 * light, "", bold). "" — вариант без суффикса. Каждый суффикс набора — ровно в одном стиле.
 */
export type StyleTable = Partial<Record<Style, readonly string[]>>;

/**
 * Суффиксы стиля в порядке выбора главного варианта: вариант без суффикса, если он из этого стиля
 * (Phosphor Regular, залитый Material), затем остальные в порядке таблицы.
 */
export function styleCandidates(suffixes: readonly string[]): string[] {
  return suffixes.includes("")
    ? ["", ...suffixes.filter((s) => s !== "")]
    : [...suffixes];
}
