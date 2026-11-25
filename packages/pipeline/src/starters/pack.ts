// Архивы пакетов (ADR-0050, ADR-0051): pnpm pack собирает ядро, тег и React этой ветки — эти же архивы
// публикует workflow «Выпуск пакетов»; workspace:* в package.json архива становится точной версией.
// Состав архива проверяется по самому архиву, а не по выводу pnpm: в него должны попасть только
// package.json, README, LICENSE и сборка dist/ — ни исходников, ни тестов, ни tsconfig.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { integrityOfBytes } from "../npm/registry.js";
import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import { extractTar } from "../sources/tar.js";
import { PACKAGES, type PackageId } from "./config.js";

export interface Pack {
  id: PackageId;
  /** @iconavo-ui/{id}. */
  name: string;
  version: string;
  /** Полный путь к архиву .tgz. */
  file: string;
  bytes: number;
  sha256: string;
  /** SHA-512 архива «sha512-…»: так его запишет реестр npm (ADR-0051). */
  integrity: string;
  /** Пути файлов в архиве, без верхней папки package/. */
  files: string[];
  /** package.json из архива — так его увидит npm. */
  manifest: Record<string, unknown>;
}

/**
 * Команда для spawn. На Windows pnpm и npm — файлы .cmd, их запускает только cmd.exe: строка команды
 * собирается здесь (shell: true с массивом аргументов Node считает небезопасным, DEP0190). Аргумент с
 * пробелом или знаком cmd (& | < > ^ скобки) — в кавычках, кавычка внутри удваивается: путь вроде
 * C:\R&D\… раньше cmd резал на две команды (ревизия фазы 5, И-20).
 */
export function commandLine(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; verbatim: boolean } {
  if (platform !== "win32") return { file: command, args, verbatim: false };
  const quoted = [command, ...args].map((a) =>
    /[\s"&|<>^()]/.test(a) ? `"${a.replaceAll('"', '""')}"` : a,
  );
  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${quoted.join(" ")}"`],
    verbatim: true,
  };
}

/** Ошибка команды: в сообщении — хвост вывода, в output — стандартный вывод (npm ls --json при коде 1). */
export interface RunError extends Error {
  output: string;
}

/**
 * Запуск команды. Возвращает только стандартный вывод: JSON npm и pnpm не смешивается с предупреждениями
 * из stderr. Код не 0 — ошибка с последними строками обоих выводов, stdout — в output. Конец — по close,
 * а не по exit: exit приходит раньше, чем дочитаны каналы, и длинный вывод мог обрезаться (ревизия
 * фазы 5, А-32, И-10).
 */
export function run(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const line = commandLine(command, args);
    const child = spawn(line.file, line.args, {
      cwd,
      env: { ...process.env, ...env },
      windowsVerbatimArguments: line.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.once("error", reject);
    child.once("close", (code) => {
      const output = Buffer.concat(out).toString("utf8");
      if (code === 0) {
        resolve(output);
        return;
      }
      const both = `${output}\n${Buffer.concat(err).toString("utf8")}`;
      const tail = both.trim().split(/\r?\n/).slice(-20).join("\n");
      reject(
        Object.assign(
          new Error(`${command} ${args.join(" ")}: код ${code}\n${tail}`),
          { output },
        ),
      );
    });
  });
}

/** JSON из вывода команды: от первой «{» до последней «}»; не JSON — ошибка с началом вывода. */
export function parseJsonOutput<T>(output: string, what: string): T {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  try {
    if (start === -1 || end < start) throw new Error("нет объекта");
    return JSON.parse(output.slice(start, end + 1)) as T;
  } catch {
    throw new Error(
      `${what} вывел не JSON: ${output.trim().slice(0, 200) || "пусто"}`,
    );
  }
}

/**
 * Файлы архива, без верхней папки package/: путь → байты тех, что выбрал wanted, и пути всех. tar
 * читается потоком; выбранное — через временную папку рядом с архивом, она удаляется.
 */
