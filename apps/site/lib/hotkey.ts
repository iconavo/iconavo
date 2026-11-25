// Ctrl K (на Mac — ⌘K) — фокус в поле поиска или переход на страницу поиска (components/shell/HotKey.tsx).

/** То, что сочетанию нужно от события клавиатуры. */
export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * Ctrl K или ⌘K без Alt и Shift. Клавиша — по месту (code: KeyK): в русской раскладке key у неё «л»
 * (ревизия фазы 5, С-2); и по букве (key: k) — в раскладках, где K стоит на другом месте.
 */
export const isSearchHotKey = (e: KeyLike): boolean =>
  (e.ctrlKey || e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  (e.code === "KeyK" || e.key.toLowerCase() === "k");
