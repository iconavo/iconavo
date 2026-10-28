// Таблица для терминала: ширина колонки — по самой длинной ячейке, первые left колонок выровнены
// по левому краю, остальные (числа) — по правому.

export function textTable(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  left = 1,
): string {
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) =>
        i < left ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

/** Та же таблица в Markdown — для сводки запуска CI; «|» и переводы строк в ячейках не ломают её. */
export function markdownTable(
  head: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ")).join(" | ")} |`;
  return [
    line(head),
    `|${head.map(() => " --- ").join("|")}|`,
    ...rows.map(line),
  ].join("\n");
}
