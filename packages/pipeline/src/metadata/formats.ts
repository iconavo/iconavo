// Метаданные автора (ADR-0017): у каждого формата свой читатель. Результат — теги и категории по пути
// SVG в источнике, как у автора; нормализует их run.ts. Ошибка чтения — исключение: автор, видимо,
// поменял формат, и набор останавливается.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NAME_PATTERN } from "@iconavo-ui/schema";
import { z } from "zod";
import type { MetadataFormat } from "../sources/config.js";
import { parsePhosphorModule } from "./phosphor.js";

export interface AuthorMetadata {
  /** Теги как у автора: бывают числа и null — их разбирает authorTags. */
  tags: readonly unknown[];
  /** Названия категорий как у автора. */
  categories: readonly string[];
  /**
   * Прежние имена иконки у автора — путями SVG, как если бы файл лежал под старым именем: имя
   * получается по правилам папки набора и становится алиасом (ADR-0018). Нет — прежних имён нет.
   */
  aliases?: readonly string[];
}

/** Читатель формата: путь SVG в источнике → теги и категории. Иконки без метаданных в ответ не попадают. */
export type MetadataReader = (
  dir: string,
  svgFiles: readonly string[],
) => Promise<Map<string, AuthorMetadata>>;

/** Файл источника как текст; нет файла — undefined. */
async function readSource(
  dir: string,
  path: string,
): Promise<string | undefined> {
  try {
    return (await readFile(join(dir, path), "utf8")).replace(/^﻿/, "");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** JSON-файл источника, проверенный схемой; нет файла — undefined. */
async function readJson<T>(
  dir: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const text = await readSource(dir, path);
  if (text === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} — не JSON: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${path}: ${issue?.path.join(".") || "(файл)"} — ${issue?.message ?? "не по формату"}`,
    );
  }
  return parsed.data;
}

const stem = (file: string) =>
  (file.split("/").at(-1) ?? file).replace(/\.svg$/i, "");

/** Путь SVG с другим именем файла в той же папке: прежнее имя иконки. */
function sibling(file: string, name: string): string {
  if (name === "" || /[/\\]/.test(name)) {
    throw new Error(`прежнее имя «${name}» — не имя файла`);
  }
  return `${file.slice(0, file.lastIndexOf("/") + 1)}${name}.svg`;
}

const lucideIcon = z.looseObject({
  tags: z.array(z.unknown()).default([]),
  categories: z.array(z.string()).default([]),
  // Прежние имена: строкой или объектом с причиной (alias.name, alias.typo, alias.duplicate).
  aliases: z
    .array(z.union([z.string(), z.looseObject({ name: z.string() })]))
    .default([]),
});
type LucideIcon = z.output<typeof lucideIcon>;
const lucideCategory = z.looseObject({ title: z.string().min(1) });
const lucideGroup = z.looseObject({ tags: z.array(z.string()) });

/**
 * Ссылки в метаданных Lucide (с 1.65.0): `$extends:{иконка}` в тегах и категориях — список той иконки,
 * `$group:{группа}` только в тегах — теги из `groups/{группа}.json`.
 */
const EXTENDS = "$extends:";
const GROUP = "$group:";
/** Любая ссылка Lucide — «$» и буква; просто «$» — обычный тег (знак доллара). */
const MARKER = /^\$[a-zA-Z]/;

/**
 * Lucide: `icons/{имя}.json` рядом с иконкой; слаг категории → название из `categories/{слаг}.json`;
 * прежние имена — поле aliases. Ссылки раскрываются, как у сборки Lucide (resolveMetadataExtends):
 * на месте ссылки — её список, по цепочке до конца, без повторов (первое вхождение остаётся).
 */
const lucide: MetadataReader = async (dir, svgFiles) => {
  const titles = new Map<string, string>();
  const title = async (slug: string) => {
    const known = titles.get(slug);
    if (known !== undefined) return known;
    // Слаг становится путём к файлу, поэтому только по правилу имён: никаких «..».
    if (!NAME_PATTERN.test(slug)) {
      throw new Error(`категория «${slug}» — не слаг`);
    }
    const path = `categories/${slug}.json`;
    const category = await readJson(dir, path, lucideCategory);
    if (!category) throw new Error(`нет ${path} для категории «${slug}»`);
    titles.set(slug, category.title);
    return category.title;
  };

  const groups = new Map<string, readonly string[]>();
  const groupTags = async (entry: string, from: string) => {
    const name = entry.slice(GROUP.length);
    const known = groups.get(name);
    if (known !== undefined) return known;
    // Имя группы тоже становится путём к файлу.
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`${from}: «${entry}» — не имя группы`);
    }
    const path = `groups/${name}.json`;
    const group = await readJson(dir, path, lucideGroup);
    if (!group) throw new Error(`${from}: «${entry}» — нет ${path}`);
    groups.set(name, group.tags);
    return group.tags;
  };

  // Метаданные по пути JSON со ссылками, уже раскрытыми; undefined — файла нет. chain — файлы, которые
  // раскрываются сейчас: встретить в ней тот же файл снова — ссылки идут по кругу.
  const resolved = new Map<string, LucideIcon | undefined>();
  const chain = new Set<string>();
  const resolve = async (path: string): Promise<LucideIcon | undefined> => {
    if (resolved.has(path)) return resolved.get(path);
    if (chain.has(path)) {
      throw new Error(`${path}: ссылки «${EXTENDS}» идут по кругу`);
    }
    chain.add(path);
    const expand = async (
      list: readonly unknown[],
      field: "tags" | "categories",
    ) => {
      const out: unknown[] = [];
      for (const entry of list) {
        if (typeof entry === "string" && entry.startsWith(EXTENDS)) {
          const name = entry.slice(EXTENDS.length);
          if (!NAME_PATTERN.test(name)) {
            throw new Error(`${path}: «${entry}» — не имя иконки`);
          }
          const parentPath = `${path.slice(0, path.lastIndexOf("/") + 1)}${name}.json`;
          const parent = await resolve(parentPath);
          if (!parent) {
            throw new Error(`${path}: «${entry}» — нет ${parentPath}`);
          }
          out.push(...parent[field]);
        } else if (
          field === "tags" &&
          typeof entry === "string" &&
          entry.startsWith(GROUP)
        ) {
          out.push(...(await groupTags(entry, path)));
        } else {
          out.push(entry);
        }
      }
      return [...new Set(out)];
    };
    const meta = await readJson(dir, path, lucideIcon);
    const result = meta && {
      ...meta,
      tags: await expand(meta.tags, "tags"),
      // Категории у автора — строки, и ссылки приносят строки.
      categories: (await expand(meta.categories, "categories")) as string[],
    };
    // Незнакомая ссылка — автор снова поменял формат: служебная строка не должна стать тегом.
    // В категориях её останавливает проверка слага.
    const stray = result?.tags.find(
      (t) => typeof t === "string" && MARKER.test(t),
    );
    if (stray !== undefined) {
      throw new Error(`${path}: незнакомая ссылка «${String(stray)}»`);
    }
    chain.delete(path);
    resolved.set(path, result);
    return result;
  };

  const out = new Map<string, AuthorMetadata>();
  for (const file of svgFiles) {
    const meta = await resolve(file.replace(/\.svg$/i, ".json"));
    if (!meta) continue;
    const categories: string[] = [];
    for (const slug of meta.categories) categories.push(await title(slug));
    const aliases = meta.aliases.map((a) =>
      sibling(file, typeof a === "string" ? a : a.name),
    );
    out.set(file, {
      tags: meta.tags,
      categories,
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  return out;
};

const tablerFile = z.record(
  z.string(),
  z.looseObject({
    category: z.string().optional(),
    tags: z.array(z.unknown()).default([]),
  }),
);

/** Tabler: один `icons.json` по базовому имени; контур и заливка (папка filled) берут одну запись. */
const tabler: MetadataReader = async (dir, svgFiles) => {
  const icons = await readJson(dir, "icons.json", tablerFile);
  if (!icons) throw new Error("нет icons.json");
  const out = new Map<string, AuthorMetadata>();
  for (const file of svgFiles) {
    const key = stem(file);
    const meta = Object.hasOwn(icons, key) ? icons[key] : undefined;
    if (!meta) continue;
    out.set(file, {
      // Теги Tabler собраны из YAML, где слово null стало значением null (number-0): возвращаем слово.
      tags: meta.tags.map((t) => (t === null ? "null" : t)),
      categories: meta.category ? [meta.category] : [],
    });
  }
  return out;
};

/**
 * Phosphor: массив иконок в `dist/index.mjs`; файл `assets/{начертание}/{имя}-{начертание}.svg`.
 * Прежнее имя (поле alias) у автора одно на иконку — оно получает тот же суффикс начертания.
 */
const phosphor: MetadataReader = async (dir, svgFiles) => {
  const path = "dist/index.mjs";
  const text = await readSource(dir, path);
  if (text === undefined) throw new Error(`нет ${path}`);
  let entries: ReturnType<typeof parsePhosphorModule>;
  try {
    entries = parsePhosphorModule(text);
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const out = new Map<string, AuthorMetadata>();
  for (const file of svgFiles) {
    const weight = file.split("/").at(-2) ?? "";
    const s = stem(file);
    const name =
      weight !== "regular" && s.endsWith(`-${weight}`)
        ? s.slice(0, -(weight.length + 1))
        : s;
    const entry = byName.get(name);
    if (!entry) continue;
    out.set(file, {
      tags: entry.tags,
      categories: entry.categories,
      ...(entry.alias === undefined
        ? {}
        : {
            aliases: [sibling(file, `${entry.alias}${s.slice(name.length)}`)],
          }),
    });
  }
  return out;
};

const fluentMetadata = z.looseObject({
  keywords: z.array(z.unknown()).default([]),
  group: z.string().optional(),
});

/**
 * Fluent Emoji: `assets/{эмодзи}/metadata.json` — на уровень выше папки Flat, а у эмодзи с оттенками
 * кожи — на два (`assets/{эмодзи}/{оттенок}/Flat`): ключевые слова общие для всех оттенков.
 */
const fluentEmoji: MetadataReader = async (dir, svgFiles) => {
  const folders = new Map<string, AuthorMetadata | undefined>();
  const out = new Map<string, AuthorMetadata>();
  for (const file of svgFiles) {
    const parts = file.split("/");
    if (parts[0] !== "assets" || parts.length < 4) continue;
    const path = `assets/${parts[1]}/metadata.json`;
    if (!folders.has(path)) {
      const meta = await readJson(dir, path, fluentMetadata);
      folders.set(
        path,
        meta && {
          tags: meta.keywords,
          categories: meta.group ? [meta.group] : [],
        },
      );
    }
    const meta = folders.get(path);
    if (meta) out.set(file, meta);
  }
  return out;
};

export const READERS: Record<MetadataFormat, MetadataReader> = {
  lucide,
  tabler,
  phosphor,
  "fluent-emoji": fluentEmoji,
};
