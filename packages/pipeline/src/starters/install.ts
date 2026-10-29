// Рабочая копия примера (ADR-0050): папка копируется в .cache/starters, зависимости @iconavo-ui/* в её
// package.json заменяются архивами этой ветки, и npm ставит её, как поставит StackBlitz или
// разработчик. Ядро — прямой зависимостью из своего архива: пакеты тега и React просят его точной
// версией, и npm берёт уже поставленное, а не идёт в реестр. Не вышло — npm упадёт на 404 реестра, а
// не поставит молча чужое.

import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { scriptRefs, setScriptRefs, sri } from "../release/text.js";
import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import type { Pack } from "./pack.js";

export type Manifest = Record<string, unknown> & {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Наши пакеты среди зависимостей примера. */
export const ourDependencies = (manifest: Manifest) =>
  Object.keys(manifest.dependencies ?? {}).filter((n) =>
    n.startsWith("@iconavo-ui/"),
  );

/** Путь к архиву от папки копии — со слешами, как в package.json. */
const fileSpec = (from: string, file: string) =>
  `file:${relative(from, file).split(sep).join("/")}`;

/**
 * package.json копии: @iconavo-ui/* — архивы этой ветки, ядро — прямой зависимостью. Пакет, которого
 * нет среди архивов, — ошибка: пример просит то, чего проверка не собирала.
 */
export function rewriteManifest(
  manifest: Manifest,
  packs: Pack[],
  dir: string,
): Manifest {
  const deps = { ...(manifest.dependencies ?? {}) };
  const ours = ourDependencies(manifest);
  if (ours.length === 0) return manifest;
  for (const name of [...ours, "@iconavo-ui/core"]) {
    const pack = packs.find((p) => p.name === name);
    if (!pack) throw new Error(`пример просит ${name}, а его архива нет`);
    deps[name] = fileSpec(dir, pack.file);
  }
  return { ...manifest, dependencies: deps };
}

/** Что в копию не идёт: это делают npm и сборка. */
const SKIP = new Set(["node_modules", ".next", "dist", "next-env.d.ts"]);

/** Свежая копия примера. */
export async function copyStarter(source: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await cp(source, dest, {
    recursive: true,
    filter: (path) =>
      !relative(source, path)
        .split(sep)
        .some((part) => SKIP.has(part)),
  });
}

/**
 * Переписать package.json копии под архивы этой ветки. lock-файл примера описывает версии из npm —
 * с архивами он не сходится, поэтому в копии его нет.
 */
export async function useLocalPacks(dir: string, packs: Pack[]): Promise<void> {
  const path = join(dir, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
  await writeFile(
    path,
    `${JSON.stringify(rewriteManifest(manifest, packs, dir), null, 2)}\n`,
    "utf8",
  );
  await rm(join(dir, "package-lock.json"), { force: true });
}

/**
 * HTML-пример на скрипте этой ветки: в строке подключения копии — хэш этого файла (ADR-0051). С хэшем
 * из README браузер отверг бы скрипт после первой же правки кода; сам хэш README проверяет --npm.
 */
export async function useLocalScript(dir: string, body: Buffer): Promise<void> {
  const path = join(dir, "index.html");
  const text = await readFile(path, "utf8");
  const version = scriptRefs(text).tags[0]?.version;
  if (version === undefined) return;
  await writeFile(path, setScriptRefs(text, version, sri(body)), "utf8");
}

/** Узел дерева npm ls --all --json. */
export interface LsNode {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, LsNode>;
}

/** Все копии наших пакетов в дереве зависимостей: имя, версия, откуда. */
export function ourCopies(
  tree: LsNode,
): { name: string; version: string; resolved: string }[] {
  const found: { name: string; version: string; resolved: string }[] = [];
  const walk = (node: LsNode) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (name.startsWith("@iconavo-ui/")) {
        found.push({
          name,
          version: child.version ?? "",
          resolved: child.resolved ?? "",
        });
      }
      walk(child);
    }
  };
  walk(tree);
  return found;
}

/**
 * Установка: каждый наш пакет — ровно одной копией (в дереве npm ls повтор с той же версией — это
 * ссылка на ту же копию), версия архива, источник — наш архив; без архивов (--npm) — из реестра npm.
 */
export function installVerdict(
  tree: LsNode,
  expected: {
    name: string;
    /** Нет — любая, лишь бы одна: у --npm версию ядра задаёт пакет React. */
    version?: string;
    resolved: (r: string) => boolean;
  }[],
): Verdict {
  const copies = ourCopies(tree);
  const problems: string[] = [];
  const found: string[] = [];
  for (const want of expected) {
    const mine = copies.filter((c) => c.name === want.name);
    const versions = [...new Set(mine.map((c) => c.version))];
    if (mine.length === 0) problems.push(`${want.name}: не поставлен`);
    else if (versions.length > 1) {
      problems.push(`${want.name}: несколько копий — ${versions.join(", ")}`);
    } else if (want.version !== undefined && versions[0] !== want.version) {
      problems.push(
        `${want.name}: версия ${versions[0]}, а нужна ${want.version}`,
      );
    } else if (
      // Ссылка на уже поставленную копию (deduped) приходит без resolved — источник у самой копии.
      !mine.some((c) => c.resolved !== "") ||
      !mine.every((c) => c.resolved === "" || want.resolved(c.resolved))
    ) {
      problems.push(
        `${want.name}: поставлен не оттуда — ${mine.find((c) => c.resolved !== "")?.resolved ?? "источник неизвестен"}`,
      );
    } else {
      found.push(`${want.name}@${versions[0]}`);
    }
  }
  const unknown = copies.filter(
    (c) => !expected.some((e) => e.name === c.name),
  );
  for (const name of new Set(unknown.map((c) => c.name))) {
    problems.push(`${name}: лишний пакет`);
  }
  return problems.length === 0
    ? pass(`по одной копии: ${found.join(", ")}`)
    : fail(problems.join("; "));
}
