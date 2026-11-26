// Реестр npm для пакетов данных (ADR-0026): описание пакета со всеми версиями и тегами, архив версии
// с проверкой SHA-512 до распаковки и подпись provenance версии. Только чтение и без ключей:
// публикует сам npm в CI. Временные отказы и сбои сети повторяются, как у выгрузки раздачи.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { type RetryRules, requestWithRetries } from "../cdn/storage.js";
import { retryable } from "../embed/client.js";
import { listFiles } from "../sources/fetch.js";
import type { FetchFn } from "../sources/npm.js";
import { extractTar } from "../sources/tar.js";
import {
  NPM_MAX_ATTEMPTS,
  NPM_MAX_FILE_BYTES,
  NPM_MAX_TOTAL_BYTES,
  NPM_PROVENANCE_PREDICATE,
  NPM_REGISTRY,
  NPM_TIMEOUT_MS,
} from "./config.js";

/** Версия пакета в реестре: архив, подпись, наша отметка в package.json и кто её выложил. */
export interface NpmVersionDoc {
  version: string;
  tarball: string;
  /** SHA-512 архива: «sha512-…» в base64. */
  integrity?: string;
  /** Адрес подписей версии; есть, если npm поставил provenance. */
  attestationsUrl?: string;
  provenancePredicate?: string;
  /** Отметка iconavo из package.json: набор, версия набора и отпечаток содержимого. */
  setVersion?: string;
  fingerprint?: string;
  /** Есть — версия выложена доверенной публикацией (например, «github»), нет — токеном. */
  trustedPublisher?: string;
}

export interface Packument {
  name: string;
  /** Тег → версия. */
  distTags: Record<string, string>;
  versions: Map<string, NpmVersionDoc>;
  /** Каждый номер, который когда-либо выходил, и время выхода — и у снятых версий тоже. */
  times: Map<string, string>;
  /** Пакет снят с npm целиком: вместо описания — надгробие (ревизия фазы 5, А-4). */
  unpublished?: boolean;
}

/** Подпись provenance (SLSA v1): откуда и из какого архива собрана версия. */
export interface Provenance {
  /** Репозиторий, например https://github.com/iconavo/iconavo. */
  repository?: string;
  /** Путь workflow: .github/workflows/publish.yml. */
  workflow?: string;
  /** Ветка: refs/heads/main. */
  ref?: string;
  commit?: string;
  /** SHA-512 подписанного архива, hex. */
  sha512?: string;
  /** Адрес запуска CI. */
  run?: string;
}

const versionDocSchema = z.object({
  version: z.string().min(1),
  dist: z.object({
    tarball: z.string().min(1),
    integrity: z.string().optional(),
    attestations: z
      .object({
        url: z.string(),
        provenance: z.object({ predicateType: z.string() }).optional(),
      })
      .optional(),
  }),
  iconavo: z
    .object({
      setVersion: z.string().optional(),
      fingerprint: z.string().optional(),
    })
    .optional(),
  _npmUser: z
    .object({
      trustedPublisher: z.object({ id: z.string() }).optional(),
    })
    .optional(),
});

const packumentSchema = z.object({
  name: z.string().min(1),
  "dist-tags": z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), versionDocSchema).optional(),
  // Значения time — строки, кроме надгробия time.unpublished: объект с номерами снятых версий.
  time: z.record(z.string(), z.unknown()).optional(),
});

/** Надгробие пакета, снятого целиком: когда и какие номера были. */
const tombstoneSchema = z.object({
  time: z.string().optional(),
  versions: z.array(z.string()).optional(),
});

/** Служебные записи в time: не номера версий. */
const TIME_SERVICE_KEYS = new Set(["created", "modified", "unpublished"]);

