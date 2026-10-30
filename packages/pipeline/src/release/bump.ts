// pnpm release bump [версия] (ADR-0051): PR выпуска делает эта команда. Версия ставится трём пакетам и
// примерам React и Next.js, в журнал — раздел с датой и заготовкой, в README и HTML-пример — адрес
// скрипта тега с этой версией и хэш его свежей сборки. lock-файлы примеров с прошлой версией удаляются:
// новые пишет pnpm starters --lock после публикации. Без версии — только хэш и дата раздела: после
// правок кода до слияния, пока версия не вышла. Реестр npm только читается: вышла ли нынешняя версия.
// Сначала — сборка скрипта и все проверки, потом запись: сбой не оставляет выпуск наполовину. Вывод
// tsc — до запуска (pnpm release собирает его сам).

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type RegistryClient, registryClient } from "../npm/registry.js";
import { compareVersions, parseVersion } from "../sources/version.js";
import {
  CHANGELOG_FILE,
  PACKAGES,
  packageName,
  RELEASE_MAJOR,
  SCRIPT_LINE_FILES,
  STARTER_DIRS,
  UNRELEASED,
  VERSION_FORMAT,
} from "./config.js";
import type { Manifest } from "./manifest.js";
import { buildScript, type ScriptBuild } from "./prepare.js";
import {
  addChangelogSection,
  changelogSections,
  scriptRefs,
  setScriptRefs,
  sri,
} from "./text.js";

export interface BumpOptions {
  root: string;
  /** Новая версия; нет — та же: обновить хэш и дату. */
  version?: string;
  /** Дата раздела журнала, ГГГГ-ММ-ДД. */
  date: string;
  /** Реестр npm — только чтение; в тестах свой. */
  registry?: RegistryClient;
  /** Сборка скрипта тега — в тестах своя: без tsc и rolldown. */
  buildScript?: (root: string) => Promise<ScriptBuild>;
}

export interface BumpReport {
  from: string;
  version: string;
  integrity: string;
  /** Изменённые и удалённые файлы — пути от корня. */
  changed: string[];
  removed: string[];
}

const json = (m: Manifest) => `${JSON.stringify(m, null, 2)}\n`;

/** Текущая версия трёх пакетов; разные — ошибка: пакеты выходят вместе (ADR-0029). */
export async function currentVersion(root: string): Promise<string> {
  const versions = new Set<string>();
  for (const id of PACKAGES) {
    const m = JSON.parse(
      await readFile(join(root, "packages", id, "package.json"), "utf8"),
    ) as Manifest;
    versions.add(String(m.version));
  }
  if (versions.size !== 1) {
    throw new Error(
      `у пакетов разные версии: ${[...versions].join(", ")} — три пакета выходят одной версией (ADR-0029)`,
    );
  }
  return [...versions][0] as string;
}

/** Новая версия годится: X.Y.Z, до запуска — 0.x, выше нынешней. */
export function versionProblem(
  from: string,
  version: string,
): string | undefined {
  if (!VERSION_FORMAT.test(version)) {
    return `версия «${version}» — нужен вид X.Y.Z`;
  }
  const [major] = parseVersion(version) ?? [];
  if (major !== RELEASE_MAJOR) {
    return `до запуска версии — только ${RELEASE_MAJOR}.x: 1.0 выходит в день запуска (ADR-0005)`;
  }
  if (
    compareVersions(parseVersion(version) ?? [], parseVersion(from) ?? []) <= 0
  ) {
    return `версия ${version} не выше нынешней ${from}`;
  }
  return undefined;
}

/** Вышла ли версия тега в npm, в том числе снятая: номер занят навсегда. */
async function released(
  registry: RegistryClient,
  version: string,
): Promise<boolean> {
  const p = await registry.packument(packageName("icon"));
  return p !== undefined && (p.versions.has(version) || p.times.has(version));
}

export async function bumpRelease(o: BumpOptions): Promise<BumpReport> {
  const from = await currentVersion(o.root);
  const version = o.version ?? from;
  const registry = o.registry ?? registryClient();
  if (o.version !== undefined) {
    const problem = versionProblem(from, o.version);
    if (problem) throw new Error(problem);
  } else if (from === UNRELEASED) {
    throw new Error(
      "пакеты ещё не выпускались — нужна версия: pnpm release bump 0.1.0",
    );
  }
  // Нынешняя версия уже в npm — её хэш и раздел журнала не меняются; не вышла — её раздел переходит
  // к новой версии, если выпуск передумали на другую.
  const fromReleased = from !== UNRELEASED && (await released(registry, from));
  if (o.version === undefined && fromReleased) {
    throw new Error(
      `${from} уже в npm: хэш её скрипта и раздел журнала не меняются — для правок нужна новая версия, pnpm release bump X.Y.Z`,
    );
  }

  // Сначала всё, что может упасть: сборка скрипта и чтение файлов. Записи — потом.
  const integrity = sri((await (o.buildScript ?? buildScript)(o.root)).body);
  const read = (path: string) => readFile(join(o.root, path), "utf8");
  const next = new Map<string, string>();
  const removed: string[] = [];

  for (const id of PACKAGES) {
    const path = `packages/${id}/package.json`;
    const m = JSON.parse(await read(path)) as Manifest;
    m.version = version;
    delete m.private;
    next.set(path, json(m));
  }
  for (const dir of STARTER_DIRS) {
    const path = `${dir}/package.json`;
    const m = JSON.parse(await read(path)) as Manifest & {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(m.dependencies ?? {})) {
      if (name.startsWith("@iconavo-ui/") && m.dependencies) {
        m.dependencies[name] = version;
      }
    }
    next.set(path, json(m));
    // lock-файл с другой версией наших пакетов устарел: npm ci с ним не поставит пример.
    const lockPath = `${dir}/package-lock.json`;
    const lock = await read(lockPath).catch(() => undefined);
    if (lock !== undefined) {
      const packages =
        (
          JSON.parse(lock) as {
            packages?: Record<string, { version?: string }>;
          }
        ).packages ?? {};
      if (
        Object.entries(packages).some(
          ([p, entry]) =>
            p.includes("node_modules/@iconavo-ui/") &&
            entry.version !== version,
        )
      ) {
        removed.push(lockPath);
      }
    }
  }
  // Новая версия — новый раздел с заготовкой, а невышедший раздел прошлой попытки переходит к ней;
  // та же — только дата, если раздел этой версии первый.
  const changelog = await read(CHANGELOG_FILE);
  next.set(
    CHANGELOG_FILE,
    o.version !== undefined ||
      changelogSections(changelog).sections[0]?.version === version
      ? addChangelogSection(
          changelog,
          version,
          o.date,
          fromReleased ? undefined : from,
        )
      : changelog,
  );
  for (const path of SCRIPT_LINE_FILES) {
    const text = await read(path);
    if (scriptRefs(text).tags.length === 0) {
      throw new Error(
        `${path}: нет строки подключения скрипта тега с jsDelivr`,
      );
    }
    next.set(path, setScriptRefs(text, version, integrity));
  }

  const changed: string[] = [];
  for (const [path, text] of next) {
    if ((await read(path)) === text) continue;
    await writeFile(join(o.root, path), text, "utf8");
    changed.push(path);
  }
  for (const path of removed) await rm(join(o.root, path));
  return { from, version, integrity, changed, removed };
}
