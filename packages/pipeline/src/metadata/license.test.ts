import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { licenseHash, normalizeText, readLicense } from "./license.js";

const TEXT = "MIT License\n\nCopyright (c) Demo\n";
const base: SourceConfigInput = {
  id: "demo",
  name: "Demo",
  author: { name: "Demo" },
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed: licenseHash("MIT", TEXT),
  },
};
const config = (extra: Partial<SourceConfigInput> = {}) =>
  sourceConfigSchema.parse({ ...base, ...extra });
const NPM: LockEntry = {
  type: "npm",
  version: "1.2.3",
  integrity: "sha512-AAAA",
};
const GIT: LockEntry = { type: "git", commit: "a".repeat(40) };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-license-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Файлы источника: LICENSE и package.json по умолчанию; null — файла нет. */
async function makeSource(files: Record<string, string | null> = {}) {
  const all: Record<string, string | null> = {
    LICENSE: TEXT,
    "package.json": JSON.stringify({ name: "demo-icons", license: "MIT" }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    if (content === null) continue;
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }
}

describe("текст и отпечаток лицензии", () => {
  it("BOM убирается, переводы строк становятся LF", () => {
    expect(normalizeText("﻿a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("формула отпечатка закреплена: её смена — повод подтверждать лицензии заново", () => {
    expect(licenseHash("MIT", "x")).toBe(
      "13ffef27e36187497dea10bfc3a1186850437146b8e124c9b9283d041285159b",
    );
  });

  it("отпечаток зависит от SPDX, текста и NOTICE", () => {
    const hash = licenseHash("MIT", TEXT);
    expect(licenseHash("ISC", TEXT)).not.toBe(hash);
    expect(licenseHash("MIT", `${TEXT} `)).not.toBe(hash);
    expect(licenseHash("MIT", TEXT, "Notice")).not.toBe(hash);
  });
});

describe("лицензия набора", () => {
  it("подтверждённая лицензия пакета npm: всё для info.json", async () => {
    await makeSource();
    const { license, stop } = await readLicense(config(), dir, NPM);
    expect(stop).toEqual([]);
    expect(license).toEqual({
      spdx: "MIT",
      title: "MIT",
      url: "https://spdx.org/licenses/MIT.html",
      text: TEXT,
      notice: undefined,
      noticeFile: undefined,
      source: "https://www.npmjs.com/package/demo-icons",
      revision: "1.2.3",
      hash: licenseHash("MIT", TEXT),
      status: "confirmed",
    });
  });

  it("git: источник — репозиторий, версия — полный коммит, package.json не нужен", async () => {
    await makeSource({ "package.json": null });
    const { license, stop } = await readLicense(
      config({ source: { type: "git", repo: "https://github.com/x/y" } }),
      dir,
      GIT,
    );
    expect(stop).toEqual([]);
    expect(license).toMatchObject({
      source: "https://github.com/x/y",
      revision: "a".repeat(40),
      status: "confirmed",
    });
  });

  it("CRLF и BOM в LICENSE дают тот же отпечаток, текст — с LF", async () => {
    await makeSource({ LICENSE: `﻿${TEXT.replaceAll("\n", "\r\n")}` });
    const { license, stop } = await readLicense(config(), dir, NPM);
    expect(stop).toEqual([]);
    expect(license?.text).toBe(TEXT);
  });

  it("не подтверждена — «СТОП» с отпечатком для подтверждения", async () => {
    await makeSource();
    const { license, stop } = await readLicense(
      config({ license: { spdx: "MIT", file: "LICENSE" } }),
      dir,
      NPM,
    );
    expect(license?.status).toBe("unconfirmed");
    expect(stop).toEqual([
      `лицензия не подтверждена (ADR-0017): прочитайте текст в metadata.html; после подтверждения в sources/demo.ts вписывается license.confirmed: "${licenseHash("MIT", TEXT)}"`,
    ]);
  });

  it("текст изменился у автора — «СТОП»", async () => {
    await makeSource({ LICENSE: "MIT License\n\nCopyright (c) Другой\n" });
    const { license, stop } = await readLicense(config(), dir, NPM);
    expect(license?.status).toBe("changed");
    expect(stop).toHaveLength(1);
    expect(stop[0]).toMatch(
      /^лицензия изменилась у автора: подтверждён текст [0-9a-f]{12}…, сейчас [0-9a-f]{12}…/,
    );
  });

  it("файла лицензии нет или он пустой — «СТОП» без текста", async () => {
    await makeSource({ LICENSE: null });
    expect(await readLicense(config(), dir, NPM)).toEqual({
      stop: ["файл лицензии LICENSE не найден в источнике"],
    });
    await writeFile(join(dir, "LICENSE"), " \n", "utf8");
    expect(await readLicense(config(), dir, NPM)).toEqual({
      stop: ["файл лицензии LICENSE пустой"],
    });
  });

  it("NOTICE — первый непустой из NOTICE, NOTICE.txt, NOTICE.md", async () => {
    await makeSource({
      NOTICE: "  \n",
      "NOTICE.txt": "Demo notice\r\n",
      "NOTICE.md": "Другой",
    });
    const notice = "Demo notice\n";
    const { license, stop } = await readLicense(
      config({
        license: {
          spdx: "MIT",
          file: "LICENSE",
          confirmed: licenseHash("MIT", TEXT, notice),
        },
      }),
      dir,
      NPM,
    );
    expect(stop).toEqual([]);
    expect(license).toMatchObject({ notice, noticeFile: "NOTICE.txt" });
  });

  it.each([
    [
      "другая лицензия",
      JSON.stringify({ license: "Apache-2.0" }),
      "в package.json автора лицензия «Apache-2.0», а в конфиге «MIT» — проверьте, не сменил ли автор лицензию",
    ],
    [
      "лицензия не указана",
      JSON.stringify({ name: "x" }),
      "в package.json автора лицензия «не указана», а в конфиге «MIT» — проверьте, не сменил ли автор лицензию",
    ],
    ["не JSON", "{", "package.json не читается как JSON — лицензию не сверить"],
    [
      "нет package.json",
      null,
      "в источнике нет package.json — лицензию не сверить",
    ],
  ])("package.json пакета npm: %s — «СТОП»", async (_n, pkg, message) => {
    await makeSource({ "package.json": pkg });
    const { license, stop } = await readLicense(config(), dir, NPM);
    expect(stop).toEqual([message]);
    expect(license?.status).toBe("confirmed");
  });

  it("package.json в старом формате (объект с type) принимается", async () => {
    await makeSource({
      "package.json": JSON.stringify({ license: { type: "MIT", url: "x" } }),
    });
    expect((await readLicense(config(), dir, NPM)).stop).toEqual([]);
  });
});
