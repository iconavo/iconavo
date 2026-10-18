// Ссылки между элементами одной иконки. После санитайзера их всего два вида:
// `href="#id"` и `url(#id)` в атрибутах оформления (fill, clip-path, filter…).

import type { SvgElement } from "./serialize.js";

const URL_REF = /url\(#([^)]+)\)/g;

/** Все элементы дерева в порядке файла: сам элемент, затем его дети. Без рекурсии. */
export function elements(root: SvgElement): SvgElement[] {
  const out: SvgElement[] = [];
  const stack: SvgElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as SvgElement;
    out.push(el);
    for (let i = el.children.length - 1; i >= 0; i--) {
      stack.push(el.children[i] as SvgElement);
    }
  }
  return out;
}

/** Первый элемент с каждым id: так ссылку разрешает браузер. */
export function idMap(all: readonly SvgElement[]): Map<string, SvgElement> {
  const map = new Map<string, SvgElement>();
  for (const el of all) {
    const id = el.attrs.id;
    if (id !== undefined && !map.has(id)) map.set(id, el);
  }
  return map;
}

/** ID, на которые ссылается атрибут: `href="#a"` → ["a"], `fill="url(#g) red"` → ["g"]. */
export function refsOf(name: string, value: string): string[] {
  if (name === "href") return value.startsWith("#") ? [value.slice(1)] : [];
  return [...value.matchAll(URL_REF)].map((m) => m[1] ?? "");
}

/** Значение атрибута с переименованными ссылками; ссылки на ID не из карты остаются как были. */
export function renameRefs(
  name: string,
  value: string,
  map: ReadonlyMap<string, string>,
): string {
  if (name === "href") {
    const to = value.startsWith("#") ? map.get(value.slice(1)) : undefined;
    return to === undefined ? value : `#${to}`;
  }
  return value.replace(URL_REF, (whole, id: string) => {
    const to = map.get(id);
    return to === undefined ? whole : `url(#${to})`;
  });
}
