import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extraFiles,
  type SourceConfig,
  type SourceConfigInput,
  sourceConfigSchema,
  wantedPath,
} from "./config.js";
import { cachedSourceDir, fetchSource, pinEntry } from "./fetch.js";
import { assertCommitHash, fetchGit } from "./git.js";
import { type LockFile, lockFileSchema, readLock, writeLock } from "./lock.js";
import { checkNames, iconNameFromFile } from "./names.js";
import { downloadAndExtract } from "./npm.js";
import { loadRegistry } from "./registry.js";
import { extractTar } from "./tar.js";
import {
  chunked,
  fakeFetch,
  integrityOf,
  makeTar,
  makeTgz,
} from "./tar-builder.testing.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "iconavo-test-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const baseConfig: SourceConfigInput = {
  id: "demo",
  name: "Demo",
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: { spdx: "MIT", file: "LICENSE" },
};

const parse = (c: unknown): SourceConfig => sourceConfigSchema.parse(c);

describe("конфиг набора", () => {
  it("принимает правильный и подставляет правила имён по умолчанию", () => {
    const c = parse(baseConfig);
    expect(c.svgFolders).toEqual([
      { path: "icons", naming: { lowercase: true, replace: [] } },
    ]);
  });

  it.each([
    ["лишнее поле", { ...baseConfig, extra: 1 }],
    ["id не по правилу", { ...baseConfig, id: "Demo_1" }],
    ["нет папок", { ...baseConfig, svgFolders: [] }],
    ["пустой путь папки", { ...baseConfig, svgFolders: [{ path: "" }] }],
    ["путь папки с ..", { ...baseConfig, svgFolders: [{ path: "../icons" }] }],
    [
      "абсолютный путь папки",
      { ...baseConfig, svgFolders: [{ path: "/icons" }] },
    ],
    ["старое поле svgPath", { ...baseConfig, svgPath: "icons" }],
    ["git без repo", { ...baseConfig, source: { type: "git" } }],
    [
      "git по http",
      { ...baseConfig, source: { type: "git", repo: "http://x.test/a.git" } },
    ],
    ["неизвестная палитра", { ...baseConfig, palette: "gray" }],
    [
      "кривая регулярка",
      {
        ...baseConfig,
        svgFolders: [
          { path: "icons", naming: { replace: [{ pattern: "(", with: "" }] } },
        ],
      },
    ],
    ["нет лицензии", { ...baseConfig, license: undefined }],
    ["нет сетки", { ...baseConfig, grid: undefined }],
    ["дробная сетка", { ...baseConfig, grid: 24.5 }],
    ["сетка источника не больше нуля", { ...baseConfig, sourceGrid: 0 }],
  ])("отклоняет: %s", (_name, config) => {
    expect(sourceConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("выбор нужных файлов", () => {
  const paths = [
    "icons/a.svg",
    "icons/a.json",
    "icons/readme.md",
    "dist/b.svg",
    "LICENSE",
    "package.json",
    "tags.json",
  ];
  const pick = (c: SourceConfigInput) => paths.filter(wantedPath(parse(c)));

  it("по умолчанию — SVG из svgFolders и служебные файлы", () => {
    expect(pick({ ...baseConfig, tagsFile: "tags.json" })).toEqual([
      "icons/a.svg",
      "LICENSE",
      "package.json",
      "tags.json",
    ]);
  });

  it("iconMetadata: json добавляет JSON рядом с иконками, но не чужие", () => {
    expect(pick({ ...baseConfig, iconMetadata: "json" })).toEqual([
      "icons/a.svg",
      "icons/a.json",
      "LICENSE",
      "package.json",
    ]);
  });

  it("package.json нужен только наборам из npm", () => {
    const git = parse({
      ...baseConfig,
      source: { type: "git", repo: "https://x.test/a.git" },
    });
    expect(extraFiles(git)).toEqual(["LICENSE"]);
    expect(extraFiles(parse(baseConfig))).toEqual(["LICENSE", "package.json"]);
  });

  it("несколько папок и * вместо одной части пути", () => {
    const c: SourceConfigInput = {
      ...baseConfig,
      svgFolders: [{ path: "assets/*/Flat" }, { path: "extra" }],
    };
    const files = [
      "assets/Cat/Flat/cat_flat.svg",
      "assets/Cat/Dark/Flat/cat_dark.svg",
      "assets/Cat/3D/cat.svg",
      "extra/x.svg",
      "LICENSE",
    ];
    expect(files.filter(wantedPath(parse(c)))).toEqual([
      "assets/Cat/Flat/cat_flat.svg",
      "extra/x.svg",
      "LICENSE",
    ]);
  });

  it("неизвестное значение iconMetadata отклоняется", () => {
    expect(
      sourceConfigSchema.safeParse({ ...baseConfig, iconMetadata: "yaml" })
        .success,
    ).toBe(false);
  });
});

describe("правило имён", () => {
  const config = parse(baseConfig);
  const naming = config.svgFolders[0]
    ?.naming as SourceConfig["svgFolders"][number]["naming"];

  it("берёт имя файла без .svg и приводит к нижнему регистру", () => {
    expect(iconNameFromFile("icons/Arrow-Left.svg", naming)).toBe("arrow-left");
  });

  it("применяет замены из конфига", () => {
    const n = parse({
      ...baseConfig,
      svgFolders: [
        { path: "icons", naming: { replace: [{ pattern: "_", with: "-" }] } },
      ],
    }).svgFolders[0]?.naming as typeof naming;
    expect(iconNameFromFile("icons/arrow_left.svg", n)).toBe("arrow-left");
  });

  it("находит нарушения и конфликты (оба файла видны)", () => {
    const r = checkNames(
      ["icons/ok.svg", "icons/bad_name.svg", "icons/A.svg", "icons/a.svg"],
      config,
    );
    expect(r.total).toBe(4);
    expect(r.invalid.map((x) => x.file)).toEqual(["icons/bad_name.svg"]);
    expect(r.conflicts).toEqual([
      { name: "a", files: ["icons/A.svg", "icons/a.svg"] },
    ]);
  });
});

describe("варианты в разных папках", () => {
  const config = parse({
    ...baseConfig,
    svgFolders: [
      { path: "outline" },
      {
        path: "filled",
        naming: { replace: [{ pattern: "$", with: "-filled" }] },
      },
    ],
  });

  it("суффикс папки отличает одноимённые иконки", () => {
    const r = checkNames(["outline/heart.svg", "filled/heart.svg"], config);
    expect(r.conflicts).toEqual([]);
    expect(r.valid).toBe(2);
  });

  it("без суффикса одноимённые иконки из разных папок — конфликт", () => {
    const same = parse({
      ...baseConfig,
      svgFolders: [{ path: "outline" }, { path: "filled" }],
    });
    const r = checkNames(["outline/heart.svg", "filled/heart.svg"], same);
    expect(r.conflicts).toHaveLength(1);
  });

  it("файл вне папок набора — ошибка", () => {
    expect(() => checkNames(["other/heart.svg"], config)).toThrow(/svgFolders/);
  });
});

describe("sources.lock.json", () => {
  const lock: LockFile = {
    zeta: { type: "git", commit: "a".repeat(40) },
    alpha: { type: "npm", version: "1.0.0", integrity: "sha512-AAAA" },
  };

  it("записывается с отсортированными ключами и читается обратно", async () => {
    const path = join(tmp, "lock.json");
    await writeLock(path, lock);
    const text = await readFile(path, "utf8");
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("zeta"));
    expect(text.endsWith("\n")).toBe(true);
    expect(await readLock(path)).toEqual(lock);
  });

  it("отсутствующий файл — пустой lock", async () => {
    expect(await readLock(join(tmp, "nope.json"))).toEqual({});
  });

  it("ветка вместо хэша и битый формат отклоняются понятной ошибкой", async () => {
    expect(
      lockFileSchema.safeParse({ x: { type: "git", commit: "main" } }).success,
    ).toBe(false);
    const path = join(tmp, "bad.json");
    await writeFile(path, JSON.stringify({ x: { type: "npm" } }));
    await expect(readLock(path)).rejects.toThrow(
      /sources\.lock\.json повреждён/,
    );
  });
});

describe("распаковка tar", () => {
  const wanted = (p: string) => p.startsWith("icons/") || p === "LICENSE";
  const run = (entries: Parameters<typeof makeTar>[0], extra = {}) =>
    extractTar(chunked(makeTar(entries)), { dest: tmp, wanted, ...extra });

  it("сохраняет только нужные файлы и убирает верхнюю папку", async () => {
    const r = await run([
      { name: "package/", type: "5" },
      { name: "package/icons/a.svg", data: "<svg/>" },
      { name: "package/dist/big.js", data: "x".repeat(2000) },
      { name: "package/LICENSE", data: "ISC" },
    ]);
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "LICENSE",
      "icons/a.svg",
    ]);
    expect(await readFile(join(tmp, "icons/a.svg"), "utf8")).toBe("<svg/>");
    await expect(readdir(join(tmp, "dist"))).rejects.toThrow();
  });

  it("пропускает нейтральные сегменты «.» в пути", async () => {
    await run([
      { name: "package/./dist/skip.js", data: "x" },
      { name: "package/./icons/a.svg", data: "<svg/>" },
    ]);
    expect(await readFile(join(tmp, "icons/a.svg"), "utf8")).toBe("<svg/>");
  });

  it("читает файлы, длиннее одного блока и не кратные 512", async () => {
    const data = "ab".repeat(1500);
    await run([{ name: "package/icons/long.svg", data }]);
    expect(await readFile(join(tmp, "icons/long.svg"), "utf8")).toBe(data);
  });

  it.each([
    ["выход через ..", "package/../evil.txt"],
    ["выход вглубь через ..", "package/icons/../../evil.txt"],
    ["абсолютный путь", "/etc/passwd"],
    ["обратные слэши", "package\\icons\\a.svg"],
  ])("отклоняет небезопасный путь: %s", async (_n, name) => {
    await expect(run([{ name, data: "x" }])).rejects.toThrow(
      /небезопасный путь/,
    );
  });

  it("отклоняет симлинк на нужном месте, но пропускает ненужный", async () => {
    await expect(
      run([{ name: "package/icons/link.svg", type: "2" }]),
    ).rejects.toThrow(/не обычный файл/);
    await expect(
      run([{ name: "package/other/link", type: "2" }]),
    ).resolves.toBeDefined();
  });

  it("соблюдает лимиты размера", async () => {
    await expect(
      run([{ name: "package/icons/a.svg", data: "x".repeat(600) }], {
        maxFileBytes: 500,
      }),
    ).rejects.toThrow(/больше лимита/);
    await expect(
      run(
        [
          { name: "package/icons/a.svg", data: "x".repeat(400) },
          { name: "package/icons/b.svg", data: "x".repeat(400) },
        ],
        { maxTotalBytes: 700 },
      ),
    ).rejects.toThrow(/общего лимита/);
  });

  it("обрезанный архив — ошибка", async () => {
    const tar = makeTar([
      { name: "package/icons/a.svg", data: "x".repeat(900) },
    ]);
    await expect(
      extractTar(chunked(tar.subarray(0, 700)), { dest: tmp, wanted }),
    ).rejects.toThrow(/обрезан/);
  });

  it("повреждённый заголовок — ошибка", async () => {
    const tar = makeTar([{ name: "package/icons/a.svg", data: "x" }]);
    tar[10] = 0x7a; // портим имя, контрольная сумма не сойдётся
    await expect(
      extractTar(chunked(tar), { dest: tmp, wanted }),
    ).rejects.toThrow(/повреждён/);
  });
});

describe("загрузка из npm", () => {
  const entries = [
    { name: "package/icons/a.svg", data: "<svg>a</svg>" },
    { name: "package/icons/b.svg", data: "<svg>b</svg>" },
    { name: "package/LICENSE", data: "MIT text" },
    { name: "package/package.json", data: "{}" },
  ];
  const tgz = makeTgz(entries);
  const integrity = integrityOf(tgz);
  const tarballUrl =
    "https://registry.npmjs.org/demo-icons/-/demo-icons-1.0.0.tgz";
  const meta = (v: string, i = integrity) => ({
    version: v,
    dist: { tarball: tarballUrl, integrity: i },
  });
  const routes = () => ({
    "https://registry.npmjs.org/demo-icons/latest": meta("1.0.0"),
    "https://registry.npmjs.org/demo-icons/1.0.0": meta("1.0.0"),
    [tarballUrl]: tgz,
  });
  const wanted = (p: string) =>
    p === "LICENSE" ||
    p === "package.json" ||
    (p.startsWith("icons/") && p.endsWith(".svg"));

  it("скачивает и сверяет integrity", async () => {
    const { fetch } = fakeFetch(routes());
    const r = await downloadAndExtract(
      tarballUrl,
      integrity,
      { dest: tmp, wanted },
      fetch,
    );
    expect(r.files).toHaveLength(4);
  });

  it("неверный integrity — ошибка", async () => {
    const { fetch } = fakeFetch(routes());
    await expect(
      downloadAndExtract(
        tarballUrl,
        integrityOf(Buffer.from("другое")),
        { dest: tmp, wanted },
        fetch,
      ),
    ).rejects.toThrow(/целостность не совпала/);
  });

  it("HTTP-ошибка — понятная ошибка", async () => {
    const { fetch } = fakeFetch({});
    await expect(
      downloadAndExtract(tarballUrl, integrity, { dest: tmp, wanted }, fetch),
    ).rejects.toThrow(/не удалось скачать/);
  });

  describe("fetchSource", () => {
    const config = parse(baseConfig);
    const cacheDir = () => join(tmp, "cache");

    it("первый запуск закрепляет версию и пишет отчёт", async () => {
      const f = fakeFetch(routes());
      const { report, lock } = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f.fetch },
      );
      expect(report).toMatchObject({
        status: "downloaded",
        pinned: "new",
        svgCount: 2,
        sourceLabel: "demo-icons@1.0.0",
        license: { spdx: "MIT", fileFound: true },
      });
      expect(report.names).toMatchObject({ total: 2, valid: 2 });
      expect(lock.demo).toEqual({ type: "npm", version: "1.0.0", integrity });
    });

    it("повторный запуск не использует сеть", async () => {
      const f1 = fakeFetch(routes());
      const first = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f1.fetch },
      );
      const f2 = fakeFetch({});
      const second = await fetchSource(config, first.lock, {
        cacheDir: cacheDir(),
        fetch: f2.fetch,
      });
      expect(f2.calls).toEqual([]);
      expect(second.report).toMatchObject({
        status: "unchanged",
        pinned: "lock",
        svgCount: 2,
      });
    });

    it("cachedSourceDir находит скачанный набор без сети, иначе подсказывает команду", async () => {
      await expect(cachedSourceDir(config, {}, cacheDir())).rejects.toThrow(
        /не закреплён.*pnpm sources fetch demo/,
      );
      const f = fakeFetch(routes());
      const { lock, report } = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f.fetch },
      );
      const found = await cachedSourceDir(config, lock, cacheDir());
      expect(found).toEqual({ dir: report.dir, entry: lock.demo });
      await rm(join(report.dir, "icons/a.svg"));
      await expect(cachedSourceDir(config, lock, cacheDir())).rejects.toThrow(
        /не скачан.*pnpm sources fetch demo/,
      );
    });

    it("удалённый файл в кэше приводит к повторной загрузке", async () => {
      const f1 = fakeFetch(routes());
      const first = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f1.fetch },
      );
      await rm(join(first.report.dir, "icons/a.svg"));
      const f2 = fakeFetch(routes());
      const again = await fetchSource(config, first.lock, {
        cacheDir: cacheDir(),
        fetch: f2.fetch,
      });
      expect(again.report.status).toBe("downloaded");
      expect(again.report.svgCount).toBe(2);
    });

    it("несовпадение integrity в реестре с lock — ошибка, кэш не остаётся", async () => {
      const lock: LockFile = {
        demo: {
          type: "npm",
          version: "1.0.0",
          integrity: integrityOf(Buffer.from("old")),
        },
      };
      const f = fakeFetch(routes());
      await expect(
        fetchSource(config, lock, { cacheDir: cacheDir(), fetch: f.fetch }),
      ).rejects.toThrow(/не совпадает с sources\.lock\.json/);
      const left = await readdir(join(cacheDir(), "demo")).catch(() => []);
      expect(left).toEqual([]);
    });

    it("порча архива по пути не оставляет временных папок", async () => {
      const broken = {
        ...routes(),
        [tarballUrl]: Buffer.from(tgz.subarray(0, 60)),
      };
      const f = fakeFetch(broken);
      await expect(
        fetchSource(config, {}, { cacheDir: cacheDir(), fetch: f.fetch }),
      ).rejects.toThrow();
      const left = await readdir(join(cacheDir(), "demo")).catch(() => []);
      expect(left).toEqual([]);
    });

    it("тип источника в lock не совпадает с конфигом", async () => {
      const lock: LockFile = { demo: { type: "git", commit: "a".repeat(40) } };
      const f = fakeFetch(routes());
      await expect(
        fetchSource(config, lock, { cacheDir: cacheDir(), fetch: f.fetch }),
      ).rejects.toThrow(/не совпадает с записью/);
    });

    it("pinEntry закрепляет указанную версию", async () => {
      const f = fakeFetch(routes());
      expect(await pinEntry(config, "1.0.0", f.fetch)).toEqual({
        type: "npm",
        version: "1.0.0",
        integrity,
      });
    });
  });
});

