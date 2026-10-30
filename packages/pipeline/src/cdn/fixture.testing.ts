// Тестовый набор в data/{id}/ для сборки раздачи: icons.json, info.json, metadata.json и changelog.json
// с выпуском текущей версии проходят схемы, версия — настоящий отпечаток. Сломанные файлы тесты пишут
// сами.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "@iconavo-ui/schema";
import { canonicalJson, type Json } from "../build/json.js";
import { versionOf } from "../changelog/state.js";

export interface CdnDemoSet {
  id: string;
  /** Имя → запись иконки как в icons.json (body обязателен). */
  icons: Record<string, { [key: string]: Json }>;
  /** Имя → запись алиаса как в icons.json (parent обязателен). */
  aliases?: Record<string, { [key: string]: Json }>;
  /** Сетка набора, по умолчанию 24. */
  grid?: number;
  /** Время последнего выпуска в секундах; null — без lastModified. */
  lastModified?: number | null;
  /** Подменить версию в info.json, чтобы она не сошлась с icons.json. */
  version?: string;
  samples?: string[];
  left?: number;
  top?: number;
  /** metadata.json: категории и карта вариантов; по умолчанию пустой. */
  metadata?: { [key: string]: Json };
  /** Прошлые версии набора в журнале — от свежих к старым, после текущей. */
  previous?: string[];
  /** Поля свежего выпуска в changelog.json: added, changed, hidden… */
  release?: { [key: string]: Json };
  /** Ревизия источника в info.json и журнале; по умолчанию 1.0.0. */
  revision?: string;
}

export const DEMO_LAST_MODIFIED = 1792490457;

/** Пишет набор и возвращает его настоящую версию. */
export async function writeCdnDemoSet(
  dataDir: string,
  set: CdnDemoSet,
): Promise<{ version: string }> {
  const dir = join(dataDir, set.id);
  await mkdir(dir, { recursive: true });
  const grid = set.grid ?? 24;
  const icons: { [key: string]: Json } = {
    prefix: set.id,
    icons: set.icons,
    width: grid,
    height: grid,
  };
  if (set.aliases) icons.aliases = set.aliases;
  if (set.left !== undefined) icons.left = set.left;
  if (set.top !== undefined) icons.top = set.top;
  const version = versionOf(icons);
  const lastModified =
    set.lastModified === undefined ? DEMO_LAST_MODIFIED : set.lastModified;
  if (lastModified !== null) icons.lastModified = lastModified;
  const total = Object.values(set.icons).filter(
    (i) => i.hidden !== true,
  ).length;
  const info: { [key: string]: Json } = {
    name: `Demo ${set.id}`,
    total,
    author: { name: "Demo" },
    license: {
      spdx: "MIT",
      text: "MIT License",
      source: "https://example.com/demo",
      revision: set.revision ?? "1.0.0",
      confirmed: true,
    },
    height: grid,
    palette: false,
    version: set.version ?? version,
  };
  if (set.samples) info.samples = set.samples;
  const metadata = set.metadata ?? {};
  const versions = [version, ...(set.previous ?? [])];
  const releases = versions.map((v, i) => {
    const release: { [key: string]: Json } = {
      version: v,
      date: `2026-10-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
      revision: set.revision ?? "1.0.0",
      total,
      ...(i === 0 ? set.release : {}),
    };
    const older = versions[i + 1];
    if (older !== undefined) release.previous = older;
    return release;
  });
  const changelog = { prefix: set.id, releases };
  const issues = [
    ...validate("icons", icons),
    ...validate("info", info),
    ...validate("metadata", metadata),
    ...validate("changelog", changelog),
  ];
  if (issues.length > 0) {
    throw new Error(
      `тестовый набор не по схеме: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`,
    );
  }
  await writeFile(join(dir, "icons.json"), canonicalJson(icons));
  await writeFile(join(dir, "info.json"), canonicalJson(info));
  await writeFile(join(dir, "metadata.json"), canonicalJson(metadata));
  await writeFile(join(dir, "changelog.json"), canonicalJson(changelog));
  return { version };
}
