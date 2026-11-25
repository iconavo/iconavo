// Событие storage — изменение localStorage в другой вкладке. Его ключ — изменённый ключ, а у
// localStorage.clear() — null: очистка всего хранилища касается каждого ключа (ревизия фазы 5, С-28).

/** Касается ли изменение в другой вкладке этого ключа: свой ключ или очистка всего хранилища. */
export const touchesKey = (changed: string | null, key: string): boolean =>
  changed === null || changed === key;
