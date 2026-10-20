import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { compareVersions, parseVersion } from "./version.js";

const run = promisify(execFile);

const FULL_HASH = /^[0-9a-f]{40}$/;

async function git(
  args: string[],
  cwd?: string,
  maxBuffer = 16 * 1024 * 1024,
): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer,
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    // Подкоманда — первый аргумент, который не настройка «-c имя=значение».
    const command =
      args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ??
      args[0];
    throw new Error(`git ${command}: ${(err.stderr || err.message).trim()}`);
  }
}

/**
 * Файлы как в репозитории, без перевода строк под систему: иначе на Windows с core.autocrlf=true
 * тексты лицензий и JSON пришли бы с CRLF. Настройки — флагами команды: они сильнее и конфигов git,
 * и переменных окружения GIT_CONFIG_*.
 */
const AS_COMMITTED = ["-c", "core.autocrlf=false", "-c", "core.eol=lf"];

export function assertCommitHash(value: string): void {
  if (!FULL_HASH.test(value)) {
    throw new Error(
      `«${value}» — не хэш коммита. Нужен полный хэш (40 символов), ветка или тег не подходят`,
    );
  }
}

/**
 * Последний коммит не новее from, в котором менялся хотя бы один из файлов; пути — от корня
 * репозитория, через «/». Файлов нет в истории — undefined.
 */
export async function lastCommit(
  paths: readonly string[],
  cwd: string,
  from = "HEAD",
): Promise<string | undefined> {
  const out = (
    await git(["log", "-1", "--format=%H", from, "--", ...paths], cwd)
  ).trim();
  return out === "" ? undefined : out;
}

/**
 * С какого коммита искать прошлую версию набора (ADR-0018): общий предок HEAD и origin/main —
 * версия в main. Коммиты ветки, ещё не слитые в main, журнал не видит, поэтому все изменения ветки
 * попадают в один выпуск. Нет origin/main или общего предка (CI на PR берёт коммит слияния с
 * глубиной 1) — HEAD: тогда прошлая версия — сами закоммиченные данные.
 */
export async function baseRevision(
  cwd: string,
): Promise<{ commit: string; label: string }> {
  try {
    const commit = (
      await git(["merge-base", "HEAD", "origin/main"], cwd)
    ).trim();
    assertCommitHash(commit);
    return { commit, label: `версия в main (коммит ${commit.slice(0, 7)})` };
  } catch {
    const commit = (await git(["rev-parse", "HEAD"], cwd)).trim();
    assertCommitHash(commit);
    return {
      commit,
      label: `HEAD (коммит ${commit.slice(0, 7)}): origin/main не найден`,
    };
  }
}

/**
 * Файл в коммите как есть, без перевода строк под систему; в коммите его нет — undefined.
 * Буфер с запасом: icons.json Material Symbols весит больше 9 МБ.
 */
export async function gitShow(
  commit: string,
  path: string,
  cwd: string,
): Promise<string | undefined> {
  assertCommitHash(commit);
  try {
    return await git(["show", `${commit}:${path}`], cwd, 256 * 1024 * 1024);
  } catch (e) {
    if (
      /does not exist|exists on disk, but not in/.test((e as Error).message)
    ) {
      return undefined;
    }
    throw e;
  }
}

/** Коммит, на который сейчас указывает HEAD удалённого репозитория. */
export async function resolveGitHead(repo: string): Promise<string> {
  const out = await git(["ls-remote", repo, "HEAD"]);
  const hash = out.split(/\s/)[0] ?? "";
  assertCommitHash(hash);
  return hash;
}

/** Тег удалённого репозитория и коммит, на который он указывает. */
export interface RemoteTag {
  name: string;
  commit: string;
}

/**
 * Теги из вывода `git ls-remote --tags`. У аннотированного тега две строки: объект тега и `^{}` —
 * сам коммит; берётся коммит.
 */