/** Описание пакета из реестра (полное: в сокращённом нет полей package.json). */
export function parsePackument(json: unknown): Packument {
  const p = packumentSchema.parse(json);
  const versions = new Map<string, NpmVersionDoc>();
  for (const [key, v] of Object.entries(p.versions ?? {})) {
    versions.set(key, {
      version: v.version,
      tarball: v.dist.tarball,
      integrity: v.dist.integrity,
      attestationsUrl: v.dist.attestations?.url,
      provenancePredicate: v.dist.attestations?.provenance?.predicateType,
      setVersion: v.iconavo?.setVersion,
      fingerprint: v.iconavo?.fingerprint,
      trustedPublisher: v._npmUser?.trustedPublisher?.id,
    });
  }
  const times = new Map<string, string>();
  for (const [key, time] of Object.entries(p.time ?? {})) {
    if (!TIME_SERVICE_KEYS.has(key) && typeof time === "string") {
      times.set(key, time);
    }
  }
  // Надгробие: пакет снят целиком — живых версий нет, а снятые номера заняты навсегда. Раньше объект в
  // time.unpublished ронял разбор непонятной ошибкой схемы (ревизия фазы 5, А-4).
  const unpublished = p.time?.unpublished !== undefined;
  if (unpublished) {
    const tomb = tombstoneSchema.safeParse(p.time?.unpublished);
    for (const v of tomb.success ? (tomb.data.versions ?? []) : []) {
      if (!times.has(v)) times.set(v, tomb.data?.time ?? "");
    }
  }
  return {
    name: p.name,
    distTags: p["dist-tags"] ?? {},
    versions,
    times,
    ...(unpublished ? { unpublished: true } : {}),
  };
}

/** Надгробие в ответе 404 — пакет был и снят целиком; другое тело — пакета не было. */
function tombstoneOf(text: string): Packument | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const time = (json as { time?: { unpublished?: unknown } } | null)?.time;
  if (time?.unpublished === undefined) return undefined;
  try {
    return parsePackument(json);
  } catch {
    return undefined;
  }
}

