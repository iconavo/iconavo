// Сборка сервиса аккаунтов (шаг 3 фазы 5, ADR-0055): тот же сборщик функций, что у edge API и MCP
// (bundleWorker), — один ES-модуль для Workers, внешние — только встроенные модули Node. Рядом — тело
// metadata загрузки (привязки D1, send_email, лимитов, закрытый режим), расписание и build.json. Метка
// сборки — SHA-256 бандла вместе с metadata и расписанием: новая привязка — тоже новая сборка. Повтор без
// изменений не пишет ни байта. Секреты сюда не пишутся: их вписывает выкладка из окружения GitHub account.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bundleWorker, stampBuild, type WorkerTarget } from "../api/build.js";
import {
  BUILD_FILE,
  COMPATIBILITY_DATE,
  METADATA_FILE,
  SCHEDULES_FILE,
  WORKER_FILE,
} from "../api/config.js";
import { canonicalJson, type Json } from "../build/json.js";
import { writeIfChanged } from "../cdn/write.js";
import {
  ACCOUNT_ACCESS,
  ACCOUNT_COMPATIBILITY_FLAGS,
  ACCOUNT_CONDITIONS,
  ACCOUNT_CPU_MS,
  ACCOUNT_DATABASE_ID,
  ACCOUNT_ENTRY,
  ACCOUNT_LIMIT_NAMESPACES,
  ACCOUNT_RATES,
  ACCOUNT_SCHEDULES,
  ACCOUNT_SENDER,
  ACCOUNT_TSCONFIG,
} from "./config.js";

export const ACCOUNT_TARGET: WorkerTarget = {
  entry: ACCOUNT_ENTRY,
  tsconfig: ACCOUNT_TSCONFIG,
  conditions: ACCOUNT_CONDITIONS,
  nodeBuiltins: true,
};

const ratelimit = (name: keyof typeof ACCOUNT_LIMIT_NAMESPACES): Json => ({
  type: "ratelimit",
  name,
  namespace_id: ACCOUNT_LIMIT_NAMESPACES[name],
  simple: {
    limit: ACCOUNT_RATES[name].limit,
    period: ACCOUNT_RATES[name].period,
  },
});

/**
 * metadata загрузки: модуль, дата совместимости и nodejs_compat, база D1 iconavo-account, письма только от
 * support@iconavo.dev, три лимита частоты, закрытый режим, предел процессора; журналы — только наши
 * сообщения, без журнала запросов с IP (ADR-0028).
 */
export function accountMetadata(): Json {
  return {
    main_module: WORKER_FILE,
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: [...ACCOUNT_COMPATIBILITY_FLAGS],
    bindings: [
      { type: "d1", name: "DB", database_id: ACCOUNT_DATABASE_ID },
      {
        type: "send_email",
        name: "EMAIL",
        allowed_sender_addresses: [ACCOUNT_SENDER],
      },
      ratelimit("AUTH_LIMIT"),
      ratelimit("CODE_LIMIT"),
      ratelimit("CODE_IP_LIMIT"),
      { type: "plain_text", name: "ACCOUNT_ACCESS", text: ACCOUNT_ACCESS },
    ],
    limits: { cpu_ms: ACCOUNT_CPU_MS },
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: false },
    },
  };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export interface AccountBuildReport {
  build: string;
  bytes: number;
  gzipBytes: number;
  /** Записанные файлы; пусто — без изменений. */
  written: string[];
}

export async function buildAccount(o: {
  root: string;
  outDir: string;
}): Promise<AccountBuildReport> {
  const metadata = canonicalJson(accountMetadata());
  const schedules = canonicalJson(ACCOUNT_SCHEDULES as unknown as Json);
  const stamped = stampBuild(
    await bundleWorker(o.root, ACCOUNT_TARGET),
    metadata + schedules,
  );
  const bytes = Buffer.byteLength(stamped.code, "utf8");
  const gzipBytes = gzipSync(stamped.code).length;
  await mkdir(o.outDir, { recursive: true });
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
    if (await writeIfChanged(join(o.outDir, name), text)) written.push(name);
  }
  return { build: stamped.build, bytes, gzipBytes, written };
}
