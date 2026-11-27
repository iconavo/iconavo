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
import { EVENT_RATE } from "@iconavo-ui/analytics";
import { ICON_RATE, SEARCH_RATE } from "@iconavo-ui/search";
import { canonicalJson, type Json } from "../build/json.js";
import { writeIfChanged } from "../cdn/write.js";
import { SEARCH_BUCKET } from "../meili/config.js";
import {
  ANALYTICS_BINDING,
  ANALYTICS_DATABASE_ID,
  API_SCHEDULES,
  BUILD_FILE,
  BUILD_ID_LENGTH,
  BUILD_PLACEHOLDER,
  COMPATIBILITY_DATE,
  EVENT_LIMIT_BINDING,
  EVENT_LIMIT_NAMESPACE,
  ICON_LIMIT_BINDING,
  ICON_LIMIT_NAMESPACE,
  LIMIT_BINDING,
  LIMIT_NAMESPACE,
  METADATA_FILE,
  R2_BINDING,
  SCHEDULES_FILE,
  SEARCH_BINDING,
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
 * metadata загрузки функции: модуль, дата совместимости, привязки бакета раздачи, закрытого бакета
 * поиска и лимитов частоты поиска (ADR-0049) и /icon (шаг 4 фазы 4), базы аналитики и лимита приёма
 * /event (шаг 2 фазы 5, ADR-0043). Секреты поиска сюда не пишутся: их вписывает выкладка. Журналы —
 * только наши сообщения об ошибках, без журнала запросов с IP (ADR-0028).
 */
export function workerMetadata(): Json {
  return {
    main_module: WORKER_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "r2_bucket", name: R2_BINDING, bucket_name: WORKER_BUCKET },
      { type: "r2_bucket", name: SEARCH_BINDING, bucket_name: SEARCH_BUCKET },
      {
        type: "ratelimit",
        name: LIMIT_BINDING,
        namespace_id: LIMIT_NAMESPACE,
        simple: { limit: SEARCH_RATE.limit, period: SEARCH_RATE.period },
      },
      {
        type: "ratelimit",
        name: ICON_LIMIT_BINDING,
        namespace_id: ICON_LIMIT_NAMESPACE,
        simple: { limit: ICON_RATE.limit, period: ICON_RATE.period },
      },
      { type: "d1", name: ANALYTICS_BINDING, id: ANALYTICS_DATABASE_ID },
      {
        type: "ratelimit",
        name: EVENT_LIMIT_BINDING,
        namespace_id: EVENT_LIMIT_NAMESPACE,
        simple: { limit: EVENT_RATE.limit, period: EVENT_RATE.period },
      },
    ],
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: false },
    },
  };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Импорты, которых в бандле быть не должно: всё внутри одного файла (функция и скрипт тега). */
