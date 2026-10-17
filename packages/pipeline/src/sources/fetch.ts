import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { extraFiles, type SourceConfig, wantedPath } from "./config.js";
import { assertCommitHash, fetchGit, resolveGitHead } from "./git.js";
import type { LockEntry, LockFile } from "./lock.js";
import { checkNames, type NameCheck } from "./names.js";
import { downloadAndExtract, type FetchFn, resolveNpm } from "./npm.js";

export interface FetchOptions {
  /** Корневая папка кэша, например `.cache/sources`. */
  cacheDir: string;
  fetch?: FetchFn;
}

export interface FetchReport {
  id: string;
  name: string;
  /** Например `lucide-static@1.59.0` или `https://github.com/x/y@abcdef0`. */
  sourceLabel: string;
  /** downloaded — скачано сейчас; unchanged — уже было в кэше, сеть не использовалась. */
  status: "downloaded" | "unchanged";
  /** new — версия закреплена впервые при этом запуске; lock — взята из sources.lock.json. */
  pinned: "new" | "lock";
  dir: string;
  svgCount: number;
  /** Сколько SVG имеют рядом JSON с метаданными (только если набор их хранит). */
  metadataPairs?: number;
  extraFiles: string[];
  missingExtraFiles: string[];
  bytes: number;
  license: { spdx: string; fileFound: boolean };
  names: NameCheck;
}

interface Marker {
  entry: LockEntry;
  fileCount: number;
  bytes: number;
}

const MARKER = ".fetched.json";

const key = (e: LockEntry) => (e.type === "npm" ? e.version : e.commit);

const label = (config: SourceConfig, e: LockEntry) =>
  config.source.type === "npm" && e.type === "npm"
    ? `${config.source.package}@${e.version}`
    : `${config.source.type === "git" ? config.source.repo : ""}@${key(e).slice(0, 7)}`;

/** Закрепляет версию (последнюю или указанную) без скачивания набора. */
export async function pinEntry(
  config: SourceConfig,
  requested: string | undefined,
  fetchFn: FetchFn = fetch,
): Promise<LockEntry> {
  if (config.source.type === "npm") {
    const v = await resolveNpm(
      config.source.package,
      requested ?? "latest",
      fetchFn,
    );
    return { type: "npm", version: v.version, integrity: v.integrity };
  }
  const commit = requested ?? (await resolveGitHead(config.source.repo));
  assertCommitHash(commit);
  return { type: "git", commit };
}

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, path)));
    else if (e.isFile() && path !== MARKER) out.push(path);
  }
  return out;
}

async function readMarker(dir: string): Promise<Marker | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, MARKER), "utf8")) as Marker;
  } catch {
    return undefined;
  }
}

async function isCached(dir: string, entry: LockEntry): Promise<boolean> {
  const marker = await readMarker(dir);
  if (!marker || JSON.stringify(marker.entry) !== JSON.stringify(entry))
    return false;
  try {
    return (await listFiles(dir)).length === marker.fileCount;
  } catch {
    return false;
  }
}

async function download(
  config: SourceConfig,
  entry: LockEntry,
  tmp: string,
  fetchFn: FetchFn,
): Promise<{ fileCount: number; bytes: number }> {
  const wanted = wantedPath(config);

  if (config.source.type === "npm" && entry.type === "npm") {
    // Адрес архива берём из реестра, но верим только integrity из sources.lock.json.
    const meta = await resolveNpm(
      config.source.package,
      entry.version,
      fetchFn,
    );
    if (meta.integrity !== entry.integrity) {
      throw new Error(
        `npm: integrity ${config.source.package}@${entry.version} в реестре не совпадает с sources.lock.json (пакет переопубликован?)`,
      );
    }
    const r = await downloadAndExtract(
      meta.tarball,
      entry.integrity,
      { dest: tmp, wanted },
      fetchFn,
    );
    return { fileCount: r.files.length, bytes: r.bytes };
  }
  if (config.source.type === "git" && entry.type === "git") {
    const r = await fetchGit(config.source.repo, entry.commit, {
      dest: tmp,
      wanted,
    });
    return { fileCount: r.files.length, bytes: r.bytes };
  }
  throw new Error(
    `тип источника в конфиге (${config.source.type}) не совпадает с записью в sources.lock.json (${entry.type})`,
  );
}

/**
 * Скачивает набор по записи из lock (или закрепляет последнюю версию при первом запуске)
 * и возвращает отчёт и актуальный lock. Если нужная версия уже в кэше — сеть не используется.
 */
export async function fetchSource(
  config: SourceConfig,
  lock: LockFile,
  options: FetchOptions,
): Promise<{ report: FetchReport; lock: LockFile }> {
  const fetchFn = options.fetch ?? fetch;
  let entry = lock[config.id];
  let pinned: FetchReport["pinned"] = "lock";
  if (!entry) {
    entry = await pinEntry(config, undefined, fetchFn);
    pinned = "new";
  }

  const setDir = join(options.cacheDir, config.id);
  const dir = join(setDir, key(entry));
  let status: FetchReport["status"] = "unchanged";

  if (!(await isCached(dir, entry))) {
    status = "downloaded";
    await mkdir(setDir, { recursive: true });
    const tmp = join(setDir, `.tmp-${randomBytes(6).toString("hex")}`);
    try {
      await mkdir(tmp, { recursive: true });
      const { fileCount, bytes } = await download(config, entry, tmp, fetchFn);
      const marker: Marker = { entry, fileCount, bytes };
      await writeFile(
        join(tmp, MARKER),
        JSON.stringify(marker, null, 2),
        "utf8",
      );
      await rm(dir, { recursive: true, force: true });
      await rename(tmp, dir);
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  const all = await listFiles(dir);
  const svgs = all.filter(
    (f) => f.startsWith(`${config.svgPath}/`) && f.endsWith(".svg"),
  );
  const jsonOf = (svg: string) => svg.replace(/\.svg$/, ".json");
  const metadataPairs =
    config.iconMetadata === "json"
      ? svgs.filter((f) => all.includes(jsonOf(f))).length
      : undefined;
  const extras = extraFiles(config);
  const found = extras.filter((f) => all.includes(f));
  const marker = await readMarker(dir);
  const report: FetchReport = {
    id: config.id,
    name: config.name,
    sourceLabel: label(config, entry),
    status,
    pinned,
    dir,
    svgCount: svgs.length,
    metadataPairs,
    extraFiles: found,
    missingExtraFiles: extras.filter((f) => !found.includes(f)),
    bytes: marker?.bytes ?? (await sizeOf(dir, all)),
    license: {
      spdx: config.license.spdx,
      fileFound: all.includes(config.license.file),
    },
    names: checkNames(svgs, config.naming),
  };
  return { report, lock: { ...lock, [config.id]: entry } };
}

async function sizeOf(dir: string, files: string[]): Promise<number> {
  let sum = 0;
  for (const f of files) sum += (await stat(join(dir, f))).size;
  return sum;
}
