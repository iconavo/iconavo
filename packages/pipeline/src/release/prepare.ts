// pnpm release prepare [--first] (ADR-0051): то, что делает «Подготовка» workflow «Выпуск пакетов».
// Три пакета — одной версией; поля package.json, журнал, адреса и хэш скрипта в README — на месте;
// архивы pnpm pack — только сборка, README и LICENSE, каждый путь package.json есть в архиве; реестр npm
// только читается. Итог — архивы и план в dist-release/: какие пакеты публиковать. План пишется, только
// если «СТОП» нет. Новый пакет без --first не публикуется ни один: первую версию выкладывает ручной
// запуск с временным токеном — у несуществующего пакета доверенную публикацию не включить.

import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildIconScript, SCRIPT_FILE } from "../icon/build.js";
import { NPM_TAG } from "../npm/config.js";
import { everPublished } from "../npm/decide.js";
import type { Packument, RegistryClient } from "../npm/registry.js";
import { listFiles } from "../sources/fetch.js";
import { compareVersions, parseVersion } from "../sources/version.js";
import {
  type Pack,
  packPackages,
  packVerdict,
  tarballContents,
} from "../starters/pack.js";
import {
  CHANGELOG_FILE,
  PACKAGES,
  type PackageId,
  packageName,
  RELEASE_MAJOR,
  RELEASE_PLAN_FILE,
  SCRIPT_LINE_FILES,
  SCRIPT_PATH,
  UNRELEASED,
  VERSION_FORMAT,
} from "./config.js";
import {
  distProblems,
  type Manifest,
  manifestPaths,
  manifestProblems,
} from "./manifest.js";
import {
  changelogProblems,
  changelogSections,
  SRI_FORMAT,
  scriptRefs,
  sri,
} from "./text.js";

/**
 * new — пакета нет, этот запуск выпустит первую версию; awaiting — пакета нет, а первой публикации не
 * просили; release — новая версия существующего пакета; published — эта версия уже в npm.
 */
export type ReleaseAction = "new" | "awaiting" | "release" | "published";

export interface ReleaseEntry {
  id: PackageId;
  name: string;
  version: string;
  action?: ReleaseAction;
  /** Версия под тегом в npm до этого запуска: по ней «Публикация» видит устаревший план. */
  base: string | null;
  publish: boolean;
  /** Архив в dist-release/ и его SHA-512 «sha512-…». */
  file?: string;
  integrity?: string;
  bytes?: number;
  files: string[];
  problems: string[];
  notes: string[];
}

export interface ReleaseCheck {
  title: string;
  problems: string[];
  notes: string[];
}

export interface ReleasePrepareReport {
  version: string;
  tag: string;
  first: boolean;
  commit: string | null;
  /** 0.0.0 с private: пакеты ещё не выпускались, проверять нечего. */
  unreleased: boolean;
  /** Скрипт тега: хэш свежей сборки, в README и у опубликованной версии. */
  script?: {
    integrity: string;
    readme?: string;
    published?: string;
    bytes: number;
    gzipBytes: number;
  };
  checks: ReleaseCheck[];
  packages: ReleaseEntry[];
  /** Пакеты к публикации: план записан. */
  planned: boolean;
}

/** План для «Публикации» и «Проверки»: порядок пакетов — порядок публикации, ядро первым. */
export interface ReleasePlan {
  version: string;
  tag: string;
  first: boolean;
  commit: string | null;
  script: { path: string; integrity: string };
  packages: {
    id: PackageId;
    name: string;
    version: string;
    action: ReleaseAction;
    base: string | null;
    publish: boolean;
    file: string;
    integrity: string;
    files: string[];
  }[];
}

