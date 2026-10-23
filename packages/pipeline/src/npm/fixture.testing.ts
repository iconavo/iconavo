// Тестовый набор для пакетов npm: всё, что пишет pnpm data, — icons.json и info.json (как у раздачи),
// metadata.json, changelog.json с выпуском текущей версии и LICENSE с текстом лицензии, при желании
// NOTICE. И поддельный реестр: описания пакетов из готовых файлов версий, без сети.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, type Json } from "../build/json.js";
import { type CdnDemoSet, writeCdnDemoSet } from "../cdn/fixture.testing.js";
import { demoConfig } from "../search/fixture.testing.js";
import {
  NPM_PUBLISH_REF,
  NPM_REGISTRY,
  NPM_REPOSITORY,
  NPM_TAG,
  NPM_WORKFLOW,
} from "./config.js";
import { buildPackage, packageJsonOf } from "./files.js";
import { loadNpmSet, type NpmSet } from "./load.js";
import {
  integrityHex,
  integrityOfBytes,
  type NpmVersionDoc,
  type Provenance,
  type RegistryClient,
} from "./registry.js";

export interface NpmDemoSet extends CdnDemoSet {
  metadata?: { [key: string]: Json };
  /** Текст NOTICE: пишется и файлом, и в info.json. */
  notice?: string;
  /** Прошлые версии набора в журнале — от свежих к старым, после текущей. */
  previous?: string[];
}

/** Текст лицензии тестового набора — как в info.json от writeCdnDemoSet. */
export const DEMO_LICENSE = "MIT License";

/** Пишет набор со всеми файлами для пакета и возвращает его версию. */
export async function writeNpmDemoSet(
  dataDir: string,
  set: NpmDemoSet,
): Promise<{ version: string }> {
  const { version } = await writeCdnDemoSet(dataDir, set);
  const dir = join(dataDir, set.id);
  if (set.notice !== undefined) {
    const info = JSON.parse(await readFile(join(dir, "info.json"), "utf8"));
    info.license.notice = set.notice;
    await writeFile(join(dir, "info.json"), canonicalJson(info));
    await writeFile(join(dir, "NOTICE"), set.notice);
  }
  await writeFile(
    join(dir, "metadata.json"),
    canonicalJson(set.metadata ?? {}),
  );
  const total = Object.values(set.icons).filter(
    (i) => i.hidden !== true,
  ).length;
  const versions = [version, ...(set.previous ?? [])];
  const releases = versions.map((v, i) => {
    const release: { [key: string]: Json } = {
      version: v,
      date: `2026-10-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
      revision: "1.0.0",
      total,
    };
    const older = versions[i + 1];
    if (older !== undefined) release.previous = older;
    return release;
  });
  await writeFile(
    join(dir, "changelog.json"),
    canonicalJson({ prefix: set.id, releases }),
  );
  await writeFile(join(dir, "LICENSE"), DEMO_LICENSE);
  return { version };
}

/** Набор, прочитанный так же, как его читает подготовка. */
export const loadDemoNpmSet = (dataDir: string, id: string): Promise<NpmSet> =>
  loadNpmSet(demoConfig(id), dataDir);

/** Файлы версии пакета — ровно такие, какие выпустила бы эта сборка. */
export function packageFiles(
  set: NpmSet,
  version: string,
  tag = NPM_TAG,
): Map<string, Uint8Array> {
  const pkg = buildPackage(set, tag);
  return new Map(
    [...pkg.files, packageJsonOf(set, tag, pkg, version)].map((f) => [
      f.path,
      f.data,
    ]),
  );
}

export interface FakeVersion {
  version: string;
  files: Map<string, Uint8Array>;
  /** Выложено доверенной публикацией (по умолчанию) или токеном. */
  trusted?: boolean;
  /** Подпись provenance: по умолчанию верная, null — подписи нет. */
  provenance?: Provenance | null;
  /** Сколько первых запросов подписи она ещё «не готова»: так npm отдаёт её после своей проверки. */
  provenanceLag?: number;
  /** Время выхода; по умолчанию — по порядку в списке. */
  time?: string;
}

export interface FakePackage {
  versions: FakeVersion[];
  tags: Record<string, string>;
  /** Снятые версии: в time есть, в versions — нет. */
  unpublished?: string[];
}

/**
 * Поддельный реестр: пакет → состояние или список состояний (каждый запрос описания берёт следующее,
 * последнее остаётся) — так проверяется ожидание новой версии.
 */
export function fakeRegistry(
  packages: Record<string, FakePackage | readonly FakePackage[]>,
) {
  const calls: string[] = [];
  const asked = new Map<string, number>();
  const byTarball = new Map<string, FakeVersion>();
  const provenanceAsked = new Map<FakeVersion, number>();
  const client: RegistryClient = {
    async packument(name) {
      calls.push(`packument ${name}`);
      const value = packages[name];
      if (value === undefined) return undefined;
      const states: readonly FakePackage[] = Array.isArray(value)
        ? value
        : [value as FakePackage];
      const i = asked.get(name) ?? 0;
      asked.set(name, i + 1);
      const state = states[Math.min(i, states.length - 1)];
      if (state === undefined) return undefined;
      const versions = new Map<string, NpmVersionDoc>();
      const times = new Map<string, string>();
      for (const [n, v] of state.versions.entries()) {
        const manifest = v.files.get("package.json");
        const iconavo =
          manifest === undefined
            ? undefined
            : (
                JSON.parse(Buffer.from(manifest).toString("utf8")) as {
                  iconavo?: { setVersion?: string; fingerprint?: string };
                }
              ).iconavo;
        const tarball = `${NPM_REGISTRY}/${name}/-/${v.version}.tgz`;
        byTarball.set(tarball, v);
        versions.set(v.version, {
          version: v.version,
          tarball,
          integrity: integrityOfBytes(Buffer.from(`${name}@${v.version}`)),
          attestationsUrl:
            v.provenance === null
              ? undefined
              : `${NPM_REGISTRY}/-/npm/v1/attestations/${name}@${v.version}`,
          setVersion: iconavo?.setVersion,
          fingerprint: iconavo?.fingerprint,
          trustedPublisher: v.trusted === false ? undefined : "github",
        });
        times.set(
          v.version,
          v.time ?? `2026-10-${String(10 + n).padStart(2, "0")}T00:00:00.000Z`,
        );
      }
      for (const u of state.unpublished ?? []) {
        times.set(u, "2026-10-01T00:00:00.000Z");
      }
      return { name, distTags: state.tags, versions, times };
    },
    async files(doc) {
      calls.push(`files ${doc.version}`);
      const v = byTarball.get(doc.tarball);
      if (v === undefined) throw new Error(`нет архива ${doc.tarball}`);
      return new Map(v.files);
    },
    async provenance(doc) {
      calls.push(`provenance ${doc.version}`);
      const v = byTarball.get(doc.tarball);
      if (v?.provenance === null) return undefined;
      if (v !== undefined) {
        const asked = provenanceAsked.get(v) ?? 0;
        provenanceAsked.set(v, asked + 1);
        if (asked < (v.provenanceLag ?? 0)) return undefined;
      }
      return (
        v?.provenance ?? {
          repository: NPM_REPOSITORY,
          workflow: NPM_WORKFLOW,
          ref: NPM_PUBLISH_REF,
          commit: "0123456789abcdef0123456789abcdef01234567",
          sha512: integrityHex(doc.integrity ?? ""),
          run: "https://github.com/iconavo/iconavo/actions/runs/1/attempts/1",
        }
      );
    },
  };
  return { client, calls };
}
