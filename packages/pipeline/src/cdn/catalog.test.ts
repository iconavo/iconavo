import { createHash } from "node:crypto";
import type {
  ChangelogFile,
  IconsFile,
  InfoFile,
  MetadataFile,
} from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  catalogIndexSchema,
  collectionBody,
  iconifyInfo,
  iconifySuffix,
  licenseExtra,
  releasesBody,
} from "./catalog.js";
import type { CatalogSet } from "./load.js";

const COMMIT = "81875c8c42d2320fa5123b37fee3554f4ca2bddc";

function demoSet(
  id: string,
  o: {
    file?: Partial<IconsFile>;
    info?: Partial<InfoFile>;
    metadata?: MetadataFile;
    changelog?: ChangelogFile["releases"];
  } = {},
): CatalogSet {
  const file = {
    prefix: id,
    icons: {
      house: { body: "<g/>" },
      "house-bold": { body: "<g/>" },
      star: { body: "<g/>" },
      old: { body: "<g/>", hidden: true },
    },
    aliases: { home: { parent: "house" }, gone: { parent: "old" } },
    width: 24,
    height: 24,
    lastModified: 1792490457,
    ...o.file,
  } as IconsFile;
  const info: InfoFile = {
    name: `Demo ${id}`,
    total: 3,
    author: { name: "Demo", url: "https://example.com/demo" },
    license: {
      spdx: "MIT",
      title: "MIT",
      url: "https://spdx.org/licenses/MIT.html",
      text: "MIT License",
      source: "https://www.npmjs.com/package/demo",
      revision: "1.2.3",
      confirmed: true,
    },
    height: 24,
    samples: ["house", "star"],
    palette: false,
    version: "0123abcd",
    ...o.info,
  };
  return {
    id,
    name: info.name,
    version: "0123abcd",
    lastModified: 1792490457,
    file,
    info,
    bytes: { icons: new Uint8Array(), info: new Uint8Array() },
    metadata: o.metadata ?? {},
    changelog: {
      prefix: id,
      releases: o.changelog ?? [
        {
          version: "0123abcd",
          date: "2026-10-20T00:00:00Z",
          revision: "1.2.3",
          total: 3,
        },
      ],
    },
  };
}

describe("collectionBody", () => {
  it("тело /collection как у Iconify: видимые имена, скрытые, алиасы строкой", () => {
    expect(collectionBody(demoSet("demo"))).toEqual({
      prefix: "demo",
      title: "Demo demo",
      total: 3,
      uncategorized: ["house", "house-bold", "star"],
      hidden: ["old"],
      aliases: { home: "house", gone: "old" },
    });
  });

  it("категории автора, остальное — uncategorized, суффиксы без дефиса", () => {
    const body = collectionBody(
      demoSet("demo", {
        metadata: {
          categories: { Buildings: ["house", "house-bold"] },
          suffixes: { "": "Regular", "-bold": "Bold" },
        },
      }),
    );
    expect(body).toMatchObject({
      categories: { Buildings: ["house", "house-bold"] },
      uncategorized: ["star"],
      suffixes: { "": "Regular", bold: "Bold" },
    });
  });

  it("пустые поля не пишутся", () => {
    const body = collectionBody(
      demoSet("demo", {
        file: { icons: { star: { body: "<g/>" } }, aliases: {} },
        info: { total: 1 },
        metadata: { categories: { All: ["star"] } },
      }),
    );
    expect(body).toEqual({
      prefix: "demo",
      title: "Demo demo",
      total: 1,
      categories: { All: ["star"] },
    });
  });
});

describe("iconifyInfo и licenseExtra", () => {
  it("сведения в формате IconifyInfo; полный текст лицензии — отдельно", () => {
    const set = demoSet("demo");
    expect(iconifyInfo(set)).toEqual({
      name: "Demo demo",
      total: 3,
      version: "1.2.3",
      author: { name: "Demo", url: "https://example.com/demo" },
      license: {
        title: "MIT",
        spdx: "MIT",
        url: "https://spdx.org/licenses/MIT.html",
      },
      samples: ["house", "star"],
      height: 24,
      palette: false,
    });
    expect(licenseExtra(set)).toEqual({
      text: "MIT License",
      source: "https://www.npmjs.com/package/demo",
      revision: "1.2.3",
    });
  });

  it("коммит git — 7 символов; без названия лицензии — SPDX; NOTICE — в дополнении", () => {
    const set = demoSet("demo", {
      info: {
        author: { name: "Demo" },
        license: {
          spdx: "ISC",
          text: "ISC License",
          notice: "Notice",
          source: "https://github.com/demo/demo",
          revision: COMMIT,
          confirmed: true,
        },
      },
    });
    expect(iconifyInfo(set)).toMatchObject({
      version: "81875c8",
      author: { name: "Demo" },
      license: { title: "ISC", spdx: "ISC" },
    });
    expect(licenseExtra(set)).toMatchObject({
      notice: "Notice",
      revision: COMMIT,
    });
  });

  it("суффикс Iconify — без ведущего дефиса", () => {
    expect(iconifySuffix("-outline-rounded")).toBe("outline-rounded");
    expect(iconifySuffix("")).toBe("");
  });
});

