// Алиасы одинаковых вариантов (ADR-0002), как у Iconify: варианты одной иконки сравниваются между
// собой, и вариант, нарисованный так же, как более старший, становится его алиасом: 360-sharp → 360.

import type { NormalizedIcon } from "../normalize/normalize.js";

const same = (a: NormalizedIcon, b: NormalizedIcon) =>
  a.body === b.body && a.width === b.width && a.height === b.height;

/**
 * Имя варианта → имя родителя. order — суффиксы вариантов от старшего к младшему, первый — "".
 * Основа имени — самая короткая, которая сама есть среди иконок: у `done-outline-rounded` это
 * `done-outline`, если иконки `done` нет. Алиас появляется только при побайтно одинаковых теле и
 * размере, поэтому ошибка в группе не может показать чужую картинку.
 */
export function variantAliases(
  icons: ReadonlyMap<string, NormalizedIcon>,
  order: readonly string[],
): Map<string, string> {
  const groups = new Map<string, { name: string; rank: number }[]>();
  for (const name of icons.keys()) {
    let base = name;
    let rank = order.indexOf("");
    order.forEach((suffix, i) => {
      if (suffix === "" || !name.endsWith(suffix)) return;
      const candidate = name.slice(0, -suffix.length);
      if (candidate.length < base.length && icons.has(candidate)) {
        base = candidate;
        rank = i;
      }
    });
    const group = groups.get(base) ?? [];
    group.push({ name, rank });
    groups.set(base, group);
  }

  const aliases = new Map<string, string>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.rank - b.rank);
    // Родитель — только вариант, оставшийся иконкой: так не бывает цепочек алиасов.
    const kept: string[] = [];
    for (const { name } of group) {
      const icon = icons.get(name) as NormalizedIcon;
      const parent = kept.find((k) =>
        same(icons.get(k) as NormalizedIcon, icon),
      );
      if (parent === undefined) kept.push(name);
      else aliases.set(name, parent);
    }
  }
  return aliases;
}
