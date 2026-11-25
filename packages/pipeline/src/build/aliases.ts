// Алиасы одинаковых вариантов (ADR-0002), как у Iconify: варианты одной иконки сравниваются между
// собой, и вариант, нарисованный так же, как более старший, становится его алиасом: 360-sharp → 360.

import { baseName } from "@iconavo-ui/search";
import type { NormalizedIcon } from "../normalize/normalize.js";

/**
 * Основа имени варианта (ADR-0002). Правило одно на конвейер, робот индекса и сайт — в общем модуле
 * поиска, рядом с карточками вариантов (ADR-0052).
 */
export { baseName };

/**
 * Тело без своего имени в ID: ID иконки — `{набор}--{имя}-{n}` (ADR-0014), и варианты с ID иначе никогда
 * не совпадали бы (ревизия фазы 5, Д-10). Двойного дефиса нет ни в именах, ни в путях рисунка.
 */
const ownIdsOut = (name: string, body: string) =>
  body.split(`--${name}-`).join("--#-");

const same = (
  aName: string,
  a: NormalizedIcon,
  bName: string,
  b: NormalizedIcon,
) =>
  ownIdsOut(aName, a.body) === ownIdsOut(bName, b.body) &&
  a.width === b.width &&
  a.height === b.height;

/**
 * Имя варианта → имя родителя. order — суффиксы вариантов от старшего к младшему, первый — "".
 * Варианты группируются по основе имени (baseName). Алиас появляется только при побайтно одинаковых
 * теле и размере, поэтому ошибка в группе не может показать чужую картинку.
 */
export function variantAliases(
  icons: ReadonlyMap<string, NormalizedIcon>,
  order: readonly string[],
): Map<string, string> {
  const groups = new Map<string, { name: string; rank: number }[]>();
  for (const name of icons.keys()) {
    const base = baseName(name, order, (n) => icons.has(n));
    const rank = order.indexOf(name.slice(base.length));
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
        same(k, icons.get(k) as NormalizedIcon, name, icon),
      );
      if (parent === undefined) kept.push(name);
      else aliases.set(name, parent);
    }
  }
  return aliases;
}
