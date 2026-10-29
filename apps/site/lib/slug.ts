// Якоря заголовков как у GitHub (ADR-0050): ссылки README вида #nextjs-and-server-rendering работают и на
// GitHub, и на сайте. Строчные буквы, без знаков препинания — остаются буквы, цифры, «_» и «-», —
// пробел становится дефисом; повтор того же якоря в документе — с -1, -2.

/** Якорь заголовка по его тексту — без повторов. */
export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");

/** Якоря одного документа: повтор получает -1, -2… */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
