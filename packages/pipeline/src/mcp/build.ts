// Сборка MCP-сервера (ADR-0044, шаг 10 фазы 4): rolldown собирает apps/mcp в один ES-модуль для
// Workers тем же сборщиком, что edge API, но с условиями экспорта workerd (сборки SDK под Workers) и
// одним внешним импортом — модулем wasm рисовальщика resvg. Рядом: resvg.wasm, тело части metadata
// загрузки и build.json. Метка сборки — 8 знаков SHA-256 бандла, модуля wasm и metadata: смена любого
// из них — новая выкладка. Без изменений ничего не перезаписывается.

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { type Usage, usageFromReadme } from "@iconavo-ui/snippets/readme";
import { bundleWorker, stampBuild, type WorkerTarget } from "../api/build.js";
import {
  BUILD_FILE,
  COMPATIBILITY_DATE,
  METADATA_FILE,
  R2_BINDING,
  SEARCH_BINDING,
  WORKER_BUCKET,
  WORKER_FILE,
} from "../api/config.js";
import { canonicalJson, type Json } from "../build/json.js";
import { writeFileAtomic } from "../build/write.js";
import { writeIfChanged } from "../cdn/write.js";
import { SEARCH_BUCKET } from "../meili/config.js";
import {
  ICON_README,
  MCP_CONDITIONS,
  MCP_CPU_MS,
  MCP_ENTRY,
  MCP_ICON_LIMIT_BINDING,
  MCP_ICON_LIMIT_NAMESPACE,
  MCP_ICON_RATE,
  MCP_SEARCH_LIMIT_BINDING,
  MCP_SEARCH_LIMIT_NAMESPACE,
  MCP_SEARCH_RATE,
  MCP_TSCONFIG,
  README_MODULE,
  WASM_FILE,
  WASM_IMPORT,
  WASM_PACKAGE_FILE,
} from "./config.js";

/** Цель сборки MCP; usage — строки установки и разделы README тега для get_usage. */
export function mcpTarget(usage: Usage): WorkerTarget {
  return {
    entry: MCP_ENTRY,
    tsconfig: MCP_TSCONFIG,
    conditions: MCP_CONDITIONS,
    wasm: WASM_IMPORT,
    virtual: {
      [README_MODULE]: `export default ${JSON.stringify(usage)};
`,
    },
  };
}

/** Разделы README тега: нужного нет — «СТОП» сборки (usageFromReadme). */
export async function readUsage(root: string): Promise<Usage> {
  return usageFromReadme(await readFile(join(root, ICON_README), "utf8"));
}

export interface McpBuildReport {
  build: string;
  bytes: number;
  gzipBytes: number;
  wasmBytes: number;
  /** Записанные файлы; пусто — без изменений. */
  written: string[];
}

export interface McpBuildOptions {
  root: string;
  outDir: string;
}

/**
 * metadata загрузки: модуль, дата совместимости, бакеты раздачи и поиска (только чтение), лимит
 * частоты поиска, предел процессора на вызов. Секреты поиска сюда не пишутся: их вписывает выкладка
 * из окружения GitHub api, как у edge API. Журналы — только наши сообщения об ошибках, без журнала
 * запросов с IP (ADR-0028).
 */
export function mcpMetadata(): Json {
  return {
    main_module: WORKER_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: "r2_bucket", name: R2_BINDING, bucket_name: WORKER_BUCKET },
      { type: "r2_bucket", name: SEARCH_BINDING, bucket_name: SEARCH_BUCKET },
      {
        type: "ratelimit",
        name: MCP_SEARCH_LIMIT_BINDING,
        namespace_id: MCP_SEARCH_LIMIT_NAMESPACE,
        simple: {
          limit: MCP_SEARCH_RATE.limit,
          period: MCP_SEARCH_RATE.period,
        },
      },
      {
        type: "ratelimit",
        name: MCP_ICON_LIMIT_BINDING,
        namespace_id: MCP_ICON_LIMIT_NAMESPACE,
        simple: { limit: MCP_ICON_RATE.limit, period: MCP_ICON_RATE.period },
      },
    ],
    limits: { cpu_ms: MCP_CPU_MS },
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: false },
    },
  };
}

const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** Модуль wasm рисовальщика из пакета функции — тот же файл, что в node_modules. */
export async function readResvgWasm(root: string): Promise<Buffer> {
  const require = createRequire(join(root, "apps", "mcp", "package.json"));
  return readFile(require.resolve(WASM_PACKAGE_FILE));
}

/** Пишет байты, только если на диске другие; true — записано. */
async function writeBytesIfChanged(
  path: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const current = await readFile(path).catch(() => undefined);
  if (current?.equals(bytes)) return false;
  await writeFileAtomic(path, bytes);
  return true;
}

export async function buildMcp(
  options: McpBuildOptions,
): Promise<McpBuildReport> {
  const code = await bundleWorker(
    options.root,
    mcpTarget(await readUsage(options.root)),
  );
  const wasm = await readResvgWasm(options.root);
  const metadata = canonicalJson(mcpMetadata());
  const stamped = stampBuild(code, `\n${sha256(wasm)}\n${metadata}`);
  const bytes = Buffer.byteLength(stamped.code, "utf8");
  const gzipBytes = gzipSync(stamped.code).length;
  await mkdir(options.outDir, { recursive: true });
  const written: string[] = [];
  const texts: [string, string][] = [
    [WORKER_FILE, stamped.code],
    [METADATA_FILE, metadata],
    [
      BUILD_FILE,
      canonicalJson({
        build: stamped.build,
        bytes,
        gzipBytes,
        wasmBytes: wasm.length,
        sha256: sha256(stamped.code),
      }),
    ],
  ];
  for (const [name, text] of texts) {
    if (await writeIfChanged(join(options.outDir, name), text)) {
      written.push(name);
    }
  }
  if (await writeBytesIfChanged(join(options.outDir, WASM_FILE), wasm)) {
    written.push(WASM_FILE);
  }
  return {
    build: stamped.build,
    bytes,
    gzipBytes,
    wasmBytes: wasm.length,
    written,
  };
}