export function parseRemoteTags(output: string): RemoteTag[] {
  const tags = new Map<string, string>();
  const peeled = new Set<string>();
  for (const line of output.split("\n")) {
    const [hash, ref] = line.trim().split(/\s+/);
    if (!hash || !ref?.startsWith("refs/tags/")) continue;
    const name = ref.slice("refs/tags/".length);
    if (name.endsWith("^{}")) {
      tags.set(name.slice(0, -3), hash);
      peeled.add(name.slice(0, -3));
    } else if (!peeled.has(name)) {
      tags.set(name, hash);
    }
  }
  return [...tags].map(([name, commit]) => ({ name, commit }));
}

/** Тег выпуска — номер из трёх частей: 1.60.0 или v0.15.0. Не выпуск: 1.0.0-rc.1, @lucide/lab@1.0.0. */
export const isReleaseTag = (name: string) => /^v?\d+\.\d+\.\d+$/.test(name);

/** Теги выпусков от свежих к старым; при равных номерах (v1.0.0 и 1.0.0) — по имени. */
function releases(tags: readonly RemoteTag[]): RemoteTag[] {
  return tags
    .filter((t) => isReleaseTag(t.name))
    .map((t) => ({ tag: t, version: parseVersion(t.name) ?? [] }))
    .sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        (a.tag.name < b.tag.name ? -1 : a.tag.name > b.tag.name ? 1 : 0),
    )
    .map((t) => t.tag);
}

/** Самый свежий выпуск: номера сравниваются по частям, 1.10.0 свежее 1.9.0. */
export const latestReleaseTag = (
  tags: readonly RemoteTag[],
): RemoteTag | undefined => releases(tags)[0];

/** Коммит → тег выпуска на нём (самый свежий, если их несколько): имена версий в PR робота. */
export function releaseTagsByCommit(
  tags: readonly RemoteTag[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of releases(tags)) {
    if (!out.has(t.commit)) out.set(t.commit, t.name);
  }
  return out;
}

/** Все теги удалённого репозитория. */
export async function remoteTags(repo: string): Promise<RemoteTag[]> {
  return parseRemoteTags(await git(["ls-remote", "--tags", repo]));
}

/** Самый свежий выпуск удалённого репозитория (latest: "tag" в конфиге набора, ADR-0012). */
export async function resolveGitTag(repo: string): Promise<RemoteTag> {
  const latest = latestReleaseTag(await remoteTags(repo));
  if (!latest) {
    throw new Error(
      `в ${repo} нет тегов выпусков вида 1.2.3: уберите latest: "tag" из конфига набора или закрепите коммит вручную`,
    );
  }
  assertCommitHash(latest.commit);
  return latest;
}

async function* walk(
  dir: string,
  wanted: (path: string) => boolean,
  rel = "",
): AsyncGenerator<string> {
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      if (wanted(path)) {
        throw new Error(`«${path}» — ссылка, ссылки не поддерживаются`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      yield* walk(dir, wanted, path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

export interface GitCopyOptions {
  dest: string;
  wanted: (path: string) => boolean;
}

/**
 * Забирает ровно указанный коммит (`fetch --depth 1`) и копирует нужные файлы в dest.
 * Возвращает список скопированных файлов.
 */
export async function fetchGit(
  repo: string,
  commit: string,
  options: GitCopyOptions,
): Promise<{ files: { path: string; size: number }[]; bytes: number }> {
  assertCommitHash(commit);
  const work = await mkdtemp(join(tmpdir(), "iconavo-git-"));
  try {
    await git(["init", "-q"], work);
    await git(["fetch", "-q", "--depth", "1", repo, commit], work);
    await git(
      [...AS_COMMITTED, "checkout", "-q", "--detach", "FETCH_HEAD"],
      work,
    );
    const files: { path: string; size: number }[] = [];
    let bytes = 0;
    for await (const path of walk(work, options.wanted)) {
      if (!options.wanted(path)) continue;
      const from = join(work, path);
      const to = join(options.dest, path);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      const { size } = await lstat(to);
      files.push({ path, size });
      bytes += size;
    }
    return { files, bytes };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
