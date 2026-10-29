// pnpm release bump [версия] (ADR-0051): PR выпуска делает эта команда. Версия ставится трём пакетам и
// примерам React и Next.js, в журнал — раздел с датой и заготовкой, в README и HTML-пример — адрес
// скрипта тега с этой версией и хэш его свежей сборки. lock-файлы примеров с прошлой версией удаляются:
// новые пишет pnpm starters --lock после публикации. Без версии — только хэш и дата раздела: после
// правок кода до слияния. Сеть не нужна; вывод tsc — до запуска (pnpm release собирает его сам).

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareVersions, parseVersion } from "../sources/version.js";
import {
  CHANGELOG_FILE,
  PACKAGES,
  RELEASE_MAJOR,
  SCRIPT_LINE_FILES,
  STARTER_DIRS,
  UNRELEASED,
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
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
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

/** Записать файл, только если текст изменился; путь — в changed. */
async function update(
  root: string,
  path: string,
  change: (text: string) => string,
  changed: string[],
): Promise<void> {
  const file = join(root, path);
  const text = await readFile(file, "utf8");
  const next = change(text);
  if (next !== text) {
    await writeFile(file, next, "utf8");
    changed.push(path);
  }
}

export async function bumpRelease(o: BumpOptions): Promise<BumpReport> {
  const from = await currentVersion(o.root);
  const version = o.version ?? from;
  if (o.version !== undefined) {
    const problem = versionProblem(from, o.version);
    if (problem) throw new Error(problem);
  } else if (from === UNRELEASED) {
    throw new Error(
      "пакеты ещё не выпускались — нужна версия: pnpm release bump 0.1.0",
    );
  }
  const changed: string[] = [];
  const removed: string[] = [];

  for (const id of PACKAGES) {
    await update(
      o.root,
      `packages/${id}/package.json`,
      (text) => {
        const m = JSON.parse(text) as Manifest;
        m.version = version;
        delete m.private;
        return json(m);
      },
      changed,
    );
  }

  for (const dir of STARTER_DIRS) {
    await update(
      o.root,
      `${dir}/package.json`,
      (text) => {
        const m = JSON.parse(text) as Manifest & {
          dependencies?: Record<string, string>;
        };
        for (const name of Object.keys(m.dependencies ?? {})) {
          if (name.startsWith("@iconavo-ui/") && m.dependencies) {
            m.dependencies[name] = version;
          }
        }
        return json(m);
      },
      changed,
    );
    // lock-файл с другой версией наших пакетов устарел: npm ci с ним не поставит пример.
    const lockPath = `${dir}/package-lock.json`;
    const lock = await readFile(join(o.root, lockPath), "utf8").catch(
      () => undefined,
    );
    if (lock !== undefined) {
      const packages =
        (
          JSON.parse(lock) as {
            packages?: Record<string, { version?: string }>;
          }
        ).packages ?? {};
      const stale = Object.entries(packages).some(
        ([path, p]) =>
          path.includes("node_modules/@iconavo-ui/") && p.version !== version,
      );
      if (stale) {
        await rm(join(o.root, lockPath));
        removed.push(lockPath);
      }
    }
  }

  // Новая версия — новый раздел с заготовкой; та же — только дата, если раздел этой версии первый.
  await update(
    o.root,
    CHANGELOG_FILE,
    (text) =>
      o.version !== undefined ||
      changelogSections(text).sections[0]?.version === version
        ? addChangelogSection(text, version, o.date)
        : text,
    changed,
  );

  const integrity = sri((await (o.buildScript ?? buildScript)(o.root)).body);
  for (const path of SCRIPT_LINE_FILES) {
    await update(
      o.root,
      path,
      (text) => {
        if (scriptRefs(text).tags.length === 0) {
          throw new Error(
            `${path}: нет строки подключения скрипта тега с jsDelivr`,
          );
        }
        return setScriptRefs(text, version, integrity);
      },
      changed,
    );
  }
  return { from, version, integrity, changed, removed };
}
