// Номера версий вида 1.60.0 или v0.15.0: выпуски git-источников по тегам (ADR-0012) и проверка, не
// стала ли версия пакета npm меньше закреплённой (ADR-0019).

/** Части номера: «v1.60.0» → [1, 60, 0]. Не номер (1.0.0-rc.1, @lucide/lab@1.0.0) — undefined. */
export function parseVersion(text: string): number[] | undefined {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(text);
  return match?.[1]?.split(".").map(Number);
}

/** Сравнение номеров по частям, а не как строк: 1.10.0 больше 1.9.0. Недостающие части — нули. */
export function compareVersions(
  a: readonly number[],
  b: readonly number[],
): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