export interface PrepareOptions {
  root: string;
  outDir: string;
  registry: RegistryClient;
  /** Ручной запуск с «Первой публикацией»: пакеты, которых нет в npm, тоже выходят. */
  first?: boolean;
  /** Коммит запуска (GITHUB_SHA): «Проверка» сверит его с подписью provenance. */
  commit?: string | null;
  tag?: string;
  /** Сборка скрипта тега и упаковка — в тестах свои: без tsc, rolldown и pnpm. */
  buildScript?: (root: string) => Promise<ScriptBuild>;
  pack?: (root: string, outDir: string) => Promise<Pack[]>;
  log?: (line: string) => void;
}

/** Свежая сборка скрипта тега: байты и размер в gzip. */
export interface ScriptBuild {
  body: Buffer;
  gzipBytes: number;
}

/** Скрипт тега — как pnpm icon build: rolldown из вывода tsc, файл в dist пакета тега. */
export async function buildScript(root: string): Promise<ScriptBuild> {
  const build = await buildIconScript(root);
  return {
    body: await readFile(join(root, SCRIPT_FILE)),
    gzipBytes: build.gzipBytes,
  };
}

export const releaseStop = (r: ReleasePrepareReport) =>
  r.checks.some((c) => c.problems.length > 0) ||
  r.packages.some((p) => p.problems.length > 0);

const ORDER = (v: string) => parseVersion(v) ?? [];

/** Что о пакете говорит реестр: действие, версия под тегом или «СТОП». */
function registryState(
  p: Packument | undefined,
  version: string,
  first: boolean,
  tag: string,
): { action?: ReleaseAction; base: string | null; problem?: string } {
  if (p === undefined)
    return { action: first ? "new" : "awaiting", base: null };
  const base = p.distTags[tag] ?? null;
  const stable = everPublished(p);
  if (stable.length === 0) {
    return {
      base,
      problem:
        "в npm у пакета только заготовка 0.0.0-stage: npm ещё обрабатывает первую публикацию — повторите через 5 минут",
    };
  }
  if (p.versions.has(version)) return { action: "published", base };
  if (p.times.has(version)) {
    return {
      base,
      problem: `номер ${version} уже был в npm и снят — выпустить его снова нельзя: pnpm release bump с новой версией`,
    };
  }
  const highest = stable.at(-1) as string;
  if (compareVersions(ORDER(version), ORDER(highest)) <= 0) {
    return {
      base,
      problem: `версия ${version} не выше уже вышедшей ${highest} — pnpm release bump с версией выше`,
    };
  }
  return { action: "release", base };
}

