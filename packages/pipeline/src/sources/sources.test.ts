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
  downloadRules,
  extraFiles,
  pathPattern,
  type SourceConfig,
  type SourceConfigInput,
  sourceConfigSchema,
  wantedPath,
} from "./config.js";
import {
  cachedSourceDir,
  type FetchReport,
  fetchSource,
  pinEntry,
} from "./fetch.js";
import {
  assertCommitHash,
  fetchGit,
  isReleaseTag,
  latestReleaseTag,
  parseRemoteTags,
  releaseTagsByCommit,
  remoteTags,
  resolveGitTag,
} from "./git.js";
import { type LockFile, lockFileSchema, readLock, writeLock } from "./lock.js";
import { checkNames, iconNameFromFile } from "./names.js";
import { downloadAndExtract } from "./npm.js";
import { loadRegistry } from "./registry.js";
import { fetchStop, formatReport } from "./report.js";
import { extractTar } from "./tar.js";
import {
  chunked,
  fakeFetch,
  integrityOf,
  makeTar,
  makeTgz,
} from "./tar-builder.testing.js";
import { compareVersions, parseVersion } from "./version.js";

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
  author: { name: "Demo", url: "https://example.com/demo" },
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
    ["нет автора", { ...baseConfig, author: undefined }],
    [
      "лицензия не из разрешённых",
      { ...baseConfig, license: { spdx: "GPL-3.0", file: "LICENSE" } },
    ],
    [
      "отпечаток лицензии не той длины",
      {
        ...baseConfig,
        license: { spdx: "MIT", file: "LICENSE", confirmed: "abc" },
      },
    ],
    ["неизвестный формат метаданных", { ...baseConfig, metadata: "yaml" }],
    ["старое поле iconMetadata", { ...baseConfig, iconMetadata: "json" }],
    ["старое поле tagsFile", { ...baseConfig, tagsFile: "tags.json" }],
    ["неверный суффикс", { ...baseConfig, suffixes: { bold: "Bold" } }],
    [
      "суффикс из variantAliases без названия",
      {
        ...baseConfig,
        variantAliases: ["", "-outline"],
        suffixes: { "": "Regular" },
      },
    ],
    ["повтор в витрине", { ...baseConfig, samples: ["a", "a"] }],
    [
      "витрина больше шести",
      { ...baseConfig, samples: ["a", "b", "c", "d", "e", "f", "g"] },
    ],
    [
      "latest у пакета npm",
      {
        ...baseConfig,
        source: { type: "npm", package: "demo-icons", latest: "tag" },
      },
    ],
    [
      "неизвестный latest у git",
      {
        ...baseConfig,
        source: { type: "git", repo: "https://x.test/a", latest: "branch" },
      },
    ],
  ])("отклоняет: %s", (_name, config) => {
    expect(sourceConfigSchema.safeParse(config).success).toBe(false);
  });

  it("git-источник: последняя версия — по тегам выпусков или по HEAD (по умолчанию)", () => {
    const git = (extra: object) =>
      parse({
        ...baseConfig,
        source: { type: "git", repo: "https://x.test/a", ...extra },
      }).source;
    expect(git({ latest: "tag" })).toEqual({
      type: "git",
      repo: "https://x.test/a",
      latest: "tag",
    });
    expect(git({})).toEqual({ type: "git", repo: "https://x.test/a" });
  });

  it("принимает метаданные, подтверждённую лицензию, варианты и витрину", () => {
    const c = parse({
      ...baseConfig,
      license: {
        spdx: "Apache-2.0",
        file: "LICENSE",
        confirmed: "a".repeat(64),
      },
      metadata: "lucide",
      suffixes: { "": "Regular", "-outline": "Outline" },
      variantAliases: ["", "-outline"],
      samples: ["home", "star"],
    });
    expect(c.license.confirmed).toBe("a".repeat(64));
    expect(c.suffixes).toEqual({ "": "Regular", "-outline": "Outline" });
  });

  it("называет суффиксы без названия", () => {
    const r = sourceConfigSchema.safeParse({
      ...baseConfig,
      variantAliases: ["", "-outline", "-sharp"],
      suffixes: { "": "Regular" },
    });
    expect(r.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      [
        "suffixes",
        "нет названий для суффиксов из variantAliases: «-outline», «-sharp»",
      ],
    ]);
  });
});

