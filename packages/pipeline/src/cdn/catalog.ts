// Каталог наборов для edge API (шаг 2 фазы 4; ADR-0004, ADR-0022, ADR-0024): то, чего нет в файлах
// иконок, — сведения о наборе, категории, скрытые имена, алиасы и выпуски. Файлы лежат вне v/:
// info.json и metadata.json меняются и без новой версии набора (версия — отпечаток только icons.json,
// ADR-0018), а папки версий неизменяемы. Имя файла — отпечаток его содержимого, поэтому и файл каталога
// никогда не перезаписывается; новый каталог включает поле catalog манифеста, а манифест пишется
// последним. Тело /collection — готовый ответ в формате Iconify: функции не нужно его разбирать, у неё
// 10 мс процессора (ADR-0024). Здесь только чистые функции: порядок всего — по кодам символов, поэтому
// одинаковые данные дают побайтно те же файлы.

import { createHash } from "node:crypto";
import { nameSchema } from "@iconavo-ui/schema";
import { z } from "zod";
import { compactJson, type Json } from "../build/json.js";
import {
  CATALOG_DIR,
  CATALOG_HASH_LENGTH,
  CATALOG_RELEASES,
  CATALOG_RELEASES_DIR,
} from "./config.js";
import type { CatalogSet } from "./load.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Отпечаток файла каталога в его имени. */
export const catalogHashSchema = z
  .string()
  .regex(
    new RegExp(`^[0-9a-f]{${CATALOG_HASH_LENGTH}}$`),
    `отпечаток — ${CATALOG_HASH_LENGTH} символов 0-9 и a-f`,
  );

/** Сведения о наборе в формате IconifyInfo — как в ответе /collections у Iconify. */
const iconifyInfoSchema = z.strictObject({
  name: z.string().min(1),
  total: z.number().int().nonnegative(),
  /** Версия у автора: версия пакета npm или 7 символов коммита git. */
  version: z.string().min(1),
  author: z.strictObject({
    name: z.string().min(1),
    url: z.url().optional(),
  }),
  license: z.strictObject({
    title: z.string().min(1),
    spdx: z.string().min(1),
    url: z.url().optional(),
  }),
  samples: z.array(nameSchema).optional(),
  height: z.union([z.number().positive(), z.array(z.number().positive())]),
  palette: z.boolean(),
});

/** Дополнение Iconavo к license в /collection?info=true: полный текст, NOTICE и откуда он (ADR-0017). */
const licenseExtraSchema = z.strictObject({
  text: z.string().min(1),
  notice: z.string().min(1).optional(),
  source: z.url(),
  revision: z.string().min(1),
});

/** Оглавление каталога: catalog/{хэш}.json, его хэш — поле catalog манифеста. */
export const catalogIndexSchema = z.strictObject({
  /** Отпечаток файла выпусков: catalog/changelog/{хэш}.json. */
  changelog: catalogHashSchema,
  sets: z.record(
    nameSchema,
    z.strictObject({
      /** Отпечаток тела /collection: catalog/{набор}/{хэш}.json. */
      collection: catalogHashSchema,
      info: iconifyInfoSchema,
      license: licenseExtraSchema,
    }),
  ),
});

export type CatalogIndex = z.infer<typeof catalogIndexSchema>;

/** Файл каталога: ключ в хранилище catalog/…, содержимое и его SHA-256. */
export interface CatalogFile {
  key: string;
  data: Uint8Array;
  sha256: string;
}

export interface Catalog {
  /** Отпечаток оглавления — поле catalog манифеста. */
  hash: string;
  /** Тела /collection по наборам, файл выпусков и оглавление — последним: его и выгружают последним. */
  files: CatalogFile[];
}

/** catalog/{хэш}.json — оглавление. */
export const catalogIndexKey = (hash: string) => `${CATALOG_DIR}/${hash}.json`;

/** catalog/{набор}/{хэш}.json — тело /collection. */
export const collectionKey = (id: string, hash: string) =>
  `${CATALOG_DIR}/${id}/${hash}.json`;

/** catalog/changelog/{хэш}.json — выпуски всех наборов. */
export const releasesKey = (hash: string) =>
  `${CATALOG_DIR}/${CATALOG_RELEASES_DIR}/${hash}.json`;

/** Коммит git — 7 символов, как на GitHub; версия npm — как есть. */
const shortRevision = (revision: string) =>
  /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;

/** Ключ суффикса варианта у Iconify — без ведущего дефиса: «bold», а не «-bold» (ADR-0002). */
export const iconifySuffix = (suffix: string) => suffix.replace(/^-/, "");

/**
 * Тело /collection без info, как у Iconify: видимые имена — в категориях автора, остальные — в
 * uncategorized; скрытые — отдельно (по имени они работают, в каталог не попадают); алиасы — «алиас →
 * родитель». Пустые поля не пишутся.
 */
