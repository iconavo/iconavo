// Метаданные набора (шаг 7, ADR-0017): лицензия, теги и категории автора, витрина и отпечатки →
// тексты info.json, metadata.json, search.json, LICENSE и NOTICE. Каждый JSON проверяется схемой;
// любая причина «СТОП» не даёт записать ни одного файла набора.

import { createHash } from "node:crypto";
import {
  type SearchEntry,
  type SearchFile,
  validate,
} from "@iconavo-ui/schema";
import { canonicalJson, type Json } from "../build/json.js";
import { carryEnrichment } from "../enrich/apply.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import { percent } from "../report/html.js";
import type { MetadataFormat, SourceConfig } from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { fingerprint } from "./fingerprint.js";
import { type AuthorMetadata, READERS } from "./formats.js";
import { readLicense, type SetLicense } from "./license.js";
import { authorTags, nameTags } from "./tags.js";

/** Набор останавливается, если теги автора не нашлись больше чем у 1% иконок — порог как у исключённых. */
export const MISSING_METADATA_LIMIT = 0.01;

/** Иконок на витрине набора (ADR-0017). */
export const SAMPLE_COUNT = 6;

/**
 * Понятия витрины по порядку, у каждого — имена в разных наборах. Во всех наборах одни и те же
 * понятия: так наборы легко сравнить по стилю (решение владельца от 20 октября 2026).
 */
export const SAMPLE_CONCEPTS: readonly (readonly string[])[] = [
  ["home", "house"],
  ["search", "magnifying-glass", "magnifying-glass-tilted-left"],
  ["settings", "gear"],
  ["user", "person"],
  ["heart", "favorite", "red-heart"],
  ["star"],
];

export interface MetadataIcon {
  name: string;
  /** Путь SVG в источнике. */
  file: string;
  /** Иконка после SVGO — та, что в icons.json. */
  icon: NormalizedIcon;
}

export interface IconMetadata {
  fingerprint: string;
  tags: string[];
  /** author — теги автора; name — из частей имени. */
  from: "author" | "name";
  /** Категории как у автора. */
  categories: string[];
}

export interface SetFile {
  /** Имя файла в data/{набор}/. */
  name: string;
  text: string;
}

export interface SetMetadata {
  author: SourceConfig["author"];
  /** Нет — текст лицензии не прочитан (причина — в stop). */
  license?: SetLicense;
  format?: MetadataFormat;
  /** Метаданные иконок по имени, в порядке icons.json. */
  icons: Map<string, IconMetadata>;
  /** [категория, иконки] по кодам символов. */
  categories: [string, string[]][];
  samples: string[];
  suffixes?: Record<string, string>;
  /** Иконки без тегов автора в наборе, у которого метаданные автора есть. */
  withoutAuthor: string[];
  /** Описания из search.json на диске (ADR-0046): к каким базовым иконкам перешли, а чьи отброшены. */
  enrichment?: { kept: string[]; dropped: string[] };
  /** Файлы набора, кроме icons.json; нет — набор остановлен. */
  files?: SetFile[];
  stop: string[];
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

/**
 * Витрина: первое найденное имя каждого понятия из SAMPLE_CONCEPTS. Если понятий не хватило,
 * недостающие иконки добираются в постоянном порядке по хэшу имени.
 */
export function pickSamples(names: readonly string[]): string[] {
  const has = new Set(names);
  const out: string[] = [];
  for (const concept of SAMPLE_CONCEPTS) {
    const hit = concept.find((n) => has.has(n));
    if (hit !== undefined && !out.includes(hit)) out.push(hit);
  }
  if (out.length >= SAMPLE_COUNT) return out.slice(0, SAMPLE_COUNT);
  const rest = names
    .filter((n) => !out.includes(n))
    .map((n) => [sha1(n), n] as const)
    .sort(([a], [b]) => order(a, b))
    .map(([, n]) => n);
  return [...out, ...rest].slice(0, SAMPLE_COUNT);
}

/** Метаданные автора по пути SVG в источнике; stop не пуст — формат изменился, метаданных нет. */
export interface AuthorRead {
  author: Map<string, AuthorMetadata>;
  stop: string[];
}

/** Метаданные автора для файлов набора: теги, категории и прежние имена (ADR-0017, ADR-0018). */
export async function readAuthorMetadata(
  config: SourceConfig,
  dir: string,
  files: readonly string[],
): Promise<AuthorRead> {
  if (!config.metadata) return { author: new Map(), stop: [] };
  try {
    return { author: await READERS[config.metadata](dir, files), stop: [] };
  } catch (e) {
    return {
      author: new Map(),
      stop: [
        `формат метаданных автора изменился (${config.metadata}): ${(e as Error).message}`,
      ],
    };
  }
}

export interface MetadataOptions {
  /** Метаданные автора, прочитанные заранее; нет — читаются здесь. */
  author?: AuthorRead;
  /** Версия набора для info.json (ADR-0018). */
  version?: string;
  /** search.json, который сейчас лежит в data/{набор}/, — разобранный JSON: из него переходят описания (ADR-0046). */
  previousSearch?: unknown;
  /** Переименования этой сборки: старое имя → новое (ADR-0018). */
  renamed?: ReadonlyMap<string, string>;
}

/**
 * Метаданные набора. icons — видимые иконки набора без алиасов; names — все имена набора вместе
 * с алиасами: по ним ищется основа имени для тегов из частей имени.
 */
export async function setMetadata(
  config: SourceConfig,
  dir: string,
  entry: LockEntry,
  icons: readonly MetadataIcon[],
  names: ReadonlySet<string>,
  options: MetadataOptions = {},
): Promise<SetMetadata> {
  const { license, stop } = await readLicense(config, dir, entry);

  const read =
    options.author ??
    (await readAuthorMetadata(
      config,
      dir,
      icons.map((i) => i.file),
    ));
  const author = read.author;
  const readerFailed = read.stop.length > 0;
  stop.push(...read.stop);

  const suffixes = Object.keys(config.suffixes ?? {});
  const has = (n: string) => names.has(n);
  const result = new Map<string, IconMetadata>();
  const withoutAuthor: string[] = [];
  const byCategory = new Map<string, string[]>();
  for (const icon of icons) {
    const meta = author.get(icon.file);
    const tags = meta ? authorTags(meta.tags) : [];
    const categories = [
      ...new Set(
        (meta?.categories ?? []).map((c) => c.trim()).filter((c) => c !== ""),
      ),
    ];
    if (config.metadata && tags.length === 0) withoutAuthor.push(icon.name);
    result.set(icon.name, {
      fingerprint: fingerprint(config.id, icon.name, icon.icon),
      tags: tags.length > 0 ? tags : nameTags(icon.name, suffixes, has),
      from: tags.length > 0 ? "author" : "name",
      categories,
    });
    for (const c of categories) {
      const list = byCategory.get(c);
      if (list) list.push(icon.name);
      else byCategory.set(c, [icon.name]);
    }
  }
  if (
    config.metadata &&
    !readerFailed &&
    icons.length > 0 &&
    withoutAuthor.length / icons.length > MISSING_METADATA_LIMIT
  ) {
    stop.push(
      `теги автора нашлись не у всех иконок: без них ${withoutAuthor.length} из ${icons.length} (${percent(withoutAuthor.length, icons.length)}) — больше 1%, проверьте формат метаданных (${config.metadata})`,
    );
  }

  const iconNames = icons.map((i) => i.name);
  let samples = pickSamples(iconNames);
  if (config.samples) {
    const known = new Set(iconNames);
    const unknown = config.samples.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      stop.push(
        `витрина: в наборе нет иконок ${unknown.join(", ")} — поправьте samples в sources/${config.id}.ts (алиасы не подходят)`,
      );
    }
    samples = [...config.samples];
  }

