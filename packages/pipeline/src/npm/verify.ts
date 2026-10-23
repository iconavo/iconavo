// Команда pnpm packages verify (шаг 5 фазы 2, ADR-0026): что в npm лежат ровно наши пакеты. Ожидаемое
// содержимое собирается заново из data/: так проверка работает и после сбоя прошлого запуска, и по
// расписанию. Под тегом — версия с нашим отпечатком; архив побайтно равен сборке; есть подпись
// provenance из нашего репозитория, workflow и ветки; выложено доверенной публикацией — токен допустим
// только у самой первой версии. Пакета ещё нет — предупреждение, а не ошибка. npm показывает новую
// версию и её подпись не сразу, а после своей проверки — через минуты, поэтому проверка ждёт: по плану
// запуска — ровно выпущенную версию (у «новой версии без изменений» отпечаток прежний), без плана —
// наш отпечаток.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { SourceConfig } from "../sources/config.js";
import {
  NPM_POLL_MS,
  NPM_PUBLISH_REF,
  NPM_REPOSITORY,
  NPM_TAG,
  NPM_WORKFLOW,
  npmPackageName,
} from "./config.js";
import { firstPublished } from "./decide.js";
import { buildPackage, packageJsonOf } from "./files.js";
import { loadNpmSet } from "./load.js";
import {
  integrityHex,
  type NpmVersionDoc,
  type Packument,
  type Provenance,
  type RegistryClient,
} from "./registry.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type NpmVerifyStatus = "ok" | "awaiting" | "failed";

export interface NpmVerifyEntry {
  id: string;
  name: string;
  status: NpmVerifyStatus;
  /** Версия под тегом в npm. */
  version?: string;
  /** Куда указывает latest — только для сведения. */
  latest?: string;
  /** Отпечаток сборки из data/. */
  fingerprint?: string;
  /** Отпечаток версии под тегом в npm. */
  published?: string;
  publisher?: "trusted" | "token";
  provenance?: Provenance;
  /** Сколько файлов сверено побайтно. */
  files?: number;
  problems: string[];
  notes: string[];
}

export interface NpmVerifyReport {
  tag: string;
  packages: NpmVerifyEntry[];
}

export interface VerifyOptions {
  dataDir: string;
  registry: RegistryClient;
  /** Набор → версия, которую выпустил этот запуск (из плана): ждём именно её под тегом. */
  expected?: ReadonlyMap<string, string>;
  /** Сколько ждать, пока реестр покажет новую версию и её подпись: после публикации он отстаёт. */
  waitMs?: number;
  pollMs?: number;
  tag?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export const npmVerifyFailed = (r: NpmVerifyReport) =>
  r.packages.some((p) => p.status === "failed");

const planSchema = z.object({
  packages: z.array(
    z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      publish: z.boolean(),
    }),
  ),
});

/** Что выпустил запуск: набор → версия из plan.json подготовки — только пакеты к публикации. */
export function expectedFromPlan(json: unknown): Map<string, string> {
  const plan = planSchema.parse(json);
  return new Map(
    plan.packages.filter((p) => p.publish).map((p) => [p.id, p.version]),
  );
}

