const PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Имя иконки по ADR-0001: `набор:иконка`, обе части — строчные латинские буквы, цифры и одиночные дефисы. */
export function isValidIconName(name: string): boolean {
  if (typeof name !== "string") return false;
  const parts = name.split(":");
  return parts.length === 2 && parts.every((part) => PART.test(part));
}

/** Одна часть имени по ADR-0001 — набор или иконка. Не строка — нет: test(undefined) проверил бы «undefined». */
export function isValidNamePart(part: string): boolean {
  return typeof part === "string" && PART.test(part);
}
