import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

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
    throw new Error(`git ${args[0]}: ${(err.stderr || err.message).trim()}`);
  }
}

export function assertCommitHash(value: string): void {
  if (!FULL_HASH.test(value)) {
    throw new Error(
      `«${value}» — не хэш коммита. Нужен полный хэш (40 символов), ветка или тег не подходят`,
    );
  }
}

/**
 * Последний коммит, в котором менялся файл; путь — от корня репозитория, через «/». Файла нет
 * в истории — undefined.
 */
export async function lastCommit(
  path: string,
  cwd: string,
): Promise<string | undefined> {
  const out = (await git(["log", "-1", "--format=%H", "--", path], cwd)).trim();
  return out === "" ? undefined : out;
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
    await git(["checkout", "-q", "--detach", "FETCH_HEAD"], work);
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