describe("выбор нужных файлов", () => {
  const paths = [
    "icons/a.svg",
    "icons/a.json",
    "icons/sub/b.json",
    "icons/readme.md",
    "categories/text.json",
    "groups/plus.json",
    "dist/b.svg",
    "dist/index.mjs",
    "dist/index.umd.js",
    "assets/Cat/metadata.json",
    "assets/Cat/Dark/metadata.json",
    "icons.json",
    "LICENSE",
    "NOTICE",
    "NOTICE.txt",
    "docs/NOTICE",
    "package.json",
    "tags.json",
  ];
  const pick = (c: SourceConfigInput) => paths.filter(wantedPath(parse(c)));

  it("по умолчанию — SVG из svgFolders, служебные файлы и NOTICE в корне", () => {
    expect(pick(baseConfig)).toEqual([
      "icons/a.svg",
      "LICENSE",
      "NOTICE",
      "NOTICE.txt",
      "package.json",
    ]);
  });

  it.each([
    ["lucide", ["icons/a.json", "categories/text.json", "groups/plus.json"]],
    ["tabler", ["icons.json"]],
    ["phosphor", ["dist/index.mjs"]],
    ["fluent-emoji", ["assets/Cat/metadata.json"]],
  ] as const)("метаданные %s — только свои файлы", (metadata, files) => {
    const extra = pick({ ...baseConfig, metadata }).filter(
      (p) => !pick(baseConfig).includes(p),
    );
    expect(extra).toEqual(files);
  });

  it("звёздочка в шаблоне — любые символы внутри одной части пути", () => {
    expect(pathPattern("icons/*.json").test("icons/a-b.json")).toBe(true);
    expect(pathPattern("icons/*.json").test("icons/sub/b.json")).toBe(false);
    expect(pathPattern("icons/*.json").test("icons/a.json.bak")).toBe(false);
    expect(pathPattern("assets/*/Flat").test("assets/Waving hand/Flat")).toBe(
      true,
    );
    expect(pathPattern("a.b").test("axb")).toBe(false);
  });

  it("правила скачивания меняются вместе с тем, что нужно набору", () => {
    const rules = downloadRules(parse(baseConfig));
    expect(downloadRules(parse(baseConfig))).toBe(rules);
    expect(
      downloadRules(parse({ ...baseConfig, metadata: "tabler" })),
    ).not.toBe(rules);
    expect(
      downloadRules(parse({ ...baseConfig, svgFolders: [{ path: "x" }] })),
    ).not.toBe(rules);
    // Название набора и сетка на скачивание не влияют.
    expect(downloadRules(parse({ ...baseConfig, name: "Другое" }))).toBe(rules);
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

describe("отчёт загрузки", () => {
  const report = (files: string[]): FetchReport => ({
    id: "demo",
    name: "Demo",
    sourceLabel: "demo-icons@1.0.0",
    status: "unchanged",
    pinned: "lock",
    dir: "cache/demo/1.0.0",
    svgCount: files.length,
    folders: [{ path: "icons", count: files.length }],
    extraFiles: ["LICENSE"],
    missingExtraFiles: [],
    bytes: 0,
    license: { spdx: "MIT", fileFound: true },
    names: checkNames(files, parse(baseConfig)),
  });

  it("имена по правилу — «СТОП» нет", () => {
    const r = report(["icons/a.svg", "icons/b.svg"]);
    expect(fetchStop(r)).toEqual([]);
    expect(formatReport(r)).not.toContain("СТОП");
  });

  it("нарушение правила и конфликт имён — «СТОП»: набор нельзя собирать (ADR-0001)", () => {
    const r = report([
      "icons/ok.svg",
      "icons/bad_name.svg",
      "icons/A.svg",
      "icons/a.svg",
    ]);
    expect(fetchStop(r)).toEqual([
      "имена не по правилу ADR-0001: 1 — нужно правило переименования в sources/demo.ts",
      "одно имя у нескольких файлов: 1 — нужно правило переименования в sources/demo.ts (ADR-0001)",
    ]);
    const text = formatReport(r);
    expect(text).toContain("  СТОП: имена не по правилу ADR-0001: 1");
    expect(text).toContain("  СТОП: одно имя у нескольких файлов: 1");
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

  it("повтор файла в архиве — один файл: побеждает последняя копия, как у tar", async () => {
    const r = await run([
      { name: "package/icons/a.svg", data: "<svg>1</svg>" },
      { name: "package/LICENSE", data: "ISC" },
      { name: "package/./icons/a.svg", data: "<svg>два</svg>" },
    ]);
    const size = Buffer.byteLength("<svg>два</svg>");
    expect(r.files).toEqual([
      { path: "icons/a.svg", size },
      { path: "LICENSE", size: 3 },
    ]);
    expect(r.bytes).toBe(size + 3);
    expect(await readFile(join(tmp, "icons/a.svg"), "utf8")).toBe(
      "<svg>два</svg>",
    );
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
      // NOTICE необязателен: его нет — это не пропажа.
      expect(report.notice).toBeUndefined();
      expect(report.missingExtraFiles).toEqual([]);
    });

    it("находит NOTICE в корне источника", async () => {
      const withNotice = makeTgz([
        ...entries,
        { name: "package/NOTICE", data: "Notice text" },
      ]);
      const own = integrityOf(withNotice);
      const f = fakeFetch({
        "https://registry.npmjs.org/demo-icons/latest": meta("1.0.0", own),
        "https://registry.npmjs.org/demo-icons/1.0.0": meta("1.0.0", own),
        [tarballUrl]: withNotice,
      });
      const { report } = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f.fetch },
      );
      expect(report.notice).toBe("NOTICE");
      expect(report.extraFiles).toEqual(["LICENSE", "package.json"]);
    });

    it("изменились правила скачивания — без новой загрузки набор не находится, fetch качает заново", async () => {
      const f1 = fakeFetch(routes());
      const first = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f1.fetch },
      );
      const changed = parse({ ...baseConfig, metadata: "tabler" });
      await expect(
        cachedSourceDir(changed, first.lock, cacheDir()),
      ).rejects.toThrow(/старым правилам.*pnpm sources fetch demo/);
      const f2 = fakeFetch(routes());
      const again = await fetchSource(changed, first.lock, {
        cacheDir: cacheDir(),
        fetch: f2.fetch,
      });
      expect(again.report.status).toBe("downloaded");
      expect(f2.calls.length).toBeGreaterThan(0);
      expect(again.report.metadata).toEqual({ format: "tabler", files: 0 });
      expect(await cachedSourceDir(changed, again.lock, cacheDir())).toEqual({
        dir: again.report.dir,
        entry: again.lock.demo,
      });
    });

    it("метка без правил (скачано до шага 7) — набор скачивается заново", async () => {
      const f1 = fakeFetch(routes());
      const first = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f1.fetch },
      );
      const markerPath = join(first.report.dir, ".fetched.json");
      const { rules: _, ...old } = JSON.parse(
        await readFile(markerPath, "utf8"),
      ) as { rules?: string };
      await writeFile(markerPath, JSON.stringify(old));
      const f2 = fakeFetch(routes());
      const again = await fetchSource(config, first.lock, {
        cacheDir: cacheDir(),
        fetch: f2.fetch,
      });
      expect(again.report.status).toBe("downloaded");
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

    it("повтор нужного файла в архиве не мешает найти набор в кэше", async () => {
      // Как у Phosphor: в архиве дважды лежит package/./dist/index.umd.js.
      const repeated = makeTgz([
        ...entries,
        { name: "package/./icons/a.svg", data: "<svg>a</svg>" },
      ]);
      const own = integrityOf(repeated);
      const f1 = fakeFetch({
        "https://registry.npmjs.org/demo-icons/latest": meta("1.0.0", own),
        "https://registry.npmjs.org/demo-icons/1.0.0": meta("1.0.0", own),
        [tarballUrl]: repeated,
      });
      const first = await fetchSource(
        config,
        {},
        { cacheDir: cacheDir(), fetch: f1.fetch },
      );
      expect(first.report.svgCount).toBe(2);
      const f2 = fakeFetch({});
      const second = await fetchSource(config, first.lock, {
        cacheDir: cacheDir(),
        fetch: f2.fetch,
      });
      expect(f2.calls).toEqual([]);
      expect(second.report.status).toBe("unchanged");
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

  it("файлы приходят как в репозитории, даже если git настроен на CRLF", async () => {
    const dir = join(tmp, "origin-eol");
    await mkdir(join(dir, "icons"), { recursive: true });
    sh(tmp, "init", "-q", dir);
    sh(dir, "config", "user.email", "t@example.com");
    sh(dir, "config", "user.name", "t");
    sh(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
    // Коммит — как есть, без предупреждений о переводах строк.
    sh(dir, "config", "core.autocrlf", "false");
    sh(dir, "config", "core.eol", "lf");
    // LICENSE без атрибутов, SVG — с text=auto: обе настройки переноса строк должны быть сняты.
    await writeFile(join(dir, ".gitattributes"), "*.svg text=auto\n");
    await writeFile(join(dir, "LICENSE"), "MIT License\n\nText\n");
    await writeFile(join(dir, "icons/a.svg"), "<svg>\n</svg>\n");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "init");
    const commit = sh(dir, "rev-parse", "HEAD");

    const saved = { ...process.env };
    // Как на Windows с настройками по умолчанию: git переводит строки в CRLF при checkout.
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = "core.autocrlf";
    process.env.GIT_CONFIG_VALUE_0 = "true";
    process.env.GIT_CONFIG_KEY_1 = "core.eol";
    process.env.GIT_CONFIG_VALUE_1 = "crlf";
    const dest = join(tmp, "out-eol");
    try {
      await fetchGit(dir, commit, {
        dest,
        wanted: (p) => p === "LICENSE" || p.startsWith("icons/"),
      });
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) Reflect.deleteProperty(process.env, key);
      }
      Object.assign(process.env, saved);
    }
    expect(await readFile(join(dest, "LICENSE"), "utf8")).toBe(
      "MIT License\n\nText\n",
    );
    expect(await readFile(join(dest, "icons/a.svg"), "utf8")).toBe(
      "<svg>\n</svg>\n",
    );
  });

  it("последний выпуск — свежий тег вида 1.2.3: коммит аннотированного тега, а не объект тега", async () => {
    const { dir, commit: first } = await makeRepo();
    await writeFile(join(dir, "icons/b.svg"), "<svg>b</svg>");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "second");
    const second = sh(dir, "rev-parse", "HEAD");
    await writeFile(join(dir, "icons/c.svg"), "<svg>c</svg>");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "third");
    const third = sh(dir, "rev-parse", "HEAD");
    sh(dir, "tag", "1.9.0", first);
    // Аннотированный тег: у него свой объект, ls-remote показывает и его, и коммит (^{}).
    sh(dir, "tag", "-a", "-m", "release", "v1.10.0", second);
    // Не выпуски: тег другого пакета, предварительная версия.
    sh(dir, "tag", "@lucide/lab@9.9.9", third);
    sh(dir, "tag", "2.0.0-rc.1", third);
    const tags = await remoteTags(dir);
    expect(tags.find((t) => t.name === "v1.10.0")?.commit).toBe(second);
    const latest = await resolveGitTag(dir);
    expect(latest).toEqual({ name: "v1.10.0", commit: second });
    expect(releaseTagsByCommit(tags)).toEqual(
      new Map([
        [second, "v1.10.0"],
        [first, "1.9.0"],
      ]),
    );
  });

  it("репозиторий без тегов выпусков — понятная ошибка", async () => {
    const { dir } = await makeRepo();
    sh(dir, "tag", "nightly");
    await expect(resolveGitTag(dir)).rejects.toThrow(
      /нет тегов выпусков вида 1\.2\.3/,
    );
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

describe("версии и теги выпусков", () => {
  it("номер версии разбирается по частям и сравнивается как числа", () => {
    expect(parseVersion("v1.60.0")).toEqual([1, 60, 0]);
    expect(parseVersion("3.49.0")).toEqual([3, 49, 0]);
    expect(parseVersion("1.0.0-rc.1")).toBeUndefined();
    expect(parseVersion("@lucide/lab@1.0.0")).toBeUndefined();
    const cmp = (a: string, b: string) =>
      compareVersions(parseVersion(a) ?? [], parseVersion(b) ?? []);
    expect(cmp("1.10.0", "1.9.0")).toBe(1);
    expect(cmp("3.49.0", "3.50.0")).toBe(-1);
    expect(cmp("1.0", "1.0.0")).toBe(0);
  });

  it("вывод ls-remote: строка ^{} аннотированного тега побеждает, выпуски — только X.Y.Z", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const c = "c".repeat(40);
    const object = "d".repeat(40);
    const tags = parseRemoteTags(
      [
        `${a}\trefs/tags/1.9.0`,
        `${object}\trefs/tags/v1.10.0`,
        `${b}\trefs/tags/v1.10.0^{}`,
        `${c}\trefs/tags/@lucide/lab@9.9.9`,
        `${c}\trefs/tags/2.0.0-rc.1`,
        `${c}\trefs/heads/main`,
        "",
      ].join("\n"),
    );
    expect(tags).toEqual([
      { name: "1.9.0", commit: a },
      { name: "v1.10.0", commit: b },
      { name: "@lucide/lab@9.9.9", commit: c },
      { name: "2.0.0-rc.1", commit: c },
    ]);
    expect(tags.filter((t) => isReleaseTag(t.name)).map((t) => t.name)).toEqual(
      ["1.9.0", "v1.10.0"],
    );
    expect(latestReleaseTag(tags)).toEqual({ name: "v1.10.0", commit: b });
    expect(latestReleaseTag([])).toBeUndefined();
  });

  it("у коммита с двумя тегами выпуска имя — у свежего", () => {
    const a = "a".repeat(40);
    expect(
      releaseTagsByCommit([
        { name: "1.0.0", commit: a },
        { name: "1.0.1", commit: a },
      ]),
    ).toEqual(new Map([[a, "1.0.1"]]));
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
