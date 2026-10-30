// package.json пакетов для разработчиков (ADR-0051): поля, которые npm показывает и сверяет с подписью
// provenance, одна версия у трёх пакетов и ядро в зависимостях ровно этой версии, ни одного скрипта,
// который npm запустил бы сам. Те же правила — у package.json в репозитории и у package.json в архиве,
// каким его увидит npm: pnpm pack заменяет workspace:* точной версией.

import { isDeepStrictEqual } from "node:util";
import {
  fixedFields,
  LIFECYCLE_SCRIPTS,
  type PackageId,
  packageName,
  SCRIPT_PATH,
} from "./config.js";

export type Manifest = Record<string, unknown>;

/** Что не так с package.json пакета для выпуска этой версии. */
export function manifestProblems(
  id: PackageId,
  m: Manifest,
  o: { version: string; packed: boolean },
): string[] {
  const where = o.packed
    ? `${packageName(id)} в архиве`
    : `packages/${id}/package.json`;
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${where}: ${text}`);
  if (m.name !== packageName(id)) say(`имя ${String(m.name)}`);
  if (m.version !== o.version) {
    say(`версия ${String(m.version)}, а выпуск — ${o.version}`);
  }
  if (m.private === true) say("private: true — npm его не опубликует");
  for (const [field, want] of Object.entries(fixedFields(id))) {
    if (!isDeepStrictEqual(m[field], want)) {
      say(
        `поле ${field} — ${JSON.stringify(m[field])}, нужно ${JSON.stringify(want)}`,
      );
    }
  }
  if (typeof m.description !== "string" || m.description.trim() === "") {
    say("нет описания description");
  }
  const keywords = m.keywords;
  if (
    !Array.isArray(keywords) ||
    keywords.length === 0 ||
    !keywords.every((k) => typeof k === "string" && /^[a-z0-9-]+$/.test(k))
  ) {
    say("keywords — список слов строчными латинскими буквами");
  }
  const exportsField = m.exports as Record<string, unknown> | undefined;
  if (exportsField?.["./package.json"] !== "./package.json") {
    say("в exports нет «./package.json»");
  }
  const scripts = (m.scripts ?? {}) as Record<string, unknown>;
  const lifecycle = LIFECYCLE_SCRIPTS.filter((s) => s in scripts);
  if (lifecycle.length > 0) {
    say(`скрипты, которые npm запустит сам: ${lifecycle.join(", ")}`);
  }
  for (const field of [
    "bin",
    "bundleDependencies",
    "bundledDependencies",
    "optionalDependencies",
  ]) {
    if (field in m) say(`поле ${field} — его у наших пакетов нет`);
  }
  // Ядро — точной версией выпуска: три пакета выходят вместе (ADR-0029), в рабочем пространстве — workspace:*.
  const want =
    id === "core"
      ? {}
      : { "@iconavo-ui/core": o.packed ? o.version : "workspace:*" };
  if (!isDeepStrictEqual(m.dependencies ?? {}, want)) {
    say(
      `dependencies — ${JSON.stringify(m.dependencies ?? {})}, нужно ${JSON.stringify(want)}`,
    );
  }
  return problems;
}

/** Файлы, на которые ссылается package.json: exports, types, main и sideEffects — без «./». */
export function manifestPaths(m: Manifest): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("./")) {
      paths.add(value.slice(2));
    } else if (Array.isArray(value)) value.forEach(add);
    else if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) add(v);
    }
  };
  for (const field of ["exports", "types", "main", "module", "sideEffects"]) {
    add(m[field]);
  }
  return [...paths].sort();
}

/**
 * Сборка без забытых файлов: у каждого .js и .d.ts в dist есть исходник в src — tsc -b не удаляет
 * вывод удалённого модуля, и он ушёл бы в npm. Скрипт тега для страниц без сборщика собирает rolldown.
 */
export function distProblems(
  name: string,
  files: readonly string[],
  sources: readonly string[],
): string[] {
  const have = new Set(sources);
  const orphans = files.filter((f) => {
    if (!f.startsWith("dist/") || f === SCRIPT_PATH) return false;
    const stem = /^dist\/(.+?)(\.d\.ts|\.js)$/.exec(f)?.[1];
    if (stem === undefined) return true;
    return !have.has(`src/${stem}.ts`) && !have.has(`src/${stem}.tsx`);
  });
  return orphans.length === 0
    ? []
    : [
        `${name}: в dist файлы без исходника — ${orphans.slice(0, 5).join(", ")}: удалите dist и tsconfig.tsbuildinfo пакета и соберите заново`,
      ];
}