const statementSchema = z.object({
  subject: z
    .array(z.object({ digest: z.object({ sha512: z.string().optional() }) }))
    .optional(),
  predicate: z
    .object({
      buildDefinition: z
        .object({
          externalParameters: z
            .object({
              workflow: z
                .object({
                  repository: z.string().optional(),
                  path: z.string().optional(),
                  ref: z.string().optional(),
                })
                .optional(),
            })
            .optional(),
          resolvedDependencies: z
            .array(
              z.object({
                digest: z.object({ gitCommit: z.string().optional() }),
              }),
            )
            .optional(),
        })
        .optional(),
      runDetails: z
        .object({
          metadata: z
            .object({ invocationId: z.string().optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const attestationsSchema = z.object({
  attestations: z.array(
    z.object({
      predicateType: z.string(),
      bundle: z.object({
        dsseEnvelope: z.object({ payload: z.string() }),
      }),
    }),
  ),
});

/** Подпись provenance из ответа реестра; нет её или ответ не разобрать — undefined. */
export function parseProvenance(json: unknown): Provenance | undefined {
  const parsed = attestationsSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const slsa = parsed.data.attestations.find(
    (a) => a.predicateType === NPM_PROVENANCE_PREDICATE,
  );
  if (!slsa) return undefined;
  let statement: unknown;
  try {
    statement = JSON.parse(
      Buffer.from(slsa.bundle.dsseEnvelope.payload, "base64").toString("utf8"),
    );
  } catch {
    return undefined;
  }
  const s = statementSchema.safeParse(statement);
  if (!s.success) return undefined;
  const build = s.data.predicate?.buildDefinition;
  const workflow = build?.externalParameters?.workflow;
  return {
    repository: workflow?.repository,
    workflow: workflow?.path,
    ref: workflow?.ref,
    commit: build?.resolvedDependencies?.[0]?.digest.gitCommit,
    sha512: s.data.subject?.[0]?.digest.sha512,
    run: s.data.predicate?.runDetails?.metadata?.invocationId,
  };
}

/** «sha512-…» (base64) → hex: так SHA-512 архива записан в подписи. */
export const integrityHex = (integrity: string) =>
  Buffer.from(integrity.replace(/^sha512-/, ""), "base64").toString("hex");

export const integrityOfBytes = (bytes: Uint8Array) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/**
 * Описание пакета уже показывает версию, а архив реестр ещё не раздаёт (404): npm выкладывает его с
 * задержкой — 17 ноября 2026 так было у @iconavo-ui/icons-lucide 1.8.0. Проверка с --wait на такой
 * ошибке ждёт дальше, остальные команды останавливаются с этим сообщением.
 */
export function tarballNotServed(version: string): Error {
  return Object.assign(
    new Error(
      `npm: архив ${version} реестр ещё не раздаёт (HTTP 404): npm выкладывает его с задержкой — повторите «Проверку» позже`,
    ),
    { tarballNotServed: true },
  );
}

export const isTarballNotServed = (e: unknown): boolean =>
  (e as { tarballNotServed?: boolean } | undefined)?.tarballNotServed === true;

export interface RegistryClient {
  /** Описание пакета; пакета нет — undefined. */
  packument(name: string): Promise<Packument | undefined>;
  /**
   * Файлы опубликованной версии: путь без верхней папки package/ → байты. Архив ещё не раздаётся (404) —
   * ошибка tarballNotServed.
   */
  files(doc: NpmVersionDoc): Promise<Map<string, Uint8Array>>;
  /** Подпись provenance версии; нет — undefined. */
  provenance(doc: NpmVersionDoc): Promise<Provenance | undefined>;
}

export interface RegistryOptions {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  registry?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

async function* once(buf: Buffer): AsyncGenerator<Buffer> {
  yield buf;
}

/** Распаковка архива в памяти через временную папку: тот же разборщик tar, что у загрузчика. */
async function unpack(tgz: Uint8Array): Promise<Map<string, Uint8Array>> {
  const tar = gunzipSync(tgz, { maxOutputLength: NPM_MAX_TOTAL_BYTES * 2 });
  const dest = await mkdtemp(join(tmpdir(), "iconavo-npm-"));
  try {
    await extractTar(once(tar), {
      dest,
      wanted: () => true,
      maxFileBytes: NPM_MAX_FILE_BYTES,
      maxTotalBytes: NPM_MAX_TOTAL_BYTES,
    });
    const out = new Map<string, Uint8Array>();
    for (const path of await listFiles(dest)) {
      out.set(path, new Uint8Array(await readFile(join(dest, path))));
    }
    return out;
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
}

export function registryClient(options: RegistryOptions = {}): RegistryClient {
  const fetchFn = options.fetch ?? fetch;
  const registry = options.registry ?? NPM_REGISTRY;
  const origin = new URL(registry).origin;
  const rules: RetryRules = {
    runStops: {},
    retryable,
    secrets: [],
    sleep:
      options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    timeoutMs: options.timeoutMs ?? NPM_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? NPM_MAX_ATTEMPTS,
  };
  // Адреса из ответа реестра идут только в сам реестр: чужой адрес — ошибка, а не запрос.
  const fromRegistry = (url: string, what: string) => {
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    if (parsed?.protocol !== "https:" || parsed.origin !== origin) {
      throw new Error(`npm: ${what} не из реестра ${origin}: ${url}`);
    }
    return parsed.href;
  };
  return {
    async packument(name) {
      const url = `${registry}/${name.replace("/", "%2F")}`;
      return requestWithRetries(
        `npm: ${name}`,
        (signal) =>
          fetchFn(url, {
            headers: {
              accept: "application/json",
              "cache-control": "no-cache",
            },
            signal,
          }),
        async (res) =>
          res.status === 404
            ? tombstoneOf(await res.text())
            : parsePackument(await res.json()),
        { ...rules, allow404: true },
      );
    },
    async files(doc) {
      const url = fromRegistry(doc.tarball, `архив ${doc.version}`);
      if (!doc.integrity?.startsWith("sha512-")) {
        throw new Error(`npm: у версии ${doc.version} нет integrity sha512`);
      }
      const bytes = await requestWithRetries(
        `npm: архив ${doc.version}`,
        (signal) => fetchFn(url, { signal }),
        async (res) =>
          res.status === 404
            ? undefined
            : new Uint8Array(await res.arrayBuffer()),
        { ...rules, allow404: true },
      );
      if (bytes === undefined) throw tarballNotServed(doc.version);
      if (integrityOfBytes(bytes) !== doc.integrity) {
        throw new Error(
          `npm: целостность архива ${doc.version} не совпала с реестром`,
        );
      }
      return unpack(bytes);
    },
    async provenance(doc) {
      if (doc.attestationsUrl === undefined) return undefined;
      const url = fromRegistry(doc.attestationsUrl, `подпись ${doc.version}`);
      return requestWithRetries(
        `npm: подпись ${doc.version}`,
        (signal) =>
          fetchFn(url, { headers: { accept: "application/json" }, signal }),
        async (res) =>
          res.status === 404 ? undefined : parseProvenance(await res.json()),
        { ...rules, allow404: true },
      );
    },
  };
}
