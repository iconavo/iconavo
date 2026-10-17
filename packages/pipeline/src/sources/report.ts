import type { FetchReport } from "./fetch.js";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

/** Отчёт о загрузке набора простым языком. */
export function formatReport(r: FetchReport): string {
  const lines: string[] = [];
  const head = `${r.id} (${r.name}) — ${r.sourceLabel}`;
  lines.push(head);
  lines.push(
    r.status === "downloaded"
      ? `  Скачано: ${r.svgCount} SVG и ${r.extraFiles.length} служебных файлов (${r.extraFiles.join(", ") || "нет"}), всего ${formatBytes(r.bytes)}`
      : `  Без изменений: ${r.svgCount} SVG уже в кэше, ничего не скачано`,
  );
  lines.push(
    r.pinned === "new"
      ? "  Версия: закреплена впервые и записана в sources.lock.json"
      : "  Версия: взята из sources.lock.json",
  );
  lines.push(
    `  Лицензия: ${r.license.spdx}, файл ${r.license.fileFound ? "найден" : "НЕ НАЙДЕН"}`,
  );
  if (r.missingExtraFiles.length > 0) {
    lines.push(
      `  Не найдены служебные файлы: ${r.missingExtraFiles.join(", ")}`,
    );
  }
  const n = r.names;
  lines.push(
    `  Имена: ${n.valid} из ${n.total} по правилу, нарушений ${n.invalid.length}, конфликтов ${n.conflicts.length}`,
  );
  for (const bad of n.invalid.slice(0, 10)) {
    lines.push(`    нарушение: ${bad.file} → «${bad.name}»`);
  }
  for (const c of n.conflicts.slice(0, 10)) {
    lines.push(`    конфликт «${c.name}»: ${c.files.join(", ")}`);
  }
  lines.push(`  Папка: ${r.dir}`);
  return lines.join("\n");
}
