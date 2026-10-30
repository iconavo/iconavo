// Тестовый репозиторий выпуска (ADR-0051): три package.json, README, журнал, HTML-пример, LICENSE и
// исходники; архивы — tgz от makeTgz, как у pnpm pack; поддельный реестр — описания пакетов, файлы
// версий и подписи provenance, без сети.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  NPM_PUBLISH_REF,
  NPM_REGISTRY,
  NPM_REPOSITORY,
} from "../npm/config.js";
import {
  integrityHex,
  integrityOfBytes,
  type NpmVersionDoc,
  type Packument,
  type Provenance,
  type RegistryClient,
} from "../npm/registry.js";
import { makeTgz } from "../sources/tar-builder.testing.js";
import type { Pack } from "../starters/pack.js";
import {
  fixedFields,
  PACKAGES,
  type PackageId,
  packageName,
  RELEASE_WORKFLOW,
  scriptUrl,
} from "./config.js";
import type { ScriptBuild } from "./prepare.js";
import { sri } from "./text.js";

/** «Скрипт тега» тестов: его хэш стоит в строках подключения. */
export const SCRIPT = Buffer.from("export const icon = 1;\n");
export const LICENSE = "MIT License\n";

export const fakeBuild = async (): Promise<ScriptBuild> => ({
  body: SCRIPT,
  gzipBytes: 42,
});

/** package.json пакета: в репозитории ядро — workspace:*, в архиве — точной версией. */
export function manifestOf(
  id: PackageId,
  version: string,
  packed: boolean,
): Record<string, unknown> {
  return {
    name: packageName(id),
    version,
    ...(version === "0.0.0" ? { private: true } : {}),
    description: `The ${id} package.`,
    keywords: ["iconavo", "icons"],
    ...fixedFields(id),
    sideEffects: id === "icon" ? ["./dist/index.js"] : false,
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./package.json": "./package.json",
    },
    types: "./dist/index.d.ts",
    scripts: { build: "tsc -b" },
    ...(id === "core"
      ? {}
      : {
          dependencies: {
            "@iconavo-ui/core": packed ? version : "workspace:*",
          },
        }),
  };
}

/** README пакета: у тега — со строкой подключения скрипта и import рецепта configure. */
export function readmeOf(
  id: PackageId,
  version: string,
  integrity: string | null = sri(SCRIPT),
): string {
  if (id !== "icon") return `# ${id}\n`;
  return `# Icons\n\n\`\`\`html\n${scriptLine(version, integrity)}\n\`\`\`\n\n\`\`\`js\nimport { configure } from "${scriptUrl(version)}";\n\`\`\`\n`;
}

/** Файлы архива пакета, как их кладёт pnpm pack. */
export function packFiles(
  id: PackageId,
  version: string,
): Record<string, Buffer> {
  const files: Record<string, Buffer> = {
    "package.json": Buffer.from(
      `${JSON.stringify(manifestOf(id, version, true), null, 2)}\n`,
    ),
    "README.md": Buffer.from(readmeOf(id, version)),
    LICENSE: Buffer.from(LICENSE),
    "dist/index.js": Buffer.from("export {};\n"),
    "dist/index.d.ts": Buffer.from("export {};\n"),
  };
  if (id === "icon") files["dist/iconavo-icon.js"] = SCRIPT;
  return files;
}

export const tgzOf = (files: Record<string, Buffer>) =>
  makeTgz(
    Object.entries(files).map(([path, data]) => ({
      name: `package/${path}`,
      data,
    })),
  );

/** Строка подключения версии: с хэшем, без него (null) или с чужим хэшем. */
export const scriptLine = (version: string, integrity: string | null) =>
  integrity === null
    ? `<script type="module" src="${scriptUrl(version)}"></script>`
    : `<script type="module" src="${scriptUrl(version)}" integrity="${integrity}"></script>`;

const write = async (root: string, path: string, text: string | Buffer) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

export interface ReleaseRepoOptions {
  version: string;
  /** Хэш в строках подключения: нет — хэш SCRIPT, null — без integrity. */
  integrity?: string | null;
  changelog?: string;
  /** Версия наших пакетов в примерах React и Next.js; нет — version. */
  starters?: string;
}

