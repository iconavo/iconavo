import { createHash } from "node:crypto";
import type { IconsFile } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import { compactJson } from "../build/json.js";
import {
  type CdnFile,
  checksumsSchema,
  checksumsText,
  effectiveIcon,
  manifestSchema,
  manifestText,
  nameFile,
  resolveChain,
  setFiles,
} from "./files.js";

const HOUSE = '<path d="M1 1h2"/>';
const FILE = {
  prefix: "demo",
  icons: {
    house: { body: HOUSE },
    info: { body: "<g/>", hidden: true, height: 33, note: "x" },
    a: { body: "<a/>" },
    "a-b": { body: "<b/>" },
  },
  aliases: {
    home: { parent: "house" },
    homestead: { parent: "home", width: 48 },
    gone: { parent: "info" },
  },
  width: 24,
  height: 24,
  lastModified: 1792490457,
} as IconsFile;

const textOf = (files: readonly CdnFile[], path: string): string => {
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`нет файла ${path}`);
  return Buffer.from(file.data).toString("utf8");
};

describe("resolveChain", () => {
  it("иконка — без цепочки, алиас — цепочка до иконки", () => {
    expect(resolveChain(FILE, "house")).toEqual({
      parent: "house",
      icon: { body: HOUSE },
      chain: {},
    });
    const deep = resolveChain(FILE, "homestead");
    expect(deep.parent).toBe("house");
    expect(Object.keys(deep.chain)).toEqual(["homestead", "home"]);
    expect(deep.chain.homestead).toEqual({ parent: "home", width: 48 });
  });

  it("круг и обрыв цепочки — ошибка", () => {
    const broken = {
      ...FILE,
      aliases: { x: { parent: "y" }, y: { parent: "x" }, z: { parent: "no" } },
    } as IconsFile;
    expect(() => resolveChain(broken, "x")).toThrow(/по кругу/);
    expect(() => resolveChain(broken, "z")).toThrow(/не ведёт к иконке/);
  });
});

describe("nameFile", () => {
  it("иконка: IconifyJSON с одной записью, без lastModified", () => {
    expect(compactJson(nameFile(FILE, "house"))).toBe(
      `{"height":24,"icons":{"house":{"body":${JSON.stringify(HOUSE)}}},"prefix":"demo","width":24}`,
    );
  });

  it("алиас: иконка в конце цепочки и вся цепочка", () => {
    expect(compactJson(nameFile(FILE, "home"))).toBe(
      `{"aliases":{"home":{"parent":"house"}},"height":24,"icons":{"house":{"body":${JSON.stringify(HOUSE)}}},"prefix":"demo","width":24}`,
    );
    const deep = nameFile(FILE, "homestead") as {
      aliases: Record<string, unknown>;
      icons: Record<string, unknown>;
    };
    expect(Object.keys(deep.aliases).sort()).toEqual(["home", "homestead"]);
    expect(Object.keys(deep.icons)).toEqual(["house"]);
  });

  it("hidden и лишние поля записи сохраняются; left и top набора — только если есть", () => {
    expect(nameFile(FILE, "gone")).toEqual({
      prefix: "demo",
      width: 24,
      height: 24,
      icons: { info: { body: "<g/>", hidden: true, height: 33, note: "x" } },
      aliases: { gone: { parent: "info" } },
    });
    const shifted = { ...FILE, left: -1, top: 0.5 } as IconsFile;
    expect(nameFile(shifted, "a")).toMatchObject({ left: -1, top: 0.5 });
    expect(nameFile(FILE, "a")).not.toHaveProperty("left");
  });
});

describe("effectiveIcon", () => {
  it("размеры свои, иначе набора, иначе 16; алиас цепочки переопределяет", () => {
    expect(effectiveIcon(FILE, "house")).toEqual({
      body: HOUSE,
      width: 24,
      height: 24,
      left: 0,
      top: 0,
    });
    expect(effectiveIcon(FILE, "info")).toMatchObject({
      width: 24,
      height: 33,
    });
    expect(effectiveIcon(FILE, "homestead")).toMatchObject({
      body: HOUSE,
      width: 48,
      height: 24,
    });
    const bare = {
      prefix: "demo",
      icons: { a: { body: "<a/>" } },
    } as IconsFile;
    expect(effectiveIcon(bare, "a")).toEqual({
      body: "<a/>",
      width: 16,
      height: 16,
      left: 0,
      top: 0,
    });
  });
});

describe("setFiles", () => {
  it("по именам, у имени сначала .json; отпечаток — SHA-256 байтов", () => {
    const files = setFiles({ id: "demo", file: FILE });
    expect(files.map((f) => f.path)).toEqual([
      "demo/a.json",
      "demo/a.svg",
      "demo/a-b.json",
      "demo/a-b.svg",
      "demo/gone.json",
      "demo/gone.svg",
      "demo/home.json",
      "demo/home.svg",
      "demo/homestead.json",
      "demo/homestead.svg",
      "demo/house.json",
      "demo/house.svg",
      "demo/info.json",
      "demo/info.svg",
    ]);
    for (const f of files) {
      expect(f.sha256).toBe(createHash("sha256").update(f.data).digest("hex"));
    }
    expect(textOf(files, "demo/info.svg")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0.73em" height="1em" viewBox="0 0 24 33"><g/></svg>',
    );
    expect(textOf(files, "demo/home.svg")).toBe(
      textOf(files, "demo/house.svg"),
    );
  });

  it("имена info, icons и search — обычные иконки: файл сумм лежит рядом с папкой", () => {
    const file = {
      prefix: "demo",
      icons: {
        info: { body: "<g/>" },
        icons: { body: "<g/>" },
        search: { body: "<g/>" },
      },
      width: 24,
      height: 24,
    } as IconsFile;
    const files = setFiles({ id: "demo", file });
    expect(files.map((f) => f.path)).toContain("demo/info.json");
    expect(files.every((f) => f.path.startsWith("demo/"))).toBe(true);
    expect(files.some((f) => f.path.endsWith(".checksums.json"))).toBe(false);
  });
});

describe("checksumsText и manifestText", () => {
  it("точный текст, проходит свою схему", () => {
    const file = {
      prefix: "demo",
      icons: { a: { body: "<a/>" } },
      width: 24,
      height: 24,
    } as IconsFile;
    const files = setFiles({ id: "demo", file });
    const text = checksumsText({ id: "demo", version: "0123abcd" }, files);
    expect(text).toBe(
      `{"algorithm":"sha256","files":{"demo/a.json":"${files[0]?.sha256}","demo/a.svg":"${files[1]?.sha256}"},"prefix":"demo","version":"0123abcd"}`,
    );
    expect(checksumsSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  it("манифест читаемый, наборы по алфавиту", () => {
    const manifest = manifestText([
      { id: "tabler", version: "46dcf17d", lastModified: 2 },
      { id: "lucide", version: "dbde54d2", lastModified: 1 },
    ]);
    expect(manifest).toBe(
      `{\n  "sets": {\n    "lucide": {\n      "lastModified": 1,\n      "version": "dbde54d2"\n    },\n    "tabler": {\n      "lastModified": 2,\n      "version": "46dcf17d"\n    }\n  }\n}\n`,
    );
    expect(manifestSchema.safeParse(JSON.parse(manifest)).success).toBe(true);
    expect(
      manifestSchema.safeParse({ sets: { lucide: { version: "xyz" } } })
        .success,
    ).toBe(false);
  });
});
