// Поиск по документам индекса без Meilisearch — для подменного индекса тестов и локального Meilisearch
// проверки сайта (шаг 3 фазы 4). Понимает ровно те условия фильтра, что строит общий модуль поиска
// (filterConditions, exactQuery, mainQuery): set IN, palette, license IN, style =, names = и NOT names =.
// Слова — по вхождению в слова документа, без опечаток и смысла: этого хватает, чтобы проверить сайт.

/** Документ так, как его видит фильтр: поля индекса без типов. */
export type MatchDoc = Record<string, unknown>;

const has = (list: unknown, value: string) =>
  Array.isArray(list) && list.includes(value);

/** Подходит ли документ под все условия; незнакомое условие — исключение: подмена не должна молчать. */
export function matchesFilter(
  doc: MatchDoc,
  filter: readonly string[],
): boolean {
  return filter.every((f) => {
    let m = /^NOT names = "(.+)"$/.exec(f);
    if (m) return !has(doc.names, m[1] as string);
    m = /^names = "(.+)"$/.exec(f);
    if (m) return has(doc.names, m[1] as string);
    m = /^set IN \[(.+)\]$/.exec(f);
    if (m) return (m[1] as string).includes(`"${String(doc.set)}"`);
    m = /^palette = (true|false)$/.exec(f);
    if (m) return String(doc.palette) === m[1];
    m = /^license IN \[(.+)\]$/.exec(f);
    if (m) return (m[1] as string).includes(`"${String(doc.license)}"`);
    m = /^style = "(.+)"$/.exec(f);
    if (m) return has(doc.style, m[1] as string);
    throw new Error(`фильтр не понят: ${f}`);
  });
}

/** Слова документа одной строкой: имя, теги и синонимы — как поля поиска индекса. */
export const docWords = (doc: MatchDoc): string =>
  ["name", "tags", "synonymsEn", "synonymsRu"]
    .flatMap((k) => (Array.isArray(doc[k]) ? (doc[k] as string[]) : []))
    .join(" ");

/** Документы под запрос: фильтр и хотя бы одно слово запроса; пустой запрос — все под фильтр. */
export function matchDocs<T extends MatchDoc>(
  docs: Iterable<T>,
  q: string,
  filter: readonly string[],
): T[] {
  const words = q.split(" ").filter((w) => w !== "");
  return [...docs].filter(
    (d) =>
      matchesFilter(d, filter) &&
      (words.length === 0 || words.some((w) => docWords(d).includes(w))),
  );
}
