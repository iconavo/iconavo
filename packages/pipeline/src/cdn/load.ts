// Чтение набора из data/ для раздачи (ADR-0022): icons.json и info.json по схемам, версия и дата
// последнего выпуска, проверка, что файлы от одной сборки. Читается «сырой» IconsFile, а не
// состояние журнала: записи иконок и алиасов уходят в файлы раздачи как есть, с left, top и прочими
// полями.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type IconsFile, type InfoFile, validate } from "@iconavo-ui/schema";
import type { Json } from "../build/json.js";
import { versionOf } from "../changelog/state.js";
import type { SourceConfig } from "../sources/config.js";

export interface CdnSet {
  id: string;
  name: string;
  /** Версия набора: 8 символов отпечатка icons.json без lastModified (ADR-0018). */
  version: string;
  /** Время последнего выпуска в секундах — из icons.json. */
  lastModified: number;
  file: IconsFile;
  info: InfoFile;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function issuesText(
  kind: string,
  issues: readonly { path: string; message: string }[],
) {
  return `${kind} не проходит схему: ${issues
    .slice(0, 3)
    .map((i) => `${i.path} — ${i.message}`)
    .join("; ")}`;
}

/** Имена иконок и алиасов с поворотом или отражением: статический SVG их пока не умеет. */
export function transformedNames(file: IconsFile): string[] {
  const has = (e: { rotate?: number; hFlip?: boolean; vFlip?: boolean }) =>
    (e.rotate ?? 0) !== 0 || e.hFlip === true || e.vFlip === true;
  const out: string[] = [];
  for (const [name, icon] of Object.entries(file.icons)) {
    if (has(icon)) out.push(name);
  }
  for (const [name, alias] of Object.entries(file.aliases ?? {})) {
    if (has(alias)) out.push(name);
  }
  return out.sort(order);
}

/**
 * Набор из data/{id}/: icons.json с lastModified и info.json с версией, которая сходится с
 * icons.json. Иначе — ошибка с подсказкой: файлы не от одной сборки.
 */
export async function loadCdnSet(
  config: SourceConfig,
  dataDir: string,
): Promise<CdnSet> {
  const dir = join(dataDir, config.id);
  const hint = `запустите pnpm data ${config.id}`;
  const read = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch {
      throw new Error(`${file} не читается — ${hint}`);
    }
  };
  const iconsData = await read("icons.json");
  const iconsIssues = validate("icons", iconsData);
  if (iconsIssues.length > 0) {
    throw new Error(issuesText("icons.json", iconsIssues));
  }
  const file = iconsData as IconsFile;
  if (file.prefix !== config.id) {
    throw new Error(
      `icons.json — от набора «${file.prefix}», а не «${config.id}»`,
    );
  }
  if (file.lastModified === undefined) {
    throw new Error(`в icons.json нет lastModified — ${hint}`);
  }
  const infoData = await read("info.json");
  const infoIssues = validate("info", infoData);
  if (infoIssues.length > 0) {
    throw new Error(issuesText("info.json", infoIssues));
  }
  const info = infoData as InfoFile;
  if (info.version === undefined) {
    throw new Error(`в info.json нет версии набора — ${hint}`);
  }
  const version = versionOf(iconsData as { [key: string]: Json });
  if (info.version !== version) {
    throw new Error(
      `версия в info.json (${info.version}) не от этого icons.json (${version}) — ${hint}`,
    );
  }
  const transformed = transformedNames(file);
  if (transformed.length > 0) {
    const names = transformed.slice(0, 5).join(", ");
    throw new Error(
      `повороты и отражения (rotate, hFlip, vFlip) в статике пока не поддерживаются: ${transformed.length} — ${names}${transformed.length > 5 ? "…" : ""}`,
    );
  }
  return {
    id: config.id,
    name: config.name,
    version,
    lastModified: file.lastModified,
    file,
    info,
  };
}
