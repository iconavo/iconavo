// Уникальные ID внутри рисунка (ADR-0031, ADR-0014): одна иконка может стоять на странице сколько
// угодно раз, и ссылки каждой копии ведут на её собственные маски, градиенты и обрезки. Ссылки
// ищутся как у replaceIDs Iconify, но строже: только url(#…), href="#…" и время анимации
// begin="….end" — цвет #abc и класс с тем же текстом не трогаются. Замена — за один проход, поэтому
// новый ID не перепишется повторно. Как и у Iconify, не переписываются #id внутри <style> и
// aria-labelledby.

const ID = /\sid=["']([^"']+)["']/g;
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * ID рисунка — prefix() и номер по порядку, и ссылки на них. prefix вызывается, только если ID в
 * рисунке есть; без них — тот же текст.
 */
export function replaceIds(body: string, prefix: () => string): string {
  const ids = [...new Set(Array.from(body.matchAll(ID), (m) => m[1] ?? ""))];
  if (ids.length === 0) return body;
  const base = prefix();
  const renamed = new Map(ids.map((id, i) => [id, `${base}${i}`]));
  const alt = ids.map((id) => id.replace(SPECIAL, "\\$&")).join("|");
  const refs = new RegExp(
    `(\\sid=["'])(${alt})(?=["')])|([";]\\s*)(${alt})(?=\\.[a-z])`,
    "g",
  );
  return body.replace(
    refs,
    (_, before?: string, id?: string, smil?: string, smilId?: string) =>
      before === undefined
        ? `${smil}${renamed.get(smilId ?? "")}`
        : `${before}${renamed.get(id ?? "")}`,
  );
}
