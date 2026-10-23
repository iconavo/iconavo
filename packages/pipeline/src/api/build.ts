// Сборка функции edge API (ADR-0024): rolldown собирает apps/api в один ES-модуль для Workers.
// Метка сборки — первые 8 знаков SHA-256 бандла с заглушкой: тот же код — та же метка, и по
// заголовку X-Iconavo-Build видно, какая сборка отвечает. Рядом — тело части metadata запроса
// загрузки в Cloudflare и build.json. Без изменений ничего не перезаписывается: повторная сборка
// даёт те же байты. rolldown уже стоит в lock-файле (его ставят Vitest и size-limit) и грузится
// только здесь.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalJson, type Json } from "../build/json.js";
import { writeIfChanged } from "../cdn/write.js";
import {
  BUILD_FILE,
  BUILD_ID_LENGTH,
  BUILD_PLACEHOLDER,
  COMPATIBILITY_DATE,
  METADATA_FILE,
  R2_BINDING,
  WORKER_BUCKET,
  WORKER_ENTRY,
  WORKER_FILE,
  WORKER_TSCONFIG,
} from "./config.js";

export interface ApiBuildReport {
  build: string;
  bytes: number;
  gzipBytes: number;
  /** Записанные файлы; пусто — без изменений. */
  written: string[];
}

export interface ApiBuildOptions {
  root: string;
  outDir: string;
}

/**
 * metadata загрузки функции: модуль, дата совместимости, привязка бакета раздачи. Журналы — только
 * наши сообщения об ошибках, без журнала запросов с IP (ADR-0028).
 */
export function workerMetadata(): Json {
  return {
    main_module: WORKER_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "r2_bucket", name: R2_BINDING, bucket_name: WORKER_BUCKET },
    ],
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: false },
    },
  };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Импорты, которых в бандле Workers быть не должно: всё внутри одного файла. */
const IMPORT = /^\s*import[\s{*"']|\bimport\(|\brequire\(/m;

/** Бандл с заглушкой метки — чистая функция исходников. */
export async function bundleWorker(root: string): Promise<string> {
  const { build } = await import("rolldown");
  const warnings: string[] = [];
  const result = await build({
    input: join(root, WORKER_ENTRY),
    cwd: root,
    platform: "neutral",
    tsconfig: join(root, WORKER_TSCONFIG),
    resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
    write: false,
    onLog: (level, log) => {
      if (level === "warn") warnings.push(log.message);
    },
    output: { format: "esm" },
  });
  if (warnings.length > 0) {
    throw new Error(
      `сборка функции с предупреждениями: ${warnings.join("; ")}`,
    );
  }
  const [chunk, ...rest] = result.output;
  if (rest.length > 0 || chunk.type !== "chunk") {
    throw new Error("сборка функции дала не один файл");
  }
  if (IMPORT.test(chunk.code)) {
    throw new Error("в бандле функции остался импорт: всё должно быть внутри");
  }
  return chunk.code;
}

/** Метка сборки вместо заглушки — ровно одно вхождение. */
export function stampBuild(code: string): { build: string; code: string } {
  const parts = code.split(BUILD_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(
      `метка сборки ${BUILD_PLACEHOLDER} встречается ${parts.length - 1} раз вместо одного`,
    );
  }
  const build = sha256(code).slice(0, BUILD_ID_LENGTH);
  return { build, code: parts.join(build) };
}

export async function buildApi(
  options: ApiBuildOptions,
): Promise<ApiBuildReport> {
  const stamped = stampBuild(await bundleWorker(options.root));
  const bytes = Buffer.byteLength(stamped.code, "utf8");
  const gzipBytes = gzipSync(stamped.code).length;
  await mkdir(options.outDir, { recursive: true });
  const files: [string, string][] = [
    [WORKER_FILE, stamped.code],
    [METADATA_FILE, canonicalJson(workerMetadata())],
    [
      BUILD_FILE,
      canonicalJson({
        build: stamped.build,
        bytes,
        gzipBytes,
        sha256: sha256(stamped.code),
      }),
    ],
  ];
  const written: string[] = [];
  for (const [name, text] of files) {
    if (await writeIfChanged(join(options.outDir, name), text)) {
      written.push(name);
    }
  }
  return { build: stamped.build, bytes, gzipBytes, written };
}
