"use client";

// Передача поиска из поля шапки большому полю страницы поиска (шаг 3 фазы 4, решение владельца: поле
// шапки ищет по мере ввода). Поле шапки на /search скрыто, поэтому после перехода набранный текст и
// фокус подхватывает большое поле. Пока страница поиска открывается, человек может допечатать ещё
// пару букв в поле шапки — они тоже здесь.

/** Сколько живёт переданный текст: дольше — это уже не продолжение набора, а старый переход. */
const FRESH_MS = 5000;

let pending: { value: string; at: number } | undefined;

/** Поле шапки: текст, с которым открывается страница поиска. */
export function handOff(value: string): void {
  pending = { value, at: Date.now() };
}

/** Большое поле: забрать переданный текст, если он свежий; второй раз — уже ничего. */
export function takeHandoff(): string | undefined {
  const got = pending;
  pending = undefined;
  return got !== undefined && Date.now() - got.at < FRESH_MS
    ? got.value
    : undefined;
}