export async function prepareRelease(
  o: PrepareOptions,
): Promise<ReleasePrepareReport> {
  const log = o.log ?? (() => {});
  const tag = o.tag ?? NPM_TAG;
  const first = o.first === true;
  const manifests = new Map<PackageId, Manifest>();
  for (const id of PACKAGES) {
    manifests.set(
      id,
      JSON.parse(
        await readFile(join(o.root, "packages", id, "package.json"), "utf8"),
      ) as Manifest,
    );
  }
  const versions = [
    ...new Set([...manifests.values()].map((m) => String(m.version))),
  ];
  const version =
    versions.length === 1 ? (versions[0] as string) : versions.join(", ");
  const report: ReleasePrepareReport = {
    version,
    tag,
    first,
    commit: o.commit ?? null,
    unreleased: false,
    checks: [],
    packages: PACKAGES.map((id) => ({
      id,
      name: packageName(id),
      version: String(manifests.get(id)?.version),
      base: null,
      publish: false,
      files: [],
      problems: [],
      notes: [],
    })),
    planned: false,
  };
  const planPath = join(o.outDir, RELEASE_PLAN_FILE);
  // План пишется в конце и только без «СТОП»: старый не должен пережить этот запуск.
  await rm(planPath, { force: true });
  const check = (title: string): ReleaseCheck => {
    const c: ReleaseCheck = { title, problems: [], notes: [] };
    report.checks.push(c);
    return c;
  };

  const lockstep = check("Одна версия у трёх пакетов (ADR-0029)");
  if (versions.length !== 1) {
    lockstep.problems.push(
      `разные версии в package.json: ${PACKAGES.map((id) => `${id} ${String(manifests.get(id)?.version)}`).join(", ")} — pnpm release bump`,
    );
    return report;
  }
  if (
    version === UNRELEASED &&
    [...manifests.values()].every((m) => m.private === true)
  ) {
    report.unreleased = true;
    lockstep.notes.push(
      `пакеты ещё не выпускались: ${UNRELEASED} с private — выпуск начинается с pnpm release bump`,
    );
    return report;
  }
  if (!VERSION_FORMAT.test(version) || ORDER(version)[0] !== RELEASE_MAJOR) {
    lockstep.problems.push(
      `версия ${version}: до запуска — только ${RELEASE_MAJOR}.x вида X.Y.Z (ADR-0005)`,
    );
  } else lockstep.notes.push(`версия ${version}`);

  const fields = check(
    "Поля package.json: описание, лицензия, репозиторий, тег next",
  );
  for (const id of PACKAGES) {
    fields.problems.push(
      ...manifestProblems(id, manifests.get(id) as Manifest, {
        version,
        packed: false,
      }),
    );
  }

  const changelog = check(`Журнал изменений ${CHANGELOG_FILE}`);
  const changelogText = await readFile(join(o.root, CHANGELOG_FILE), "utf8");
  changelog.problems.push(...changelogProblems(changelogText, version));
  if (changelog.problems.length === 0)
    changelog.notes.push(`раздел ${version} на месте`);

  // Строки подключения: одна версия и один хэш верного вида во всех файлах.
  const lines = check(
    "Скрипт тега в README и HTML-примере: адрес и хэш integrity",
  );
  const integrities = new Set<string>();
  for (const path of SCRIPT_LINE_FILES) {
    const refs = scriptRefs(await readFile(join(o.root, path), "utf8"));
    if (refs.tags.length === 0) {
      lines.problems.push(`${path}: нет строки подключения скрипта тега`);
    }
    const other = [...new Set(refs.versions)].filter((v) => v !== version);
    if (other.length > 0) {
      lines.problems.push(
        `${path}: в адресе скрипта версия ${other.join(", ")}, а выпуск — ${version}`,
      );
    }
    for (const ref of refs.tags) {
      if (ref.integrity === undefined) {
        lines.problems.push(`${path}: у строки подключения нет integrity`);
      } else if (!SRI_FORMAT.test(ref.integrity)) {
        lines.problems.push(
          `${path}: integrity «${ref.integrity}» — не SHA-384`,
        );
      } else integrities.add(ref.integrity);
      if (ref.attributes.replace(/\s*integrity="[^"]*"/, "").trim() !== "") {
        lines.problems.push(
          `${path}: в строке подключения лишнее — ${ref.attributes}`,
        );
      }
    }
  }
  if (integrities.size > 1) {
    lines.problems.push(
      `хэши в строках разные: ${[...integrities].join(", ")}`,
    );
  }
  const readme =
    integrities.size === 1 ? ([...integrities][0] as string) : undefined;

  // Скрипт тега — свежей сборкой: он попадёт в архив тега, а с ним сверяется хэш README.
  log("Собираю скрипт тега…");
  const build = await (o.buildScript ?? buildScript)(o.root);
  const local = sri(build.body);
  report.script = {
    integrity: local,
    ...(readme === undefined ? {} : { readme }),
    bytes: build.body.length,
    gzipBytes: build.gzipBytes,
  };

  log("Упаковываю пакеты (pnpm pack)…");
  const packs = await (o.pack ?? packPackages)(o.root, o.outDir);
  const archives = check(
    "Архивы: только package.json, README, LICENSE и dist/",
  );
  const packed = packVerdict(packs);
  if (packed.ok === false) archives.problems.push(packed.note);
  const license = await readFile(join(o.root, "LICENSE"));
  const contents = new Map<PackageId, Map<string, Buffer>>();
  for (const pack of packs) {
    const entry = report.packages.find((e) => e.id === pack.id) as ReleaseEntry;
    entry.file = basename(pack.file);
    entry.integrity = pack.integrity;
    entry.bytes = pack.bytes;
    entry.files = pack.files;
    entry.problems.push(
      ...manifestProblems(pack.id, pack.manifest, { version, packed: true }),
    );
    const missing = manifestPaths(pack.manifest).filter(
      (p) => !pack.files.includes(p),
    );
    if (missing.length > 0) {
      entry.problems.push(
        `в архиве нет файлов из package.json: ${missing.join(", ")}`,
      );
    }
    const sources = (
      await listFiles(join(o.root, "packages", pack.id, "src"))
    ).map((f) => `src/${f}`);
    entry.problems.push(...distProblems(pack.name, pack.files, sources));
    const files = (await tarballContents(pack.file, () => true)).contents;
    contents.set(pack.id, files);
    if (!files.get("LICENSE")?.equals(license)) {
      entry.problems.push("LICENSE в архиве — не LICENSE репозитория");
    }
    const ownReadme = await readFile(
      join(o.root, "packages", pack.id, "README.md"),
    ).catch(() => undefined);
    if (ownReadme === undefined || !files.get("README.md")?.equals(ownReadme)) {
      entry.problems.push(
        `в архиве нет README.md пакета (packages/${pack.id}/README.md)`,
      );
    }
    if (pack.id === "icon") {
      const script = files.get(SCRIPT_PATH);
      if (script === undefined)
        entry.problems.push(`в архиве нет ${SCRIPT_PATH}`);
      else if (sri(script) !== local) {
        entry.problems.push(
          `${SCRIPT_PATH} в архиве — не свежая сборка скрипта`,
        );
      }
    }
  }

  log("Сверяюсь с реестром npm — только чтение…");
  const docs = new Map<PackageId, Packument | undefined>();
  for (const entry of report.packages) {
    const p = await o.registry.packument(entry.name);
    docs.set(entry.id, p);
    const state = registryState(p, version, first, tag);
    entry.base = state.base;
    if (state.problem) entry.problems.push(state.problem);
    if (state.action) entry.action = state.action;
  }

  // Разделы журнала ниже первого — только вышедшие версии, в том числе снятые: иначе в журнале
  // осталась версия, которой нет в npm, — выпуск передумали, а раздел забыли.
  const iconDoc = docs.get("icon");
  const phantom = changelogSections(changelogText)
    .sections.slice(1)
    .map((s) => s.version)
    .filter((v) => !(iconDoc?.versions.has(v) || iconDoc?.times.has(v)));
  if (phantom.length > 0) {
    changelog.problems.push(
      `журнал: разделы ${phantom.join(", ")} — этих версий нет в npm: перенесите их текст в раздел ${version} и уберите`,
    );
  }

  const actions = report.packages.map((e) => e.action);
  const published = report.packages.filter((e) => e.action === "published");
  const pending = report.packages.filter(
    (e) => e.action !== undefined && e.action !== "published",
  );
  // Вышла часть пакетов (сбой посередине): остальные можно выпустить, только если вышедшие — эта же
  // сборка файл в файл. Иначе тег и React ушли бы с другим ядром.
  if (published.length > 0 && pending.length > 0) {
    for (const entry of published) {
      const doc = docs.get(entry.id)?.versions.get(version);
      const ours = contents.get(entry.id);
      if (doc === undefined || ours === undefined) continue;
      const theirs = await o.registry.files(doc);
      const same =
        theirs.size === ours.size &&
        [...ours].every(([path, data]) => {
          const got = theirs.get(path);
          return got !== undefined && Buffer.from(got).equals(data);
        });
      if (same) {
        entry.notes.push(
          `${version} уже в npm и совпадает со сборкой файл в файл — запуск выпустит остальные`,
        );
      } else {
        entry.problems.push(
          `в npm уже есть ${entry.name}@${version} с другим содержимым — поднимите версию всем трём: pnpm release bump`,
        );
      }
    }
  }

  // Хэш README: версия не вышла — хэш свежей сборки; вышла — хэш скрипта опубликованного архива.
  const hash = check("Хэш скрипта в README");
  const iconEntry = report.packages.find(
    (e) => e.id === "icon",
  ) as ReleaseEntry;
  if (iconEntry.action === "published") {
    const doc = docs.get("icon")?.versions.get(version);
    const files = doc === undefined ? undefined : await o.registry.files(doc);
    const script = files?.get(SCRIPT_PATH);
    if (script === undefined) {
      hash.problems.push(
        `в опубликованном ${iconEntry.name}@${version} нет ${SCRIPT_PATH}`,
      );
    } else {
      report.script.published = sri(script);
      if (readme !== undefined && readme !== report.script.published) {
        hash.problems.push(
          `хэш в README (${readme}) — не хэш скрипта ${version} в npm (${report.script.published})`,
        );
      } else hash.notes.push(`совпадает со скриптом ${version} в npm`);
    }
  } else if (readme !== undefined) {
    if (readme !== local) {
      hash.problems.push(
        `хэш в README (${readme}) не совпадает со свежей сборкой (${local}) — pnpm release bump без версии обновит его`,
      );
    } else hash.notes.push("совпадает со свежей сборкой скрипта");
  }

  const awaiting = actions.includes("awaiting");
  for (const entry of report.packages) {
    entry.publish =
      !awaiting && (entry.action === "new" || entry.action === "release");
    if (entry.action === "awaiting") {
      entry.notes.push(
        "пакета нет в npm: первую версию выпускает ручной запуск «Выпуска пакетов» с «Первой публикацией» и временным токеном (ADR-0051)",
      );
    } else if (awaiting && entry.action !== "published") {
      entry.notes.push(
        "ждёт первой публикации остальных: пакеты выходят вместе",
      );
    }
    if (entry.action === "published" && pending.length === 0) {
      entry.notes.push(`${version} уже в npm — публиковать нечего`);
    }
  }

  if (!releaseStop(report)) {
    const plan: ReleasePlan = {
      version,
      tag,
      first,
      commit: report.commit,
      // Хэш README: его сверяет с jsDelivr «Проверка». У выпуска он равен свежей сборке — это выше.
      script: { path: SCRIPT_PATH, integrity: readme ?? local },
      packages: report.packages.map((e) => ({
        id: e.id,
        name: e.name,
        version: e.version,
        action: e.action as ReleaseAction,
        base: e.base,
        publish: e.publish,
        file: e.file as string,
        integrity: e.integrity as string,
        files: e.files,
      })),
    };
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    report.planned = report.packages.some((e) => e.publish);
  }
  return report;
}

/** План с диска для «Проверки»: поля сверяются, иначе — ошибка с путём. */
export async function readReleasePlan(path: string): Promise<ReleasePlan> {
  let plan: ReleasePlan;
  try {
    plan = JSON.parse(await readFile(path, "utf8")) as ReleasePlan;
  } catch {
    throw new Error(
      `план ${path} не читается — его пишет pnpm release prepare`,
    );
  }
  const good =
    typeof plan.version === "string" &&
    typeof plan.tag === "string" &&
    typeof plan.script?.integrity === "string" &&
    Array.isArray(plan.packages) &&
    isDeepStrictEqual(
      plan.packages.map((p) => p.id),
      [...PACKAGES],
    ) &&
    plan.packages.every(
      (p) =>
        p.name === packageName(p.id) &&
        p.version === plan.version &&
        typeof p.integrity === "string" &&
        typeof p.publish === "boolean",
    );
  if (!good)
    throw new Error(
      `план ${path} не по форме — его пишет pnpm release prepare`,
    );
  return plan;
}