describe("releasesBody", () => {
  const a = demoSet("a", {
    changelog: [
      {
        version: "aaaa0002",
        previous: "aaaa0001",
        date: "2026-10-28T10:00:00Z",
        revision: "2.0.0",
        total: 4,
        added: ["new"],
      },
      {
        version: "aaaa0001",
        date: "2026-10-20T10:00:00Z",
        revision: "1.0.0",
        total: 3,
      },
    ],
  });
  const b = demoSet("b", {
    changelog: [
      {
        version: "bbbb0001",
        date: "2026-10-20T10:00:00Z",
        revision: "1.0.0",
        total: 3,
      },
    ],
  });

  it("выпуски всех наборов свежими сверху, в одну секунду — по префиксу", () => {
    const body = releasesBody([b, a]) as {
      releases: { prefix: string; version: string }[];
    };
    expect(body.releases.map((r) => `${r.prefix} ${r.version}`)).toEqual([
      "a aaaa0002",
      "a aaaa0001",
      "b bbbb0001",
    ]);
    expect(body.releases[0]).toEqual({
      prefix: "a",
      version: "aaaa0002",
      previous: "aaaa0001",
      date: "2026-10-28T10:00:00Z",
      revision: "2.0.0",
      total: 4,
      added: ["new"],
    });
  });

  it("не больше предела", () => {
    const body = releasesBody([a, b], 2) as { releases: unknown[] };
    expect(body.releases).toHaveLength(2);
  });
});

describe("buildCatalog", () => {
  const sets = [demoSet("zeta"), demoSet("alpha")];
  const sha = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex");
  const text = (data: Uint8Array) => Buffer.from(data).toString("utf8");

  it("тела по наборам, выпуски и оглавление последним; имя — отпечаток содержимого", () => {
    const catalog = buildCatalog(sets);
    expect(
      catalog.files.map((f) => f.key.replace(/[0-9a-f]{12}/, "#")),
    ).toEqual([
      "catalog/alpha/#.json",
      "catalog/zeta/#.json",
      "catalog/changelog/#.json",
      "catalog/#.json",
    ]);
    for (const f of catalog.files) {
      expect(f.sha256).toBe(sha(f.data));
      expect(f.key).toContain(`${f.sha256.slice(0, 12)}.json`);
    }
    const index = catalog.files.at(-1);
    expect(index?.key).toBe(`catalog/${catalog.hash}.json`);
    const parsed = catalogIndexSchema.parse(
      JSON.parse(text(index?.data ?? new Uint8Array())),
    );
    expect(Object.keys(parsed.sets)).toEqual(["alpha", "zeta"]);
    const alpha = catalog.files.find((f) => f.key.startsWith("catalog/alpha/"));
    expect(alpha?.key).toBe(
      `catalog/alpha/${parsed.sets.alpha?.collection}.json`,
    );
    expect(JSON.parse(text(alpha?.data ?? new Uint8Array()))).toEqual(
      collectionBody(demoSet("alpha")),
    );
    expect(parsed.sets.alpha?.license.text).toBe("MIT License");
  });

  it("одинаковые данные — побайтно те же файлы в любом порядке наборов", () => {
    const first = buildCatalog(sets);
    const second = buildCatalog([...sets].reverse());
    expect(second.hash).toBe(first.hash);
    expect(second.files.map((f) => text(f.data))).toEqual(
      first.files.map((f) => text(f.data)),
    );
  });

  it("правка сведений о наборе без новой версии меняет оглавление, но не тела", () => {
    const first = buildCatalog(sets);
    const edited = buildCatalog([
      demoSet("zeta"),
      demoSet("alpha", { info: { samples: ["star"] } }),
    ]);
    expect(edited.hash).not.toBe(first.hash);
    const bodies = (c: typeof first) =>
      c.files
        .filter((f) => /^catalog\/(alpha|zeta)\//.test(f.key))
        .map((f) => f.key);
    expect(bodies(edited)).toEqual(bodies(first));
  });
});