  const report: SetMetadata = {
    author: config.author,
    license,
    format: config.metadata,
    icons: result,
    categories: [...byCategory]
      .sort(([a], [b]) => order(a, b))
      .map(([title, list]) => [title, [...list].sort(order)]),
    samples,
    suffixes: config.suffixes,
    withoutAuthor,
    stop,
  };
  if (stop.length > 0 || !license) return report;

  const files = setFiles(config, report, license, iconNames.length, options);
  if (files.stop.length > 0) stop.push(...files.stop);
  else {
    report.files = files.files;
    report.enrichment = files.enrichment;
  }
  return report;
}

/** Тексты файлов набора; JSON проверяется схемой (ADR-0003). */
function setFiles(
  config: SourceConfig,
  r: SetMetadata,
  license: SetLicense,
  total: number,
  options: MetadataOptions,
): {
  files: SetFile[];
  enrichment?: { kept: string[]; dropped: string[] };
  stop: string[];
} {
  const version = options.version;
  const author: { [key: string]: Json } = { name: config.author.name };
  if (config.author.url !== undefined) author.url = config.author.url;
  const licenseJson: { [key: string]: Json } = {
    spdx: license.spdx,
    title: license.title,
    url: license.url,
    text: license.text,
    source: license.source,
    revision: license.revision,
    confirmed: true,
  };
  if (license.notice !== undefined) licenseJson.notice = license.notice;
  const info: { [key: string]: Json } = {
    name: config.name,
    total,
    author,
    license: licenseJson,
    height: config.grid,
    samples: r.samples,
    palette: config.palette === "color",
  };
  if (version !== undefined) info.version = version;

  const metadata: { [key: string]: Json } = {};
  if (r.categories.length > 0) {
    metadata.categories = Object.fromEntries(r.categories);
  }
  if (r.suffixes) metadata.suffixes = { ...r.suffixes };

  const icons: Record<string, SearchEntry> = {};
  for (const [name, m] of r.icons) {
    icons[name] = { fingerprint: m.fingerprint, tags: m.tags };
  }
  // Описания переходят из search.json на диске к базовым иконкам с тем же отпечатком (ADR-0046).
  const carried = carryEnrichment(
    { prefix: config.id, icons } satisfies SearchFile,
    options.previousSearch,
    options.renamed ?? new Map(),
    Object.keys(config.suffixes ?? {}),
  );
  const search = carried.search as unknown as { [key: string]: Json };

  const files: SetFile[] = [];
  const stop: string[] = [...carried.stop];
  for (const [kind, data] of [
    ["info", info],
    ["metadata", metadata],
    ["search", search],
  ] as const) {
    const issues = validate(kind, data);
    if (issues.length > 0) {
      stop.push(
        `${kind}.json не прошёл проверку схемы: ${issues
          .slice(0, 3)
          .map((i) => `${i.path} — ${i.message}`)
          .join("; ")}`,
      );
    } else {
      files.push({ name: `${kind}.json`, text: canonicalJson(data) });
    }
  }
  files.push({ name: "LICENSE", text: license.text });
  if (license.notice !== undefined) {
    files.push({ name: "NOTICE", text: license.notice });
  }
  return {
    files,
    enrichment: { kept: carried.kept, dropped: carried.dropped },
    stop,
  };
}
