// Выбор версии пакета (ADR-0005, ADR-0026). Сравнение — с версией под тегом в npm: тот же отпечаток —
// публиковать нечего; иначе новые имена дают среднюю цифру, остальное — последнюю, смена формата —
// первую. Номер считается от самой старшей когда-либо вышедшей версии: npm не даёт занять номер снятой.
// Имя, пропавшее из опубликованной версии, и данные в npm новее этой сборки — «СТОП».

import { compareVersions, parseVersion } from "../sources/version.js";
import { NPM_NAMES_LIMIT } from "./config.js";
import type { NpmVersionDoc, Packument } from "./registry.js";

export type NpmAction =
  | "new"
  | "awaiting"
  | "unchanged"
  | "major"
  | "minor"
  | "patch";

/** Номер вида 1.2.3: предварительные версии и прочее подготовка не считает. */
const STABLE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const isStable = (version: string) => STABLE.test(version);

function compareStable(a: string, b: string): number {
  return compareVersions(parseVersion(a) ?? [], parseVersion(b) ?? []);
}

/** Все номера, которые когда-либо выходили, включая снятые: по возрастанию. */
export function everPublished(p: Packument): string[] {
  const all = new Set<string>([...p.versions.keys(), ...p.times.keys()]);
  return [...all].filter(isStable).sort(compareStable);
}

/** Первая вышедшая версия — по времени выхода; ей одной можно выйти токеном. */
export function firstPublished(p: Packument): string | undefined {
  let first: { version: string; time: number } | undefined;
  for (const [version, time] of p.times) {
    const t = Date.parse(time);
    if (!isStable(version) || !Number.isFinite(t)) continue;
    if (!first || t < first.time) first = { version, time: t };
  }
  return first?.version;
}

/** Следующий номер: формат новее — N.0.0; новые имена — средняя цифра; иначе — последняя. */
export function nextVersion(
  highest: string,
  kind: "minor" | "patch",
  formatMajor: number,
): { version: string; action: "major" | "minor" | "patch" } {
  const [major = 0, minor = 0, patch = 0] = parseVersion(highest) ?? [];
  if (major < formatMajor) {
    return { version: `${formatMajor}.0.0`, action: "major" };
  }
  return kind === "minor"
    ? { version: `${major}.${minor + 1}.0`, action: "minor" }
    : { version: `${major}.${minor}.${patch + 1}`, action: "patch" };
}

/** Первый взгляд — без скачивания архива: пакета нет, отпечаток тот же или нужно сравнить имена. */
export type FirstLook =
  | { kind: "decided"; action: NpmAction; version: string; base?: string }
  | { kind: "compare"; base: NpmVersionDoc; highest: string }
  | { kind: "stop"; message: string };

export interface FirstLookInput {
  packument: Packument | undefined;
  fingerprint: string;
  tag: string;
  /** Новый пакет можно выпустить: ручной запуск с «первой публикацией». */
  allowNew: boolean;
  /** Новая версия даже без изменений — проверка доверенной публикации. */
  force: boolean;
  firstVersion: string;
  formatMajor: number;
  /** Версии набора из журнала: текущая и прошлые. */
  releases: readonly string[];
}

export function firstLook(input: FirstLookInput): FirstLook {
  const p = input.packument;
  if (p === undefined) {
    return {
      kind: "decided",
      action: input.allowNew ? "new" : "awaiting",
      version: input.firstVersion,
    };
  }
  const published = everPublished(p);
  const highest = published.at(-1);
  if (highest === undefined) {
    return {
      kind: "stop",
      message: `пакет ${p.name} есть в npm, но без версий вида 1.2.3 — разберитесь на npmjs.com вручную`,
    };
  }
  const [highestMajor = 0] = parseVersion(highest) ?? [];
  if (highestMajor > input.formatMajor) {
    return {
      kind: "stop",
      message: `в npm уже версия ${highest}, а формат пакета в конвейере — ${input.formatMajor}: сборка старее того, что опубликовано`,
    };
  }
  // Сравниваем с тем, что сейчас отдаётся под тегом; тега нет — со старшей из живых версий.
  const live = [...p.versions.keys()].filter(isStable).sort(compareStable);
  const tagged = p.distTags[input.tag];
  const baseVersion =
    tagged !== undefined && p.versions.has(tagged) ? tagged : live.at(-1);
  const base =
    baseVersion === undefined ? undefined : p.versions.get(baseVersion);
  if (base === undefined) {
    return {
      kind: "stop",
      message: `у пакета ${p.name} в npm нет ни одной живой версии — разберитесь на npmjs.com вручную`,
    };
  }
  if (base.fingerprint === undefined || base.setVersion === undefined) {
    return {
      kind: "stop",
      message: `версия ${base.version} в npm без отметки iconavo в package.json: её выложил не этот конвейер`,
    };
  }
  if (!input.releases.includes(base.setVersion)) {
    return {
      kind: "stop",
      message: `в npm версия набора ${base.setVersion}, а в журнале этой сборки её нет: в npm данные новее — соберите от свежего main`,
    };
  }
  if (base.fingerprint === input.fingerprint) {
    return input.force
      ? {
          kind: "decided",
          ...nextVersion(highest, "patch", input.formatMajor),
          base: base.version,
        }
      : {
          kind: "decided",
          action: "unchanged",
          version: base.version,
          base: base.version,
        };
  }
  return { kind: "compare", base, highest };
}

export type Decision =
  | {
      kind: "decided";
      action: "major" | "minor" | "patch";
      version: string;
      added: string[];
    }
  | { kind: "stop"; message: string };

/** Решение после сравнения имён: пропавшее имя — «СТОП» (ADR-0005), новые — средняя цифра. */
export function compareNames(input: {
  base: NpmVersionDoc;
  highest: string;
  publishedNames: ReadonlySet<string>;
  names: ReadonlySet<string>;
  formatMajor: number;
}): Decision {
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const missing = [...input.publishedNames]
    .filter((n) => !input.names.has(n))
    .sort(order);
  if (missing.length > 0) {
    const shown = missing.slice(0, NPM_NAMES_LIMIT).join(", ");
    return {
      kind: "stop",
      message: `из опубликованной версии ${input.base.version} пропали имена (${missing.length}): ${shown}${missing.length > NPM_NAMES_LIMIT ? "…" : ""} — имена не удаляются (ADR-0005)`,
    };
  }
  const added = [...input.names]
    .filter((n) => !input.publishedNames.has(n))
    .sort(order);
  return {
    kind: "decided",
    ...nextVersion(
      input.highest,
      added.length > 0 ? "minor" : "patch",
      input.formatMajor,
    ),
    added,
  };
}
