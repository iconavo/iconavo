import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type FileKind, NAME_PATTERN, validate } from "./index.js";

const examples = new URL("../examples/", import.meta.url);
const load = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, examples), "utf8"));

const icon = { body: "<path d='M0 0'/>" };
const paths = (kind: FileKind, data: unknown) =>
  validate(kind, data).map((i) => i.path);

describe("правильный пример", () => {
  it.each(["icons", "info", "metadata", "search"] as const)(
    "%s.json проходит без ошибок",
    (kind) => {
      expect(validate(kind, load(`valid/${kind}.json`))).toEqual([]);
    },
  );
});

describe("сломанный пример", () => {
  it("даёт ровно три ошибки с точными путями", () => {
    const issues = validate("icons", load("broken/icons.json"));
    expect(issues.map((i) => i.path).sort()).toEqual([
      "aliases.arrow-back.parent",
      "icons.Arrow_Left",
      "icons.arrow-right.body",
    ]);
  });

  it("пишет ошибки по-русски", () => {
    const messages = validate("icons", load("broken/icons.json")).map(
      (i) => i.message,
    );
    expect(messages.join(" ")).toMatch(/обязательное поле отсутствует/);
    expect(messages.join(" ")).not.toMatch(/Invalid|expected/);
  });
});

describe("имена (ADR-0001)", () => {
  it.each(["a", "a1", "a-b", "arrow-left", "3d-box", "a-1-b"])(
    "принимает %s",
    (name) => expect(NAME_PATTERN.test(name)).toBe(true),
  );

  it.each(["", "-a", "a-", "a--b", "A", "a_b", "a b", "a:b", "а-б", "a.b"])(
    "отклоняет %j",
    (name) => expect(NAME_PATTERN.test(name)).toBe(false),
  );

  it("проверяет префикс, иконки и алиасы одним правилом", () => {
    const data = {
      prefix: "Demo",
      icons: { "Bad-Name": icon },
      aliases: { bad_alias: { parent: "bad-parent" } },
    };
    expect(paths("icons", data)).toEqual(
      expect.arrayContaining([
        "prefix",
        "icons.Bad-Name",
        "aliases.bad_alias",
        "aliases.bad_alias.parent",
      ]),
    );
  });
});

describe("icons.json", () => {
  const base = { prefix: "demo", icons: { a: icon } };

  it("принимает hidden и поворот 0–3", () => {
    const data = {
      ...base,
      icons: { a: { ...icon, hidden: true } },
      aliases: { b: { parent: "a", rotate: 3 } },
    };
    expect(validate("icons", data)).toEqual([]);
  });

  it("отклоняет поворот вне 0–3 и неположительный размер", () => {
    const data = {
      ...base,
      width: 0,
      aliases: { b: { parent: "a", rotate: 4 } },
    };
    expect(paths("icons", data)).toEqual(
      expect.arrayContaining(["width", "aliases.b.rotate"]),
    );
  });

  it("отклоняет пустой body", () => {
    expect(paths("icons", { ...base, icons: { a: { body: "" } } })).toContain(
      "icons.a.body",
    );
  });

  it("допускает лишние поля (совместимость с IconifyJSON)", () => {
    const data = { ...base, extra: 1, icons: { a: { ...icon, custom: "x" } } };
    expect(validate("icons", data)).toEqual([]);
  });

  it("находит алиас, совпадающий с именем иконки", () => {
    const data = { ...base, aliases: { a: { parent: "a" } } };
    expect(paths("icons", data)).toContain("aliases.a");
  });

  it("находит цикл алиасов", () => {
    const data = {
      ...base,
      aliases: { x: { parent: "y" }, y: { parent: "x" } },
    };
    const issues = validate("icons", data);
    expect(issues.some((i) => /по кругу/.test(i.message))).toBe(true);
  });

  it("принимает цепочку алиасов", () => {
    const data = {
      ...base,
      aliases: { x: { parent: "y" }, y: { parent: "a" } },
    };
    expect(validate("icons", data)).toEqual([]);
  });

  it("не падает на мусоре вместо файла", () => {
    for (const junk of [null, 1, "x", [], { icons: [] }, { icons: null }]) {
      expect(validate("icons", junk).length).toBeGreaterThan(0);
    }
  });
});

