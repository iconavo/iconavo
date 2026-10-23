// Команда pnpm packages prepare (шаг 5 фазы 2, ADR-0026): из data/ — папки пакетов dist-npm/{набор}/
// с решёнными версиями и план для CI dist-npm/plan.json. Реестр npm только читается, ключи не нужны;
// публикует сам npm в задаче «Публикация» workflow. Без изменений ничего не перезаписывается.
// Хоть один набор остановлен — плана нет: CI не публикует ничего, как раздача без манифеста.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renameRetrying } from "../build/write.js";
import { writeIfChanged } from "../cdn/write.js";
import type { SourceConfig } from "../sources/config.js";
import {
  NPM_FIRST_VERSION,
  NPM_FORMAT_MAJOR,
  NPM_PLAN_FILE,
  NPM_TAG,
  npmPackageName,
} from "./config.js";
import { compareNames, firstLook, type NpmAction } from "./decide.js";
import { buildPackage, type NpmFile, packageJsonOf } from "./files.js";
import { loadNpmSet, namesOf } from "./load.js";
import type { RegistryClient } from "./registry.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Действия, после которых пакет публикуется. */
export const PUBLISH_ACTIONS: ReadonlySet<NpmAction> = new Set([
  "new",
  "major",
  "minor",
  "patch",
]);

export interface NpmPackageReport {
  id: string;
  /** Имя пакета: @iconavo-ui/icons-{набор}. */
  name: string;
  setName: string;
  setVersion?: string;
  action?: NpmAction;
  /** Версия в папке пакета: новая или та, что уже в npm. */
  version?: string;
  /** Версия под тегом в npm, от которой считали. */
  base?: string;
  /** Новые имена по сравнению с опубликованной версией. */
  added: string[];
  icons: number;
  aliases: number;
  hidden: number;
  fingerprint?: string;
  files: { path: string; bytes: number }[];
  packageJson?: string;
  readme?: string;
  /** Папка пакета переписана; false — на диске уже то же самое. */
  written: boolean;
  stop: string[];
}

export interface NpmPrepareReport {
  tag: string;
  packages: NpmPackageReport[];
  planWritten: boolean;
  /** Что убрано из папки пакетов как лишнее. */
  removed: string[];
}

export interface NpmPlanEntry {
  id: string;
  name: string;
  action: NpmAction;
  version: string;
  base: string | null;
  publish: boolean;
  /** Файлы пакета, как их упакует npm: проверка в CI сравнивает с npm pack --dry-run. */
  files: string[];
}

export interface NpmPlan {
  tag: string;
  packages: NpmPlanEntry[];
}

export interface PrepareOptions {
  dataDir: string;
  outDir: string;
  registry: RegistryClient;
  /** Новый пакет можно выпустить (ручной запуск с «первой публикацией»). */
  allowNew?: boolean;
  /** Новая патч-версия даже без изменений. */
  force?: boolean;
  /** Все наборы реестра: их папки не считаются лишними, даже если выбраны не все. */
  keep?: readonly string[];
  tag?: string;
  firstVersion?: string;
  formatMajor?: number;
  log?: (line: string) => void;
}

export const prepareStop = (r: NpmPrepareReport) =>
  r.packages.some((p) => p.stop.length > 0);

/** Папка пакета на диске та же: те же файлы с теми же байтами. */
async function sameDir(
  dir: string,
  files: readonly NpmFile[],
): Promise<boolean> {
  let entries: string[];
  try {
    entries = (await readdir(dir)).sort(order);
  } catch {
    return false;
  }
  const paths = files.map((f) => f.path).sort(order);
  if (entries.join("\0") !== paths.join("\0")) return false;
  for (const f of files) {
    const disk = await readFile(join(dir, f.path));
    if (!disk.equals(Buffer.from(f.data))) return false;
  }
  return true;
}