export const IMPORT = /^\s*import[\s{*"']|\bimport\(|\brequire\(/m;

/** Что собирать: точка входа и tsconfig от корня репозитория и особенности функции. */
export interface WorkerTarget {
  entry: string;
  tsconfig: string;
  /**
   * Условия экспорта пакетов вместо обычных: `workerd` выбирает сборки под Workers (у SDK MCP — без
   * eval и модулей Node, шаг 10 фазы 4).
   */
  conditions?: readonly string[];
  /**
   * Единственный внешний импорт — модуль wasm рядом с бандлом: Workers получает его отдельной частью
   * загрузки (application/wasm) и отдаёт импорту готовый WebAssembly.Module.
   */
  wasm?: string;
  /** Модули без файла: имя импорта → код (у MCP — разделы README тега, вшитые при сборке). */
  virtual?: Readonly<Record<string, string>>;
  /**
   * Встроенные модули Node (`node:crypto`, `node:async_hooks`) — внешние: их даёт Workers с флагом
   * nodejs_compat (у сервиса аккаунтов — Better Auth, шаг 3 фазы 5). Других внешних импортов нет, а
   * динамические импорты пакетов встраиваются в тот же файл.
   */
  nodeBuiltins?: boolean;
}

/** Внешние импорты бандла с модулями Node — только они. */
export const NODE_BUILTIN = /^node:[a-z_/]+$/;

/** Функция edge API: один файл, без внешних импортов. */
export const API_TARGET: WorkerTarget = {
  entry: WORKER_ENTRY,
  tsconfig: WORKER_TSCONFIG,
};

/** Бандл с заглушкой метки — чистая функция исходников. */
export async function bundleWorker(
  root: string,
  target: WorkerTarget = API_TARGET,
): Promise<string> {
  const { build } = await import("rolldown");
  const warnings: string[] = [];
  const wasm = target.wasm;
  const result = await build({
    input: join(root, target.entry),
    cwd: root,
    platform: "neutral",
    tsconfig: join(root, target.tsconfig),
    resolve: {
      extensionAlias: { ".js": [".ts", ".js"] },
      ...(target.conditions ? { conditionNames: [...target.conditions] } : {}),
    },
    ...(target.nodeBuiltins ? { external: [/^node:/] } : {}),
    ...(wasm === undefined && target.virtual === undefined
      ? {}
      : {
          plugins: [
            {
              name: "iconavo-worker-modules",
              resolveId: (source: string) =>
                source === wasm
                  ? { id: source, external: true }
                  : target.virtual !== undefined &&
                      Object.hasOwn(target.virtual, source)
                    ? `\0${source}`
                    : null,
              load: (id: string) =>
                id.startsWith("\0") && target.virtual !== undefined
                  ? (target.virtual[id.slice(1)] ?? null)
                  : null,
            },
          ],
        }),
    write: false,
    onLog: (level, log) => {
      if (level === "warn") warnings.push(log.message);
    },
    output: {
      format: "esm",
      ...(target.nodeBuiltins ? { codeSplitting: false } : {}),
    },
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
  if (target.nodeBuiltins) {
    // Внешние — только модули Node; остальное внутри одного файла. Встроенный динамический импорт
    // rolldown записывает ссылкой на сам бандл — это не внешний файл.
    const foreign = [...chunk.imports, ...chunk.dynamicImports].filter(
      (spec) => !NODE_BUILTIN.test(spec) && spec !== chunk.fileName,
    );
    if (foreign.length > 0) {
      throw new Error(
        `в бандле функции импорты ${JSON.stringify(foreign)}: внешними могут быть только модули node:`,
      );
    }
  } else if (wasm === undefined) {
    if (IMPORT.test(chunk.code)) {
      throw new Error(
        "в бандле функции остался импорт: всё должно быть внутри",
      );
    }
  } else {
    // Ровно один внешний импорт — модуль wasm; динамических импортов нет.
    const imports = [...chunk.imports, ...chunk.dynamicImports];
    if (imports.length !== 1 || imports[0] !== wasm) {
      throw new Error(
        `в бандле функции импорты ${JSON.stringify(imports)} вместо одного ${wasm}`,
      );
    }
  }
  return chunk.code;
}

/**
 * Метка сборки вместо заглушки — ровно одно вхождение. salt — то, что меняет выкладку помимо кода:
 * у MCP — модуль wasm и metadata, у API — metadata и расписание (шаг 2 фазы 5): новая привязка без
 * правки кода — тоже новая сборка, и «Edge API» её выложит.
 */
export function stampBuild(
  code: string,
  salt = "",
): { build: string; code: string } {
  const parts = code.split(BUILD_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(
      `метка сборки ${BUILD_PLACEHOLDER} встречается ${parts.length - 1} раз вместо одного`,
    );
  }
  const build = sha256(code + salt).slice(0, BUILD_ID_LENGTH);
  return { build, code: parts.join(build) };
}

export async function buildApi(
  options: ApiBuildOptions,
): Promise<ApiBuildReport> {
  const metadata = canonicalJson(workerMetadata());
  const schedules = canonicalJson(API_SCHEDULES as unknown as Json);
  const stamped = stampBuild(
    await bundleWorker(options.root),
    metadata + schedules,
  );
  const bytes = Buffer.byteLength(stamped.code, "utf8");
  const gzipBytes = gzipSync(stamped.code).length;
  await mkdir(options.outDir, { recursive: true });
  const files: [string, string][] = [
    [WORKER_FILE, stamped.code],
    [METADATA_FILE, metadata],
    [SCHEDULES_FILE, schedules],
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