describe("search.json", () => {
  const syn = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`);
  const lang = (n: number) => ({ description: "текст", synonyms: syn(n) });
  const file = (entry: object) => ({
    prefix: "demo",
    icons: { a: { fingerprint: "0123456789ab", tags: [], ...entry } },
  });

  it("принимает иконку без обогащения", () => {
    expect(validate("search", file({}))).toEqual([]);
  });

  it.each([4, 11])("отклоняет %i синонимов", (n) => {
    const data = file({ ru: lang(n), en: lang(5) });
    expect(paths("search", data)).toContain("icons.a.ru.synonyms");
  });

  it.each([5, 10])("принимает %i синонимов", (n) => {
    expect(validate("search", file({ ru: lang(n), en: lang(n) }))).toEqual([]);
  });

  it("требует оба языка сразу", () => {
    expect(paths("search", file({ ru: lang(5) }))).toContain("icons.a.en");
  });

  it.each(["", "0123456789a", "0123456789abc", "0123456789AB", "xyz"])(
    "отклоняет отпечаток %j",
    (fingerprint) => {
      expect(paths("search", file({ fingerprint }))).toContain(
        "icons.a.fingerprint",
      );
    },
  );

  it("запрещает лишние поля (опечатки должны ловиться)", () => {
    expect(validate("search", file({ tagz: [] })).length).toBeGreaterThan(0);
  });

  it("теги — только строчными буквами", () => {
    expect(validate("search", file({ tags: ["дом", "home"] }))).toEqual([]);
    expect(validate("search", file({ tags: ["Home"] }))).toEqual([
      { path: "icons.a.tags", message: "теги — только строчными буквами" },
    ]);
  });

  it("теги не повторяются", () => {
    expect(validate("search", file({ tags: ["home", "home"] }))).toEqual([
      { path: "icons.a.tags", message: "теги не должны повторяться" },
    ]);
  });
});

describe("info.json", () => {
  const valid = load("valid/info.json") as Record<string, unknown>;

  it("требует лицензию с текстом и источником", () => {
    const data = { ...valid, license: { spdx: "MIT" } };
    expect(paths("info", data)).toEqual(
      expect.arrayContaining([
        "license.text",
        "license.source",
        "license.revision",
      ]),
    );
  });

  it("отклоняет неверную версию набора", () => {
    expect(paths("info", { ...valid, version: "xyz" })).toContain("version");
  });

  it("требует признак цветного набора", () => {
    const { palette: _removed, ...rest } = valid;
    expect(paths("info", rest)).toContain("palette");
  });
});

describe("metadata.json", () => {
  it("принимает суффиксы -bold и пустой", () => {
    const data = { suffixes: { "": "Regular", "-bold": "Bold" } };
    expect(validate("metadata", data)).toEqual([]);
  });

  it("отклоняет неверный суффикс и неверное имя иконки в категории", () => {
    const data = {
      suffixes: { bold: "Bold" },
      categories: { Стрелки: ["Arrow"] },
    };
    expect(validate("metadata", data).length).toBeGreaterThanOrEqual(2);
  });

  it("запрещает лишние поля", () => {
    expect(validate("metadata", { categoriez: {} }).length).toBeGreaterThan(0);
  });
});

describe("команда проверки", () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const example = (p: string) => fileURLToPath(new URL(p, examples));

  it("код 0 на правильном файле", () => {
    const r = run(example("valid/icons.json"));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ошибок нет/);
  });

  it("код 1 и ошибки с путями на сломанном", () => {
    const r = run(example("broken/icons.json"));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ошибок — 3/);
    expect(r.stderr).toMatch(/icons\.Arrow_Left — /);
  });

  it("код 2 без аргументов и на неизвестном виде", () => {
    expect(run().status).toBe(2);
    expect(run(example("valid/icons.json"), "--kind", "nope").status).toBe(2);
  });

  it("--kind переопределяет вид по имени файла", () => {
    expect(run(example("valid/info.json"), "--kind", "icons").status).toBe(1);
  });

  it("код 1, если файла нет", () => {
    const r = run(example("nonexistent/icons.json"));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/не удалось прочитать JSON/);
  });
});