/** plan.json с диска; не читается или не по схеме — ошибка с путём. */
export async function readPlan(path: string): Promise<Map<string, string>> {
  try {
    return expectedFromPlan(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error(
      `план ${path} не читается — его пишет pnpm packages prepare`,
    );
  }
}

/** Версия под тегом и её запись в реестре. */
function tagged(p: Packument | undefined, tag: string) {
  const version = p?.distTags[tag];
  return version === undefined ? undefined : p?.versions.get(version);
}

export async function verifyPackages(
  configs: readonly SourceConfig[],
  options: VerifyOptions,
): Promise<NpmVerifyReport> {
  const tag = options.tag ?? NPM_TAG;
  const waitMs = options.waitMs ?? 0;
  const pollMs = options.pollMs ?? NPM_POLL_MS;
  const sleep =
    options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  // Срок один на весь запуск: пакеты выходят вместе, и npm проверяет их одновременно.
  const deadline = now() + waitMs;
  const packages: NpmVerifyEntry[] = [];
  for (const config of configs) {
    const entry: NpmVerifyEntry = {
      id: config.id,
      name: npmPackageName(config.id),
      status: "failed",
      problems: [],
      notes: [],
    };
    packages.push(entry);
    try {
      const set = await loadNpmSet(config, options.dataDir);
      const pkg = buildPackage(set, tag);
      entry.fingerprint = pkg.fingerprint;
      const expected = options.expected?.get(config.id);
      // Реестр показывает новую версию и её подпись не сразу: ждём их под тегом до срока.
      let p: Packument | undefined;
      let doc: NpmVersionDoc | undefined;
      let prov: Provenance | undefined;
      for (;;) {
        p = await options.registry.packument(pkg.name);
        doc = tagged(p, tag);
        prov = undefined;
        const arrived =
          doc !== undefined &&
          doc.fingerprint === pkg.fingerprint &&
          (expected === undefined || doc.version === expected);
        if (arrived && doc?.attestationsUrl !== undefined) {
          prov = await options.registry.provenance(doc);
        }
        if (arrived && prov !== undefined) break;
        // Пакета нет и этот запуск его не выпускал — ждать нечего.
        if (p === undefined && expected === undefined) break;
        const left = deadline - now();
        if (left <= 0) break;
        log(
          `${pkg.name}: жду, пока реестр покажет ${expected ?? "новую версию"} и её подпись…`,
        );
        await sleep(Math.min(pollMs, left));
      }
      if (p === undefined) {
        if (expected !== undefined) {
          entry.problems.push(
            `пакета нет в npm, а запуск выпускал ${expected}: npm ещё проверяет новый пакет или публикация не прошла — повторите «Проверку» позже`,
          );
          continue;
        }
        entry.status = "awaiting";
        entry.notes.push(
          "пакета ещё нет в npm: первая версия выходит только при ручном запуске с «первой публикацией» (ADR-0026)",
        );
        continue;
      }
      entry.latest = p.distTags.latest;
      if (doc === undefined) {
        entry.problems.push(`в npm нет тега ${tag}`);
        continue;
      }
      entry.version = doc.version;
      entry.published = doc.fingerprint;
      if (expected !== undefined && doc.version !== expected) {
        entry.problems.push(
          `под тегом ${tag} — ${doc.version}, а запуск выпускал ${expected}: npm ещё проверяет новую версию (это занимает минуты) или публикация не прошла — повторите «Проверку» позже`,
        );
        continue;
      }
      if (doc.fingerprint !== pkg.fingerprint) {
        entry.problems.push(
          `под тегом ${tag} версия ${doc.version} с другим отпечатком: эта сборка data/ в npm не вышла — повторите запуск «Публикации в npm»`,
        );
        continue;
      }

      const published = await options.registry.files(doc);
      const wanted = new Map(
        [...pkg.files, packageJsonOf(set, tag, pkg, doc.version)].map((f) => [
          f.path,
          f.data,
        ]),
      );
      const missing = [...wanted.keys()].filter((f) => !published.has(f));
      const extra = [...published.keys()].filter((f) => !wanted.has(f));
      const different = [...wanted]
        .filter(([path, data]) => {
          const got = published.get(path);
          return (
            got !== undefined && !Buffer.from(got).equals(Buffer.from(data))
          );
        })
        .map(([path]) => path);
      if (missing.length > 0) {
        entry.problems.push(
          `в архиве npm нет файлов: ${missing.sort(order).join(", ")}`,
        );
      }
      if (extra.length > 0) {
        entry.problems.push(
          `в архиве npm лишние файлы: ${extra.sort(order).join(", ")}`,
        );
      }
      if (different.length > 0) {
        entry.problems.push(
          `файлы в npm отличаются от сборки: ${different.sort(order).join(", ")}`,
        );
      }
      entry.files = wanted.size;

      if (doc.attestationsUrl === undefined) {
        entry.problems.push(`у версии ${doc.version} нет подписи provenance`);
      } else if (prov === undefined) {
        entry.problems.push(
          `подпись provenance версии ${doc.version} не прочитать: npm ещё готовит её или её нет — повторите «Проверку» позже`,
        );
      } else {
        entry.provenance = prov;
        if (prov.repository !== NPM_REPOSITORY) {
          entry.problems.push(
            `provenance: репозиторий ${prov.repository ?? "—"}, а не ${NPM_REPOSITORY}`,
          );
        }
        if (prov.workflow !== NPM_WORKFLOW) {
          entry.problems.push(
            `provenance: workflow ${prov.workflow ?? "—"}, а не ${NPM_WORKFLOW}`,
          );
        }
        if (prov.ref !== NPM_PUBLISH_REF) {
          entry.problems.push(
            `provenance: ветка ${prov.ref ?? "—"}, а не ${NPM_PUBLISH_REF}`,
          );
        }
        if (
          doc.integrity === undefined ||
          prov.sha512 !== integrityHex(doc.integrity)
        ) {
          entry.problems.push(
            "provenance подписывает другой архив: SHA-512 не совпадает с реестром",
          );
        }
      }

      entry.publisher =
        doc.trustedPublisher === undefined ? "token" : "trusted";
      if (entry.publisher === "token") {
        if (firstPublished(p) === doc.version) {
          entry.notes.push(
            "первая версия выложена временным токеном — так и задумано: доверенную публикацию npm включает только у существующего пакета",
          );
        } else {
          entry.problems.push(
            `версия ${doc.version} выложена токеном, а не доверенной публикацией: проверьте на npmjs.com Trusted Publisher и Publishing access`,
          );
        }
      }
      if (entry.latest !== undefined && entry.latest !== doc.version) {
        entry.notes.push(
          `latest → ${entry.latest}: до запуска так и есть, свежая версия — под тегом ${tag}`,
        );
      }
      entry.status = entry.problems.length > 0 ? "failed" : "ok";
    } catch (e) {
      entry.problems.push((e as Error).message);
    }
  }
  return { tag, packages };
}
