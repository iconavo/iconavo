// Файлы пакета данных (ADR-0026): данные набора побайтно из data/, ES-модуль, который отдаёт их
// одной строкой, типы TypeScript без зависимостей, README на английском (решение владельца 23 октября
// 2026) и package.json. Отпечаток пакета — SHA-256 всех файлов и package.json без номера версии: по
// нему подготовка понимает, что публиковать нечего. Всё — чистые функции: одинаковый набор даёт
// одинаковые байты на любой системе.

import { createHash } from "node:crypto";
import {
  NPM_BUGS_URL,
  NPM_REPOSITORY,
  NPM_REPOSITORY_URL,
  npmChangelogPage,
  npmPackageName,
  npmSetPage,
} from "./config.js";
import type { NpmSet } from "./load.js";

export interface NpmFile {
  /** Путь в пакете: файлы лежат в корне. */
  path: string;
  data: Uint8Array;
}

export interface NpmPackage {
  name: string;
  /** Файлы пакета, кроме package.json, по порядку путей. */
  files: NpmFile[];
  /** Поле files: README.md, LICENSE и package.json npm кладёт в пакет сам. */
  listed: string[];
  /** Отпечаток содержимого: файлы и package.json без номера версии. */
  fingerprint: string;
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

/** Модуль пакета: три JSON одной строкой импорта, как у Iconify. */
export const INDEX_JS = `import icons from "./icons.json" with { type: "json" };
import info from "./info.json" with { type: "json" };
import metadata from "./metadata.json" with { type: "json" };

export { icons, info, metadata };
`;

/** Типы пакета: описание трёх файлов без зависимостей; префикс — точное имя набора. */
export function indexDts(prefix: string): string {
  return `/** Placement and transforms of an icon, as in IconifyJSON. */
export interface IconavoIconProps {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  /** Rotation in 90° steps. */
  rotate?: 0 | 1 | 2 | 3;
  hFlip?: boolean;
  vFlip?: boolean;
  /** Removed by the author: still works by name, but is not listed. */
  hidden?: boolean;
}

/** An icon: SVG content without the <svg> element. */
export interface IconavoIcon extends IconavoIconProps {
  body: string;
}

/** Another name of an icon. */
export interface IconavoAlias extends IconavoIconProps {
  parent: string;
}

/** The icon set in IconifyJSON format. */
export interface IconavoIconSet {
  prefix: ${JSON.stringify(prefix)};
  icons: Record<string, IconavoIcon>;
  aliases?: Record<string, IconavoAlias>;
  /** Time of the last release, Unix seconds. */
  lastModified?: number;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}

/** License of the icon set, with the full text. */
export interface IconavoLicense {
  /** SPDX identifier, for example "MIT". */
  spdx: string;
  title?: string;
  url?: string;
  text: string;
  notice?: string;
  /** Where the icons come from. */
  source: string;
  /** Version or commit of the source. */
  revision: string;
  confirmed: boolean;
}

/** Name, author, license and grid of the icon set. */
export interface IconavoSetInfo {
  name: string;
  /** Visible icons: without hidden icons and aliases. */
  total: number;
  author: { name: string; url?: string };
  license: IconavoLicense;
  height: number | number[];
  /** Showcase icons. */
  samples?: string[];
  /** true for multicolor sets: colors are part of the drawings. */
  palette: boolean;
  /** Version of the set: changes with any change in icons.json. */
  version?: string;
}

/** The author's categories and variant suffixes. */
export interface IconavoSetMetadata {
  categories?: Record<string, string[]>;
  /** Suffix → variant name; "" is the base variant. */
  suffixes?: Record<string, string>;
}

export declare const icons: IconavoIconSet;
export declare const info: IconavoSetInfo;
export declare const metadata: IconavoSetMetadata;
`;
}

/** 1903 → «1,903»: README на английском. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** «1 icon», «1,903 icons»; «1 alias», «268 aliases». */
const count = (n: number, one: string, many: string) =>
  `${groupDigits(n)} ${n === 1 ? one : many}`;

/** Коммит git — 7 символов, как на GitHub; версия npm — как есть. */
const shortRevision = (revision: string) =>
  /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;

const link = (text: string, url: string | undefined) =>
  url === undefined ? text : `[${text}](${url})`;

function metadataLine(set: NpmSet): string {
  const categories = Object.keys(set.metadata.categories ?? {}).length;
  const variants = Object.values(set.metadata.suffixes ?? {});
  const parts: string[] = [];
  if (categories > 0) parts.push(`the author's categories (${categories})`);
  if (variants.length > 0) parts.push(`variants: ${variants.join(", ")}`);
  return parts.length > 0
    ? parts.join("; ")
    : "empty: the author has no categories or variants";
}

/** README пакета: установка, пример, что внутри, автор и лицензия. Номера версии пакета в нём нет. */
export function readmeText(set: NpmSet, tag: string): string {
  const name = npmPackageName(set.id);
  const { info, file } = set;
  const aliases = Object.keys(file.aliases ?? {}).length;
  const hidden = Object.values(file.icons).filter(
    (i) => i.hidden === true,
  ).length;
  const sample =
    (info.samples ?? []).find((n) => Object.hasOwn(file.icons, n)) ??
    Object.keys(file.icons).sort(order)[0] ??
    "";
  const grid = `${file.width ?? 16} × ${file.height ?? 16}`;
  const counts = `${count(info.total, "icon", "icons")}${aliases > 0 ? ` and ${count(aliases, "alias", "aliases")}` : ""}`;
  const install = tag === "latest" ? name : `${name}@${tag}`;
  const title = info.license.title ?? info.license.spdx;
  const spdx = title === info.license.spdx ? "" : ` (\`${info.license.spdx}\`)`;
  const lines = [
    `# ${name}`,
    "",
    `${info.name} in IconifyJSON format: ${counts}, ready to use without a network. Part of ${link("Iconavo", NPM_REPOSITORY)}.`,
    "",
    `Browse the icons on ${link(`iconavo.dev/${set.id}`, npmSetPage(set.id))}. What changed in each version of the set is in the ${link("changelog", npmChangelogPage(set.id))}.`,
    "",
  ];
  if (tag !== "latest") {
    lines.push(
      `> Until the public launch, versions are published under the \`${tag}\` tag.`,
      "",
    );
  }
  lines.push(
    "## Install",
    "",
    "```sh",
    `npm install ${install}`,
    "```",
    "",
    "## Usage",
    "",
    "```js",
    `import { icons, info, metadata } from "${name}";`,
    "",
    `const icon = icons.icons[${JSON.stringify(sample)}];`,
    `// icon.body: SVG content for a ${grid} viewBox, without the <svg> element`,
    "```",
    "",
    "A single file works too, for example in a build script:",
    "",
    "```js",
    `import icons from "${name}/icons.json" with { type: "json" };`,
    "```",
    "",
    "TypeScript types for `icons`, `info` and `metadata` are included.",
    "",
    "## What is inside",
    "",
    "| File | Contents |",
    "| --- | --- |",
    `| \`icons.json\` | ${counts} in IconifyJSON format, grid ${grid} |`,
    "| `info.json` | name, author, license with the full text, showcase icons |",
    `| \`metadata.json\` | ${metadataLine(set)} |`,
    "| `LICENSE` | the license of the icon set |",
  );
  if (set.files.some((f) => f.path === "NOTICE")) {
    lines.push("| `NOTICE` | the notice that comes with the license |");
  }
  lines.push(
    "| `index.js`, `index.d.ts` | the ES module and its TypeScript types |",
    "",
    info.palette
      ? "The icons are multicolor: colors are part of the drawings."
      : "The icons are monochrome and use `currentColor`, so they take the color of the text.",
    "",
    `Icon names never disappear: an icon removed by its author stays in \`icons.json\` with \`hidden: true\`, and a renamed icon keeps its old name as an alias.${hidden > 0 ? ` Hidden icons in this version: ${groupDigits(hidden)}.` : ""}`,
    "",
    "## License",
    "",
    `The icons are by ${link(info.author.name, info.author.url)}, licensed under ${link(title, info.license.url)}${spdx}. The full text is in \`LICENSE\`.`,
    "",
    `Source: ${info.license.source}, revision \`${shortRevision(info.license.revision)}\`. Iconavo checks, cleans and normalizes the SVG; the drawings stay the author's. Set version \`${set.version}\`.`,
    "",
  );
  return lines.join("\n");
}

/** Пути файлов пакета для поля files: всё, кроме того, что npm кладёт сам. */
function listedOf(files: readonly NpmFile[]): string[] {
  const always = new Set(["README.md", "LICENSE", "package.json"]);
  return files
    .map((f) => f.path)
    .filter((p) => !always.has(p))
    .sort(order);
}

/** package.json: поля в постоянном порядке, в exports условие types — первым (так требует TypeScript). */
function manifestText(
  set: NpmSet,
  tag: string,
  listed: readonly string[],
  version: string | undefined,
  fingerprint: string | undefined,
): string {
  const m: Record<string, unknown> = { name: npmPackageName(set.id) };
  if (version !== undefined) m.version = version;
  m.description = `${set.info.name} in IconifyJSON format: icons, metadata and the author's license, packaged by Iconavo`;
  m.keywords = ["icons", "svg", "iconify", "iconify-json", set.id, "iconavo"];
  m.homepage = npmSetPage(set.id);
  m.license = set.info.license.spdx;
  m.repository = {
    type: "git",
    url: NPM_REPOSITORY_URL,
    directory: `data/${set.id}`,
  };
  m.bugs = { url: NPM_BUGS_URL };
  m.type = "module";
  m.sideEffects = false;
  m.main = "./index.js";
  m.types = "./index.d.ts";
  m.exports = {
    ".": { types: "./index.d.ts", default: "./index.js" },
    "./icons.json": "./icons.json",
    "./info.json": "./info.json",
    "./metadata.json": "./metadata.json",
    "./package.json": "./package.json",
  };
  m.files = listed;
  m.publishConfig = { access: "public", provenance: true, tag };
  m.iconavo =
    fingerprint === undefined
      ? { set: set.id, setVersion: set.version }
      : { set: set.id, setVersion: set.version, fingerprint };
  return `${JSON.stringify(m, null, 2)}\n`;
}

/** Отпечаток: каждый файл (путь и SHA-256), затем package.json без версии и без самого отпечатка. */
export function fingerprintOf(
  files: readonly NpmFile[],
  manifest: string,
): string {
  const hash = createHash("sha256");
  for (const f of [...files].sort((a, b) => order(a.path, b.path))) {
    hash.update(`${f.path}\0${sha256(f.data)}\n`);
  }
  hash.update(`package.json\0${sha256(manifest)}\n`);
  return hash.digest("hex");
}

/** Пакет набора без номера версии: его ставит подготовка, когда решит, что публиковать. */
export function buildPackage(set: NpmSet, tag: string): NpmPackage {
  const files: NpmFile[] = [
    ...set.files,
    { path: "index.js", data: utf8(INDEX_JS) },
    { path: "index.d.ts", data: utf8(indexDts(set.id)) },
    { path: "README.md", data: utf8(readmeText(set, tag)) },
  ].sort((a, b) => order(a.path, b.path));
  const listed = listedOf(files);
  const fingerprint = fingerprintOf(
    files,
    manifestText(set, tag, listed, undefined, undefined),
  );
  return { name: npmPackageName(set.id), files, listed, fingerprint };
}

/** package.json пакета с этой версией: отпечаток в нём от содержимого, а не от номера. */
export function packageJsonOf(
  set: NpmSet,
  tag: string,
  pkg: NpmPackage,
  version: string,
): NpmFile {
  return {
    path: "package.json",
    data: utf8(manifestText(set, tag, pkg.listed, version, pkg.fingerprint)),
  };
}