export function collectionBody(set: CatalogSet): Json {
  const { file, info, metadata } = set;
  const names = Object.keys(file.icons).sort(order);
  const hidden = names.filter((n) => file.icons[n]?.hidden === true);
  const visible = names.filter((n) => file.icons[n]?.hidden !== true);
  const categories = metadata.categories ?? {};
  const categorized = new Set(Object.values(categories).flat());
  const uncategorized = visible.filter((n) => !categorized.has(n));
  const aliases: { [key: string]: Json } = {};
  for (const [alias, entry] of Object.entries(file.aliases ?? {})) {
    aliases[alias] = entry.parent;
  }
  const suffixes: { [key: string]: Json } = {};
  for (const [suffix, title] of Object.entries(metadata.suffixes ?? {})) {
    suffixes[iconifySuffix(suffix)] = title;
  }
  const out: { [key: string]: Json } = {
    prefix: set.id,
    title: info.name,
    total: info.total,
  };
  if (Object.keys(categories).length > 0) out.categories = categories;
  if (uncategorized.length > 0) out.uncategorized = uncategorized;
  if (hidden.length > 0) out.hidden = hidden;
  if (Object.keys(aliases).length > 0) out.aliases = aliases;
  if (Object.keys(suffixes).length > 0) out.suffixes = suffixes;
  return out;
}

/** Сведения о наборе в формате IconifyInfo — для /collections и info в /collection (ADR-0017). */
export function iconifyInfo(set: CatalogSet): Json {
  const { info } = set;
  const author: { [key: string]: Json } = { name: info.author.name };
  if (info.author.url !== undefined) author.url = info.author.url;
  const license: { [key: string]: Json } = {
    title: info.license.title ?? info.license.spdx,
    spdx: info.license.spdx,
  };
  if (info.license.url !== undefined) license.url = info.license.url;
  const out: { [key: string]: Json } = {
    name: info.name,
    total: info.total,
    version: shortRevision(info.license.revision),
    author,
    license,
    height: info.height,
    palette: info.palette,
  };
  if (info.samples !== undefined) out.samples = info.samples;
  return out;
}

/** Полный текст лицензии, NOTICE, источник и ревизия — дополнение к license в /collection?info=true. */
export function licenseExtra(set: CatalogSet): Json {
  const { license } = set.info;
  const out: { [key: string]: Json } = {
    text: license.text,
    source: license.source,
    revision: license.revision,
  };
  if (license.notice !== undefined) out.notice = license.notice;
  return out;
}

/**
 * Выпуски всех наборов для /changelog (ADR-0018): записи changelog.json с префиксом набора, свежие
 * сверху; в одну секунду — по префиксу. Не больше limit.
 */
export function releasesBody(
  sets: readonly CatalogSet[],
  limit = CATALOG_RELEASES,
): Json {
  const all = sets.flatMap((set) =>
    set.changelog.releases.map((release) => ({ prefix: set.id, release })),
  );
  all.sort(
    (a, b) =>
      Date.parse(b.release.date) - Date.parse(a.release.date) ||
      order(a.prefix, b.prefix),
  );
  return {
    releases: all
      .slice(0, limit)
      .map(
        ({ prefix, release }) =>
          ({ prefix, ...release }) as unknown as { [key: string]: Json },
      ),
  };
}

/** Файл каталога из данных: компактный JSON, имя — отпечаток содержимого. */
function catalogFile(
  value: Json,
  key: (hash: string) => string,
): { hash: string; file: CatalogFile } {
  const data = new Uint8Array(Buffer.from(compactJson(value), "utf8"));
  const sha256 = createHash("sha256").update(data).digest("hex");
  const hash = sha256.slice(0, CATALOG_HASH_LENGTH);
  return { hash, file: { key: key(hash), data, sha256 } };
}

/** Весь каталог: тела /collection по наборам, файл выпусков и оглавление. */
export function buildCatalog(sets: readonly CatalogSet[]): Catalog {
  const files: CatalogFile[] = [];
  const entries: { [key: string]: Json } = {};
  for (const set of [...sets].sort((a, b) => order(a.id, b.id))) {
    const body = catalogFile(collectionBody(set), (hash) =>
      collectionKey(set.id, hash),
    );
    files.push(body.file);
    entries[set.id] = {
      collection: body.hash,
      info: iconifyInfo(set),
      license: licenseExtra(set),
    };
  }
  const releases = catalogFile(releasesBody(sets), releasesKey);
  files.push(releases.file);
  const index = catalogFile(
    { changelog: releases.hash, sets: entries },
    catalogIndexKey,
  );
  files.push(index.file);
  return { hash: index.hash, files };
}
