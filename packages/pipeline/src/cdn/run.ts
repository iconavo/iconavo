// Команда pnpm cdn build (шаг 1 фазы 2, ADR-0022): из data/ — папка раздачи dist-cdn/ по схеме
// ADR-0004: v/{версия}/{набор}/{имя}.json и .svg на каждую иконку и алиас, рядом
// {набор}.checksums.json, в корне manifest.json. Версия — из info.json (ADR-0018). Сеть не
// используется. Без изменений ничего не перезаписывается; остановленный набор не трогает ни свои
// старые файлы, ни манифест.

import { join } from "node:path";
import type { SourceConfig } from "../sources/config.js";
import {
  CHECKSUMS_LIMIT,
  MANIFEST_FILE,
  TREE_LIMIT,
  VERSIONS_DIR,
  WRITE_CONCURRENCY,
} from "./config.js";
import {
  type CdnFile,
  checksumsText,
  type ManifestEntry,
  manifestText,
  resolveChain,
  setFiles,
} from "./files.js";
import { type CdnSet, loadCdnSet } from "./load.js";
import {
  cleanupStale,
  sameVersionOnDisk,
  writeIfChanged,
  writeSetVersion,
} from "./write.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface CdnExample {
  /** Путь относительно папки раздачи: v/{версия}/{набор}/{имя}.json. */
  path: string;
  text: string;
  bytes: number;
}

export type CdnStatus = "written" | "unchanged" | "stopped";

export interface SetCdnReport {
  id: string;
  name: string;
  version?: string;
  lastModified?: number;
  icons: number;
  /** Скрытых среди иконок. */
  hidden: number;
  aliases: number;
  files: number;
  /** Байт во всех файлах версии вместе с файлом сумм. */
  bytes: number;
  status: CdnStatus;
  /** Первые файлы для дерева в отчёте, пути относительно папки раздачи. */
  tree: string[];
  examples: {
    icon?: { json: CdnExample; svg: CdnExample };
    alias?: CdnExample;
  };
  /** Первые строки контрольных сумм: путь и хэш. */
  checksums: [string, string][];
  stop: string[];
}

export interface CdnReport {
  sets: SetCdnReport[];
  /** Текст манифеста; нет — сборка остановлена. */
  manifest?: string;
  manifestWritten: boolean;
  /** Что убрано из v/ как устаревшее. */
  removed: string[];
  warnings: string[];
}

export interface CdnOptions {
  dataDir: string;
  outDir: string;
  concurrency?: number;
  log?: (line: string) => void;
}

export const cdnStop = (r: CdnReport) => r.sets.some((s) => s.stop.length > 0);

/** Примеры для отчёта: иконка из витрины набора и её алиас, иначе первые по алфавиту. */
function examplesOf(
  set: CdnSet,
  files: readonly CdnFile[],
): SetCdnReport["examples"] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const base = `${VERSIONS_DIR}/${set.version}/`;
  const example = (path: string): CdnExample | undefined => {
    const f = byPath.get(path);
    if (!f) return undefined;
    return {
      path: `${base}${f.path}`,
      text: Buffer.from(f.data).toString("utf8"),
      bytes: f.data.byteLength,
    };
  };
  const iconNames = Object.keys(set.file.icons).sort(order);
  const icon =
    (set.info.samples ?? []).find((n) => Object.hasOwn(set.file.icons, n)) ??
    iconNames[0];
  const aliasNames = Object.keys(set.file.aliases ?? {}).sort(order);
  const alias =
    aliasNames.find((n) => resolveChain(set.file, n).parent === icon) ??
    aliasNames[0];
  const out: SetCdnReport["examples"] = {};
  if (icon !== undefined) {
    const json = example(`${set.id}/${icon}.json`);
    const svg = example(`${set.id}/${icon}.svg`);
    if (json && svg) out.icon = { json, svg };
  }
  if (alias !== undefined) {
    const json = example(`${set.id}/${alias}.json`);
    if (json) out.alias = json;
  }
  return out;
}

/**
 * Собирает все наборы: файлы считаются в памяти, пишутся только изменившиеся версии; затем
 * манифест и уборка устаревших версий. Хоть один набор остановлен — манифест не пишется и уборки нет.
 */
export async function buildCdn(
  configs: readonly SourceConfig[],
  options: CdnOptions,
): Promise<CdnReport> {
  const log = options.log ?? (() => {});
  const concurrency = options.concurrency ?? WRITE_CONCURRENCY;
  const sets: SetCdnReport[] = [];
  const entries: ManifestEntry[] = [];
  const keep = new Map<string, Set<string>>();
  for (const config of configs) {
    const r: SetCdnReport = {
      id: config.id,
      name: config.name,
      icons: 0,
      hidden: 0,
      aliases: 0,
      files: 0,
      bytes: 0,
      status: "stopped",
      tree: [],
      examples: {},
      checksums: [],
      stop: [],
    };
    sets.push(r);
    try {
      const set = await loadCdnSet(config, options.dataDir);
      r.version = set.version;
      r.lastModified = set.lastModified;
      r.icons = Object.keys(set.file.icons).length;
      r.hidden = Object.values(set.file.icons).filter(
        (i) => i.hidden === true,
      ).length;
      r.aliases = Object.keys(set.file.aliases ?? {}).length;
      const files = setFiles(set);
      const checksums = checksumsText(set, files);
      r.files = files.length;
      r.bytes =
        files.reduce((n, f) => n + f.data.byteLength, 0) +
        Buffer.byteLength(checksums, "utf8");
      const base = `${VERSIONS_DIR}/${set.version}/`;
      r.tree = files.slice(0, TREE_LIMIT).map((f) => `${base}${f.path}`);
      r.examples = examplesOf(set, files);
      r.checksums = [...files]
        .sort((a, b) => order(a.path, b.path))
        .slice(0, CHECKSUMS_LIMIT)
        .map((f) => [f.path, f.sha256]);
      if (
        await sameVersionOnDisk(
          options.outDir,
          set.id,
          set.version,
          checksums,
          files.length,
        )
      ) {
        r.status = "unchanged";
      } else {
        log(`${set.id}: записываю ${files.length} файлов в ${base}${set.id}/…`);
        await writeSetVersion(
          options.outDir,
          set.id,
          set.version,
          files,
          checksums,
          concurrency,
        );
        r.status = "written";
      }
      entries.push({
        id: set.id,
        version: set.version,
        lastModified: set.lastModified,
      });
      let ids = keep.get(set.version);
      if (!ids) {
        ids = new Set();
        keep.set(set.version, ids);
      }
      ids.add(set.id);
    } catch (e) {
      r.status = "stopped";
      r.stop.push((e as Error).message);
    }
  }
  const report: CdnReport = {
    sets,
    manifestWritten: false,
    removed: [],
    warnings: [],
  };
  if (cdnStop(report)) return report;
  const manifest = manifestText(entries);
  report.manifest = manifest;
  report.manifestWritten = await writeIfChanged(
    join(options.outDir, MANIFEST_FILE),
    manifest,
  );
  const { removed, warnings } = await cleanupStale(options.outDir, keep);
  report.removed = removed;
  report.warnings = warnings;
  return report;
}