describe("загрузка из git", () => {
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  async function makeRepo(): Promise<{ dir: string; commit: string }> {
    const dir = join(tmp, "origin");
    await mkdir(join(dir, "icons"), { recursive: true });
    sh(tmp, "init", "-q", dir);
    sh(dir, "config", "user.email", "t@example.com");
    sh(dir, "config", "user.name", "t");
    sh(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    await writeFile(join(dir, "icons/a.svg"), "<svg>a</svg>");
    await writeFile(join(dir, "LICENSE"), "MIT");
    await writeFile(join(dir, "README.md"), "не нужен");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "init");
    return { dir, commit: sh(dir, "rev-parse", "HEAD") };
  }

  it("забирает точный коммит и копирует только нужное", async () => {
    const { dir, commit } = await makeRepo();
    const dest = join(tmp, "out");
    const r = await fetchGit(dir, commit, {
      dest,
      wanted: (p) => p === "LICENSE" || p.startsWith("icons/"),
    });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "LICENSE",
      "icons/a.svg",
    ]);
    await expect(readFile(join(dest, "README.md"))).rejects.toThrow();
  });

  it("ветка или короткий хэш вместо коммита отклоняются", () => {
    expect(() => assertCommitHash("main")).toThrow(/не хэш коммита/);
    expect(() => assertCommitHash("abc1234")).toThrow(/не хэш коммита/);
    expect(() => assertCommitHash("a".repeat(40))).not.toThrow();
  });

  it("несуществующий коммит — понятная ошибка git", async () => {
    const { dir } = await makeRepo();
    await expect(
      fetchGit(dir, "b".repeat(40), {
        dest: join(tmp, "out2"),
        wanted: () => true,
      }),
    ).rejects.toThrow(/git fetch/);
  });
});

describe("реестр конфигов", () => {
  it("загружает правильный конфиг", async () => {
    const dir = join(tmp, "sources");
    await mkdir(dir);
    await writeFile(
      join(dir, "demo.ts"),
      `export default ${JSON.stringify(baseConfig)};\n`,
    );
    const [c] = await loadRegistry(dir);
    expect(c?.id).toBe("demo");
  });

  it("id должен совпадать с именем файла", async () => {
    const dir = join(tmp, "sources2");
    await mkdir(dir);
    await writeFile(
      join(dir, "other.ts"),
      `export default ${JSON.stringify(baseConfig)};\n`,
    );
    await expect(loadRegistry(dir)).rejects.toThrow(
      /должен совпадать с именем файла/,
    );
  });

  it("ошибки конфига показывают путь к полю", async () => {
    const dir = join(tmp, "sources3");
    await mkdir(dir);
    await writeFile(
      join(dir, "demo.ts"),
      `export default ${JSON.stringify({ ...baseConfig, svgFolders: [{ path: "../x" }] })};\n`,
    );
    await expect(loadRegistry(dir)).rejects.toThrow(/svgFolders/);
  });
});