export async function tarballContents(
  file: string,
  wanted: (path: string) => boolean,
): Promise<{ paths: string[]; contents: Map<string, Buffer> }> {
  const paths: string[] = [];
  const picked: string[] = [];
  const scratch = `${file}.files`;
  await rm(scratch, { recursive: true, force: true });
  try {
    await extractTar(createReadStream(file).pipe(createGunzip()), {
      dest: scratch,
      wanted: (path) => {
        paths.push(path);
        if (!wanted(path)) return false;
        picked.push(path);
        return true;
      },
    });
    const contents = new Map<string, Buffer>();
    for (const path of picked) {
      contents.set(path, await readFile(join(scratch, path)));
    }
    return { paths: paths.sort(), contents };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Пути и package.json архива. */
async function readTarball(
  file: string,
): Promise<{ files: string[]; manifest: Record<string, unknown> }> {
  const { paths, contents } = await tarballContents(
    file,
    (path) => path === "package.json",
  );
  // Нет package.json в архиве — пустой: это скажет packVerdict, а не TypeError (ревизия фазы 5, И-20).
  const raw = contents.get("package.json");
  const manifest = (
    raw === undefined ? {} : JSON.parse(raw.toString("utf8"))
  ) as Record<string, unknown>;
  return { files: paths, manifest };
}

/** pnpm pack трёх пакетов в outDir; папка пересоздаётся. Нужна сборка dist/ (tsc -b) и скрипт тега. */
export async function packPackages(
  root: string,
  outDir: string,
): Promise<Pack[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const packs: Pack[] = [];
  for (const id of PACKAGES) {
    const output = await run(
      "pnpm",
      ["pack", "--pack-destination", outDir, "--json"],
      join(root, "packages", id),
    );
    const info = parseJsonOutput<{
      name: string;
      version: string;
      filename: string;
    }>(output, `pnpm pack ${id}`);
    const bytes = await readFile(info.filename);
    packs.push({
      id,
      name: info.name,
      version: info.version,
      file: info.filename,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: integrityOfBytes(bytes),
      ...(await readTarball(info.filename)),
    });
  }
  return packs;
}

/** Что может лежать в архиве пакета. */
const ALLOWED = /^(package\.json|README\.md|LICENSE|dist\/.+)$/;
const FORBIDDEN = /(^|\/)(src\/|tsconfig[^/]*$|[^/]*\.(test|testing)\.[^/]+$)/;

/**
 * Состав архивов: только package.json, README, LICENSE и dist/; у тега — ещё и скрипт для страниц без
 * сборщика; в package.json нет workspace: — npm его не поймёт; версии трёх пакетов одинаковые.
 */
export function packVerdict(packs: Pack[]): Verdict {
  const problems: string[] = [];
  for (const pack of packs) {
    const extra = pack.files.filter(
      (f) => !ALLOWED.test(f) || FORBIDDEN.test(f),
    );
    if (extra.length > 0) {
      problems.push(
        `${pack.name}: лишнее в архиве — ${extra.slice(0, 5).join(", ")}`,
      );
    }
    if (!pack.files.includes("package.json")) {
      problems.push(`${pack.name}: нет package.json`);
    }
    if (!pack.files.some((f) => f.startsWith("dist/"))) {
      problems.push(`${pack.name}: нет сборки dist/`);
    }
    if (pack.id === "icon" && !pack.files.includes("dist/iconavo-icon.js")) {
      problems.push(
        `${pack.name}: нет скрипта dist/iconavo-icon.js — pnpm icon build`,
      );
    }
    if (JSON.stringify(pack.manifest).includes('"workspace:')) {
      problems.push(`${pack.name}: в package.json осталось workspace:`);
    }
  }
  const versions = [...new Set(packs.map((p) => p.version))];
  if (versions.length > 1) {
    problems.push(`разные версии пакетов: ${versions.join(", ")}`);
  }
  return problems.length === 0
    ? pass(
        packs
          .map(
            (p) =>
              `${p.name}@${p.version} — ${p.files.length} файлов, ${p.bytes} Б`,
          )
          .join("; "),
      )
    : fail(problems.join("; "));
}