/** Пишет папку пакета целиком: временная папка рядом → подмена старой. */
async function writePackageDir(
  outDir: string,
  id: string,
  files: readonly NpmFile[],
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const tmp = join(outDir, `.tmp-${id}-${randomBytes(6).toString("hex")}`);
  await mkdir(tmp);
  try {
    for (const f of files) await writeFile(join(tmp, f.path), f.data);
    const target = join(outDir, id);
    await rm(target, { recursive: true, force: true });
    await renameRetrying(tmp, target);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** Убирает из папки пакетов всё, кроме папок наборов и плана: забытые временные папки, старые наборы. */
async function cleanup(
  outDir: string,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await readdir(outDir)).sort(order);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (entry === NPM_PLAN_FILE || keep.has(entry)) continue;
    await rm(join(outDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

/** Готовит пакеты выбранных наборов: файлы, версия по реестру, папка на диске; затем план. */
export async function preparePackages(
  configs: readonly SourceConfig[],
  options: PrepareOptions,
): Promise<NpmPrepareReport> {
  const log = options.log ?? (() => {});
  const tag = options.tag ?? NPM_TAG;
  const formatMajor = options.formatMajor ?? NPM_FORMAT_MAJOR;
  const packages: NpmPackageReport[] = [];
  const plan: NpmPlanEntry[] = [];
  for (const config of configs) {
    const r: NpmPackageReport = {
      id: config.id,
      name: npmPackageName(config.id),
      setName: config.name,
      added: [],
      icons: 0,
      aliases: 0,
      hidden: 0,
      files: [],
      written: false,
      stop: [],
    };
    packages.push(r);
    try {
      const set = await loadNpmSet(config, options.dataDir);
      const pkg = buildPackage(set, tag);
      r.name = pkg.name;
      r.setName = set.info.name;
      r.setVersion = set.version;
      r.fingerprint = pkg.fingerprint;
      r.icons = Object.keys(set.file.icons).length;
      r.aliases = Object.keys(set.file.aliases ?? {}).length;
      r.hidden = Object.values(set.file.icons).filter(
        (i) => i.hidden === true,
      ).length;
      const look = firstLook({
        packument: await options.registry.packument(pkg.name),
        fingerprint: pkg.fingerprint,
        tag,
        allowNew: options.allowNew === true,
        force: options.force === true,
        firstVersion: options.firstVersion ?? NPM_FIRST_VERSION,
        formatMajor,
        releases: set.releases,
      });
      if (look.kind === "stop") throw new Error(look.message);
      let action: NpmAction;
      let version: string;
      if (look.kind === "decided") {
        action = look.action;
        version = look.version;
        r.base = look.base;
      } else {
        r.base = look.base.version;
        log(
          `${pkg.name}: сравниваю имена с опубликованной версией ${look.base.version}…`,
        );
        const published = await options.registry.files(look.base);
        const icons = published.get("icons.json");
        if (icons === undefined) {
          throw new Error(
            `в опубликованной версии ${look.base.version} нет icons.json`,
          );
        }
        const decision = compareNames({
          base: look.base,
          highest: look.highest,
          publishedNames: namesOf(
            JSON.parse(Buffer.from(icons).toString("utf8")) as {
              icons: Record<string, unknown>;
              aliases?: Record<string, unknown>;
            },
          ),
          names: namesOf(set.file),
          formatMajor,
        });
        if (decision.kind === "stop") throw new Error(decision.message);
        action = decision.action;
        version = decision.version;
        r.added = decision.added;
      }
      r.action = action;
      r.version = version;
      const manifest = packageJsonOf(set, tag, pkg, version);
      const files = [...pkg.files, manifest].sort((a, b) =>
        order(a.path, b.path),
      );
      r.files = files.map((f) => ({ path: f.path, bytes: f.data.byteLength }));
      r.packageJson = Buffer.from(manifest.data).toString("utf8");
      r.readme = Buffer.from(
        pkg.files.find((f) => f.path === "README.md")?.data ?? new Uint8Array(),
      ).toString("utf8");
      const dir = join(options.outDir, set.id);
      if (!(await sameDir(dir, files))) {
        await writePackageDir(options.outDir, set.id, files);
        r.written = true;
      }
      plan.push({
        id: set.id,
        name: pkg.name,
        action,
        version,
        base: r.base ?? null,
        publish: PUBLISH_ACTIONS.has(action),
        files: files.map((f) => f.path),
      });
    } catch (e) {
      r.stop.push((e as Error).message);
    }
  }
  const report: NpmPrepareReport = {
    tag,
    packages,
    planWritten: false,
    removed: [],
  };
  const planPath = join(options.outDir, NPM_PLAN_FILE);
  if (prepareStop(report)) {
    // Старый план не должен уехать в CI вместо этого запуска.
    await rm(planPath, { force: true });
    return report;
  }
  const text = `${JSON.stringify({ tag, packages: plan } satisfies NpmPlan, null, 2)}\n`;
  await mkdir(options.outDir, { recursive: true });
  report.planWritten = await writeIfChanged(planPath, text);
  report.removed = await cleanup(
    options.outDir,
    new Set(options.keep ?? configs.map((c) => c.id)),
  );
  return report;
}
