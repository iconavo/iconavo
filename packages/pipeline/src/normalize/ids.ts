// ID внутри иконки (ADR-0014): используемые переименовываются в `{база}-{n}` по порядку в файле,
// ссылки на них обновляются, неиспользуемые удаляются. Так ID разных иконок не конфликтуют на странице.

import { elements, refsOf, renameRefs } from "../svg/refs.js";
import type { SvgElement } from "../svg/serialize.js";

export interface IdsResult {
  /** Сколько ID переименовано. */
  renamed: number;
  /** Сколько атрибутов id удалено: не используются или повторяются. */
  removed: number;
  warnings: string[];
}

const without = (attrs: Record<string, string>, name: string) =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== name));

/**
 * Переименовывает ID дерева на месте. База — `{набор}--{иконка}`: двойного дефиса нет в именах,
 * поэтому ID разных наборов и иконок не совпадут (ADR-0001).
 */
export function renameIds(root: SvgElement, base: string): IdsResult {
  const all = elements(root);
  const used = new Set<string>();
  for (const el of all) {
    for (const [name, value] of Object.entries(el.attrs)) {
      for (const id of refsOf(name, value)) used.add(id);
    }
  }

  const map = new Map<string, string>();
  const warnings = new Set<string>();
  let removed = 0;
  for (const el of all) {
    const id = el.attrs.id;
    if (id === undefined) continue;
    if (used.has(id) && !map.has(id)) {
      const next = `${base}-${map.size}`;
      map.set(id, next);
      el.attrs.id = next;
      continue;
    }
    // Повтор: браузер берёт первый элемент с этим id, остальные недостижимы.
    if (map.has(id)) warnings.add("id повторяется — оставлен первый");
    el.attrs = without(el.attrs, "id");
    removed++;
  }

  for (const el of all) {
    for (const [name, value] of Object.entries(el.attrs)) {
      if (name === "id") continue;
      const next = renameRefs(name, value, map);
      if (next !== value) el.attrs[name] = next;
    }
  }
  return { renamed: map.size, removed, warnings: [...warnings] };
}
