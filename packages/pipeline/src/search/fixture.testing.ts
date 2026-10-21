import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SearchFile } from "@iconavo-ui/schema";
import { canonicalJson } from "../build/json.js";
import type { LoadedSet } from "../enrich/run.js";
import { fingerprint } from "../metadata/fingerprint.js";
import { licenseHash } from "../metadata/license.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import {
  type SourceConfig,
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";

/** Иконка тестового набора: имя, теги и синонимы; без синонимов — иконка без описаний. */
export interface DemoIcon {
  name: string;
  tags?: string[];
  ru?: string[];
  en?: string[];
  /** Своё тело: у разных иконок разные отпечатки. */
  body?: string;
}

export interface DemoSet {
  id: string;
  icons: DemoIcon[];
  /** Карта суффиксов вариантов (ADR-0002): "" — основной вариант. */
  suffixes?: Record<string, string>;
  /** Алиас → родитель. */
  aliases?: Record<string, string>;
}

export function demoConfig(id: string): SourceConfig {
  return sourceConfigSchema.parse({
    id,
    name: `Demo ${id}`,
    author: { name: "Demo" },
    source: { type: "npm", package: `${id}-icons` },
    svgFolders: [{ path: "icons" }],
    palette: "monochrome",
    grid: 24,
    license: {
      spdx: "MIT",
      file: "LICENSE",
      confirmed: licenseHash("MIT", "MIT License"),
    },
  } satisfies SourceConfigInput);
}

const bodyOf = (icon: DemoIcon, i: number) =>
  icon.body ?? `<path d="M${i} 0h1v${i + 1}H${i}z"/>`;

const iconOf = (icon: DemoIcon, i: number): NormalizedIcon => ({
  body: bodyOf(icon, i),
  width: 24,
  height: 24,
});

/** Синонимы до пяти: схема требует 5–10. */
const fill = (list: string[], prefix: string) =>
  [...list, ...["a", "b", "c", "d", "e"].map((x) => `${prefix}${x}`)].slice(
    0,
    Math.max(5, list.length),
  );

function searchOf(set: DemoSet): SearchFile {
  return {
    prefix: set.id,
    icons: Object.fromEntries(
      set.icons.map((icon, i) => {
        const entry: SearchFile["icons"][string] = {
          fingerprint: fingerprint(set.id, icon.name, iconOf(icon, i)),
          tags: icon.tags ?? [],
        };
        if (icon.ru || icon.en) {
          entry.ru = {
            description: `ru ${icon.name}.`,
            synonyms: fill(icon.ru ?? [], "zzru"),
          };
          entry.en = {
            description: `en ${icon.name}.`,
            synonyms: fill(icon.en ?? [], "zzen"),
          };
          entry.promptVersion = 1;
        }
        return [icon.name, entry];
      }),
    ),
  };
}

/** Набор в памяти — как его отдаёт loadSet. */
export function loadedSet(set: DemoSet): LoadedSet {
  return {
    search: searchOf(set),
    icons: new Map(set.icons.map((icon, i) => [icon.name, iconOf(icon, i)])),
    suffixes: Object.keys(set.suffixes ?? {}),
    aliases: new Map(Object.entries(set.aliases ?? {})),
  };
}

/** Файлы набора в dataDir/{id}/: icons.json, search.json, metadata.json, info.json. */
export async function writeDemoSet(
  dataDir: string,
  set: DemoSet,
): Promise<void> {
  const dir = join(dataDir, set.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "icons.json"),
    canonicalJson({
      prefix: set.id,
      icons: Object.fromEntries(
        set.icons.map((icon, i) => [icon.name, { body: bodyOf(icon, i) }]),
      ),
      ...(set.aliases
        ? {
            aliases: Object.fromEntries(
              Object.entries(set.aliases).map(([a, parent]) => [a, { parent }]),
            ),
          }
        : {}),
      width: 24,
      height: 24,
    }),
  );
  await writeFile(
    join(dir, "search.json"),
    canonicalJson(searchOf(set) as never),
  );
  await writeFile(
    join(dir, "metadata.json"),
    canonicalJson(set.suffixes ? { suffixes: set.suffixes } : {}),
  );
  await writeFile(
    join(dir, "info.json"),
    canonicalJson({ version: `v-${set.id}` }),
  );
}
