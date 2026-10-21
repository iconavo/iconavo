// Файлы версии набора (ADR-0004, ADR-0022): на каждое имя — JSON в формате IconifyJSON и готовый
// SVG, рядом — контрольные суммы; в корне раздачи — манифест текущих версий. Здесь только чистые
// функции: файловой системы нет, порядок всего — по кодам символов, поэтому одинаковые данные дают
// побайтно те же файлы.

import { createHash } from "node:crypto";
import {
  type Alias,
  type Icon,
  type IconsFile,
  nameSchema,
  versionSchema,
} from "@iconavo-ui/schema";
import { z } from "zod";
import { canonicalJson, compactJson, type Json } from "../build/json.js";
import { CHAIN_LIMIT, CHECKSUM_ALGORITHM } from "./config.js";
import type { CdnSet } from "./load.js";
import { type CdnIcon, svgOf } from "./svg.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** manifest.json: набор → текущая версия и время последнего выпуска в секундах. */
export const manifestSchema = z.strictObject({
  sets: z.record(
    nameSchema,
    z.strictObject({
      version: versionSchema,
      lastModified: z.number().int().nonnegative(),
    }),
  ),
});

/** {набор}.checksums.json: SHA-256 каждого файла версии, пути относительно v/{версия}/. */
export const checksumsSchema = z.strictObject({
  algorithm: z.literal(CHECKSUM_ALGORITHM),
  prefix: nameSchema,
  version: versionSchema,
  files: z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/)),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Checksums = z.infer<typeof checksumsSchema>;

export interface ResolvedName {
  /** Иконка в конце цепочки. */
  parent: string;
  icon: Icon;
  /** Алиасы цепочки от имени к иконке; у самой иконки пусто. */
  chain: Record<string, Alias>;
}

/** Иконка или цепочка алиасов до иконки — для имени из icons.json. */
export function resolveChain(file: IconsFile, name: string): ResolvedName {
  const aliases = file.aliases ?? {};
  const chain: Record<string, Alias> = {};
  let current = name;
  for (let step = 0; Object.hasOwn(aliases, current); step++) {
    if (step >= CHAIN_LIMIT || Object.hasOwn(chain, current)) {
      throw new Error(`алиас «${name}» ходит по кругу`);
    }
    const alias = aliases[current] as Alias;
    chain[current] = alias;
    current = alias.parent;
  }
  const icon = file.icons[current];
  if (!icon) throw new Error(`алиас «${name}» не ведёт к иконке`);
  return { parent: current, icon, chain };
}

/**
 * Иконка для SVG: размеры свои, иначе набора (по умолчанию 16, как в IconifyJSON); алиасы цепочки
 * могут их переопределить — верхний в цепочке главнее.
 */
export function effectiveIcon(file: IconsFile, name: string): CdnIcon {
  const { icon, chain } = resolveChain(file, name);
  const out: CdnIcon = {
    body: icon.body,
    width: icon.width ?? file.width ?? 16,
    height: icon.height ?? file.height ?? 16,
    left: icon.left ?? file.left ?? 0,
    top: icon.top ?? file.top ?? 0,
  };
  for (const alias of Object.values(chain).reverse()) {
    if (alias.width !== undefined) out.width = alias.width;
    if (alias.height !== undefined) out.height = alias.height;
    if (alias.left !== undefined) out.left = alias.left;
    if (alias.top !== undefined) out.top = alias.top;
  }
  return out;
}

/**
 * JSON одного имени: IconifyJSON с иконкой в конце цепочки и, у алиаса, всей цепочкой; записи — как
 * в icons.json. Без lastModified: папка версии зависит только от версии (ADR-0018), дата — в манифесте.
 */
export function nameFile(file: IconsFile, name: string): Json {
  const { parent, icon, chain } = resolveChain(file, name);
  const out: { [key: string]: Json } = {
    prefix: file.prefix,
    icons: { [parent]: icon as unknown as Json },
  };
  for (const key of ["width", "height", "left", "top"] as const) {
    const value = file[key];
    if (value !== undefined) out[key] = value;
  }
  if (Object.keys(chain).length > 0) out.aliases = chain as unknown as Json;
  return out;
}

export interface CdnFile {
  /** Путь относительно v/{версия}/: «{набор}/{имя}.json». */
  path: string;
  data: Uint8Array;
  sha256: string;
}

const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

const bytes = (text: string): Uint8Array => Buffer.from(text, "utf8");

/** Все файлы версии набора: по именам, у каждого имени сначала .json, потом .svg. */
export function setFiles(set: Pick<CdnSet, "id" | "file">): CdnFile[] {
  const file = set.file;
  const names = [
    ...Object.keys(file.icons),
    ...Object.keys(file.aliases ?? {}),
  ].sort(order);
  const out: CdnFile[] = [];
  for (const name of names) {
    const json = bytes(compactJson(nameFile(file, name)));
    const svg = bytes(svgOf(effectiveIcon(file, name)));
    out.push({
      path: `${set.id}/${name}.json`,
      data: json,
      sha256: sha256(json),
    });
    out.push({ path: `${set.id}/${name}.svg`, data: svg, sha256: sha256(svg) });
  }
  return out;
}

/** Текст {набор}.checksums.json. */
export function checksumsText(
  set: Pick<CdnSet, "id" | "version">,
  files: readonly CdnFile[],
): string {
  const list: { [key: string]: Json } = {};
  for (const f of files) list[f.path] = f.sha256;
  return compactJson({
    algorithm: CHECKSUM_ALGORITHM,
    prefix: set.id,
    version: set.version,
    files: list,
  });
}

export interface ManifestEntry {
  id: string;
  version: string;
  lastModified: number;
}

/** Текст manifest.json — читаемо: его открывают люди. */
export function manifestText(sets: readonly ManifestEntry[]): string {
  const list: { [key: string]: Json } = {};
  for (const s of sets) {
    list[s.id] = { version: s.version, lastModified: s.lastModified };
  }
  return canonicalJson({ sets: list });
}
