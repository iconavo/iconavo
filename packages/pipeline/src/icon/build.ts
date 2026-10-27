// Скрипт тега для страниц без сборщика (ADR-0032, ADR-0034): rolldown собирает вход dist/script.js
// пакета @iconavo-ui/icon вместе с ядром в один сжатый ES-модуль без импортов — dist/iconavo-icon.js,
// имя из README. Его подключают с jsDelivr по точной версии, а configure, addIcons, setLoader и
// loadIcons импортируют из того же адреса. Без изменений файл не перезаписывается: повторная сборка
// даёт те же байты. Бюджет — 7 КБ в gzip, сумма бюджетов ядра и тега; его проверяет size-limit.

import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { IMPORT } from "../api/build.js";
import { writeIfChanged } from "../cdn/write.js";

/** Вход — вывод tsc пакета тега для страниц без сборщика (pnpm typecheck). */
export const SCRIPT_ENTRY = "packages/icon/dist/script.js";

/** Скрипт — рядом с выводом tsc, по адресу из README. */
export const SCRIPT_FILE = "packages/icon/dist/iconavo-icon.js";

export interface IconBuildReport {
  bytes: number;
  gzipBytes: number;
  /** Файл записан; false — на диске те же байты. */
  written: boolean;
}

/** Сжатый ES-модуль с ядром внутри — чистая функция вывода tsc. */
export async function bundleIconScript(root: string): Promise<string> {
  const { build } = await import("rolldown");
  const warnings: string[] = [];
  const result = await build({
    input: join(root, SCRIPT_ENTRY),
    cwd: root,
    platform: "browser",
    write: false,
    onLog: (level, log) => {
      if (level === "warn") warnings.push(log.message);
    },
    output: { format: "esm", minify: true },
  });
  if (warnings.length > 0) {
    throw new Error(
      `сборка скрипта тега с предупреждениями: ${warnings.join("; ")}`,
    );
  }
  const [chunk, ...rest] = result.output;
  if (rest.length > 0 || chunk.type !== "chunk") {
    throw new Error("сборка скрипта тега дала не один файл");
  }
  if (IMPORT.test(chunk.code)) {
    throw new Error(
      "в скрипте тега остался импорт: ядро должно быть внутри — запустите pnpm typecheck",
    );
  }
  return chunk.code;
}

/** Скрипт на диск — по умолчанию в dist пакета тега. */
export async function buildIconScript(
  root: string,
  outFile = join(root, SCRIPT_FILE),
): Promise<IconBuildReport> {
  const code = await bundleIconScript(root);
  return {
    bytes: Buffer.byteLength(code, "utf8"),
    gzipBytes: gzipSync(code).length,
    written: await writeIfChanged(outFile, code),
  };
}
