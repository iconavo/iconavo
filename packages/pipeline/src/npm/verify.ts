// Команда pnpm packages verify (шаг 5 фазы 2, ADR-0026): что в npm лежат ровно наши пакеты. Ожидаемое
// собирается заново из data/, а не берётся из плана: так проверка работает и после сбоя прошлого
// запуска, и по расписанию. Под тегом — версия с нашим отпечатком; архив побайтно равен сборке; есть
// подпись provenance из нашего репозитория, workflow и ветки; выложено доверенной публикацией — токен
// допустим только у самой первой версии. Пакета ещё нет — предупреждение, а не ошибка.

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
  /** Сколько ждать, пока реестр покажет версию с нашим отпечатком: после публикации он отстаёт. */
  waitMs?: number;
  pollMs?: number;
  tag?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export const npmVerifyFailed = (r: NpmVerifyReport) =>
  r.packages.some((p) => p.status === "failed");

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
      // Реестр показывает новую версию не сразу: ждём наш отпечаток под тегом до срока.
      const deadline = now() + waitMs;
      let p = await options.registry.packument(pkg.name);
      while (tagged(p, tag)?.fingerprint !== pkg.fingerprint) {
        const left = deadline - now();
        if (left <= 0) break;
        log(`${pkg.name}: жду, пока реестр покажет новую версию…`);
        await sleep(Math.min(pollMs, left));
        p = await options.registry.packument(pkg.name);
      }
      if (p === undefined) {
        entry.status = "awaiting";
        entry.notes.push(
          "пакета ещё нет в npm: первая версия выходит только при ручном запуске с «первой публикацией» (ADR-0026)",
        );
        continue;
      }
      entry.latest = p.distTags.latest;
      const doc = tagged(p, tag);
      if (doc === undefined) {
        entry.problems.push(`в npm нет тега ${tag}`);
        continue;
      }
      entry.version = doc.version;
      entry.published = doc.fingerprint;
      if (doc.fingerprint !== pkg.fingerprint) {
        entry.problems.push(
          `под тегом ${tag} версия ${doc.version} с другим отпечатком: эта сборка data/ в npm не вышла — повторите запуск «Публикации в npm»`,
        );
        continue;
      }

      const published = await options.registry.files(doc);
      const expected = new Map(
        [...pkg.files, packageJsonOf(set, tag, pkg, doc.version)].map((f) => [
          f.path,
          f.data,
        ]),
      );
      const missing = [...expected.keys()].filter((f) => !published.has(f));
      const extra = [...published.keys()].filter((f) => !expected.has(f));
      const different = [...expected]
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
      entry.files = expected.size;

      if (doc.attestationsUrl === undefined) {
        entry.problems.push(`у версии ${doc.version} нет подписи provenance`);
      } else {
        const prov = await options.registry.provenance(doc);
        if (prov === undefined) {
          entry.problems.push(
            `подпись provenance версии ${doc.version} не прочитать`,
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
