"use client";

// Передача поиска большому полю страницы поиска (шаг 3 фазы 4; редизайн): текст и фокус после перехода на
// /search. Пустую передачу дают «Поиск» верхней полосы и Ctrl K со страницы без поля — тогда большое поле
// берёт фокус само. Пока страница поиска открывается, набранное успевает сюда же.

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
