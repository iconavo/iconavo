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
 * собирается здесь, аргумент с пробелом — в кавычках (shell: true с массивом аргументов Node считает
 * небезопасным, DEP0190).
 */
export function commandLine(
  command: string,
  args: string[],
): { file: string; args: string[]; verbatim: boolean } {
  if (process.platform !== "win32")
    return { file: command, args, verbatim: false };
  const quoted = [command, ...args].map((a) =>
    /[\s"]/.test(a) ? `"${a}"` : a,
  );
  return {
    file: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${quoted.join(" ")}"`],
    verbatim: true,
  };
}

/** Запуск команды; код не 0 — ошибка с последними строками вывода. */
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
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    child.once("error", reject);
    child.once("exit", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) resolve(output);
      else {
        const tail = output.trim().split(/\r?\n/).slice(-20).join("\n");
        reject(new Error(`${command} ${args.join(" ")}: код ${code}\n${tail}`));
      }
    });
  });
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
  const manifest = JSON.parse(
    (contents.get("package.json") as Buffer).toString("utf8"),
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
    const info = JSON.parse(output.slice(output.indexOf("{"))) as {
      name: string;
      version: string;
      filename: string;
    };
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