/** Репозиторий выпуска версии: всё на месте. */
export async function writeReleaseRepo(o: ReleaseRepoOptions): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "iconavo-release-"));
  await write(root, "LICENSE", LICENSE);
  const integrity = o.integrity === undefined ? sri(SCRIPT) : o.integrity;
  for (const id of PACKAGES) {
    await write(
      root,
      `packages/${id}/package.json`,
      `${JSON.stringify(manifestOf(id, o.version, false), null, 2)}\n`,
    );
    await write(
      root,
      `packages/${id}/README.md`,
      readmeOf(id, o.version, integrity),
    );
    await write(root, `packages/${id}/src/index.ts`, "export {};\n");
  }
  await write(
    root,
    "packages/icon/CHANGELOG.md",
    o.changelog ??
      `# Changelog\n\nIntro.\n\n## ${o.version} — 2026-10-29\n\n- First.\n`,
  );
  const line = scriptLine(o.version, integrity);
  await write(root, "README.md", `# Iconavo\n\n\`\`\`html\n${line}\n\`\`\`\n`);
  await write(
    root,
    "examples/starters/html/index.html",
    `<html>\n  <head>\n    ${line}\n  </head>\n</html>\n`,
  );
  for (const id of ["react", "next"]) {
    await write(
      root,
      `examples/starters/${id}/package.json`,
      `${JSON.stringify(
        {
          name: `iconavo-${id}-starter`,
          dependencies: {
            "@iconavo-ui/react": o.starters ?? o.version,
            react: "19.3.1",
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

/**
 * Упаковка без pnpm: архивы в outDir. README и LICENSE — из репозитория, как у pnpm pack, остальное —
 * packFiles; change меняет состав архива.
 */
export function fakePack(
  change: (
    id: PackageId,
    version: string,
    files: Record<string, Buffer>,
  ) => Record<string, Buffer> = (_id, _version, files) => files,
): (root: string, outDir: string) => Promise<Pack[]> {
  return async (root, outDir) => {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const packs: Pack[] = [];
    for (const id of PACKAGES) {
      const { version } = JSON.parse(
        await readFile(join(root, "packages", id, "package.json"), "utf8"),
      ) as { version: string };
      const content = change(id, version, {
        ...packFiles(id, version),
        "README.md": await readFile(join(root, "packages", id, "README.md")),
        LICENSE: await readFile(join(root, "LICENSE")),
      });
      const tgz = tgzOf(content);
      const file = join(outDir, `iconavo-ui-${id}-${version}.tgz`);
      await writeFile(file, tgz);
      packs.push({
        id,
        name: packageName(id),
        version,
        file,
        bytes: tgz.length,
        sha256: "",
        integrity: integrityOfBytes(tgz),
        files: Object.keys(content).sort(),
        manifest: JSON.parse(
          (content["package.json"] as Buffer).toString("utf8"),
        ) as Record<string, unknown>,
      });
    }
    return packs;
  };
}

/** Версия пакета в поддельном реестре. */
export interface FakeVersion {
  version: string;
  /** Файлы архива; нет — packFiles этой версии. */
  files?: Record<string, Buffer>;
  /** Выложена токеном, а не доверенной публикацией. */
  token?: boolean;
  /** Своя подпись; null — подписи нет. */
  provenance?: Partial<Provenance> | null;
  time?: string;
  /** Снята: номер в time есть, версии нет. */
  unpublished?: boolean;
}

export interface FakePackage {
  versions: FakeVersion[];
  tags: Record<string, string>;
}

const idOf = (name: string) => name.slice(name.indexOf("/") + 1) as PackageId;

/**
 * Поддельный реестр. hidden — сколько первых запросов описания пакет «ещё не виден»: так npm отстаёт
 * после публикации.
 */
export function fakeRegistry(
  packages: Record<string, FakePackage | undefined>,
  o: { hidden?: number } = {},
): RegistryClient & { calls: string[] } {
  const calls: string[] = [];
  const archives = new Map<
    string,
    { tgz: Buffer; files: Record<string, Buffer>; v: FakeVersion }
  >();
  const archive = (name: string, v: FakeVersion) => {
    const key = `${name}@${v.version}`;
    let a = archives.get(key);
    if (!a) {
      const files = v.files ?? packFiles(idOf(name), v.version);
      a = { tgz: tgzOf(files), files, v };
      archives.set(key, a);
    }
    return a;
  };
  let seen = 0;
  return {
    calls,
    async packument(name) {
      calls.push(`packument ${name}`);
      seen++;
      if (seen <= (o.hidden ?? 0)) return undefined;
      const pkg = packages[name];
      if (pkg === undefined) return undefined;
      const versions = new Map<string, NpmVersionDoc>();
      const times = new Map<string, string>();
      pkg.versions.forEach((v, i) => {
        times.set(
          v.version,
          v.time ?? `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
        );
        if (v.unpublished) return;
        const a = archive(name, v);
        versions.set(v.version, {
          version: v.version,
          tarball: `${NPM_REGISTRY}/${name}/-/${idOf(name)}-${v.version}.tgz`,
          integrity: integrityOfBytes(a.tgz),
          ...(v.provenance === null
            ? {}
            : {
                attestationsUrl: `${NPM_REGISTRY}/-/npm/v1/attestations/${name}@${v.version}`,
              }),
          ...(v.token ? {} : { trustedPublisher: "github" }),
        });
      });
      const p: Packument = { name, distTags: pkg.tags, versions, times };
      return p;
    },
    async files(doc) {
      const name = doc.tarball.slice(
        NPM_REGISTRY.length + 1,
        doc.tarball.indexOf("/-/"),
      );
      calls.push(`files ${name}@${doc.version}`);
      const v = packages[name]?.versions.find((x) => x.version === doc.version);
      if (!v) throw new Error(`нет ${name}@${doc.version}`);
      const out = new Map<string, Uint8Array>();
      for (const [path, data] of Object.entries(archive(name, v).files)) {
        out.set(path, new Uint8Array(data));
      }
      return out;
    },
    async provenance(doc) {
      const name = doc.tarball.slice(
        NPM_REGISTRY.length + 1,
        doc.tarball.indexOf("/-/"),
      );
      const v = packages[name]?.versions.find((x) => x.version === doc.version);
      if (!v || v.provenance === null) return undefined;
      return {
        repository: NPM_REPOSITORY,
        workflow: RELEASE_WORKFLOW,
        ref: NPM_PUBLISH_REF,
        sha512: integrityHex(doc.integrity ?? ""),
        ...v.provenance,
      };
    },
  };
}

/**
 * Реестр, где эта версия трёх пакетов уже вышла, — версии, тег next и latest (latest идёт за каждой
 * бетой, ADR-0051; latest — свой, если тест проверяет отставший).
 */
export function publishedAll(
  versions: FakeVersion[],
  tag = versions.at(-1)?.version ?? "0.1.0",
  latest = tag,
): Record<string, FakePackage> {
  return Object.fromEntries(
    PACKAGES.map((id) => [
      packageName(id),
      { versions, tags: { latest, next: tag } },
    ]),
  );
}
