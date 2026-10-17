const PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Имя иконки по ADR-0001: `набор:иконка`, обе части — строчные латинские буквы, цифры и одиночные дефисы. */
export function isValidIconName(name: string): boolean {
  const parts = name.split(":");
  return parts.length === 2 && parts.every((part) => PART.test(part));
}
