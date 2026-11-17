// Выделение иконок в сетке (редизайн, шаг 5; сценарий «Выделение» макета Figma): временный выбор на
// странице ради одной кнопки «Download N Icons» — до 100 иконок. Отдельно от рюкзака (lib/bag.ts): тот
// живёт между страницами, а выбор — пока открыта страница.

/** Сколько иконок можно выбрать — как в макете («8/100 assets selected»). */
export const SELECT_LIMIT = 100;

export type SelectChange = "added" | "removed" | "full";

/** Выбрать иконку или снять выбор; выбрано уже limit — новая не добавляется. */
export function toggleSelected(
  list: readonly string[],
  name: string,
  limit: number = SELECT_LIMIT,
): { list: readonly string[]; change: SelectChange } {
  if (list.includes(name)) {
    return { list: list.filter((n) => n !== name), change: "removed" };
  }
  if (list.length >= limit) return { list, change: "full" };
  return { list: [...list, name], change: "added" };
}
