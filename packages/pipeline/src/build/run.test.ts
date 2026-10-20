import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validate } from "@iconavo-ui/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { licenseHash } from "../metadata/license.js";
import { type Baseline, iconsByName } from "../qc/baseline.js";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { SVG_NS } from "../svg/xml.js";
import { formatBuildReport, renderBuildGallery } from "./report.js";
import { buildSet, writeSetData } from "./run.js";

const LICENSE_TEXT = "MIT License\n\nCopyright (c) Demo\n";
const base: SourceConfigInput = {
  id: "demo",
  name: "Demo <b>",
  author: { name: "Demo", url: "https://example.com/demo" },
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed: licenseHash("MIT", LICENSE_TEXT),
  },
};
const config = (extra: Partial<SourceConfigInput> = {}) =>
  sourceConfigSchema.parse({ ...base, ...extra });

/** Названия вариантов для тестов с variantAliases: без них конфиг не принимается. */
const OUTLINE = { "": "Regular", "-outline": "Outline" };

const entry = (version = "1.0.0"): LockEntry => ({
  type: "npm",
  version,
  integrity: "sha512-AAAA",
});

const svg = (body: string, attrs = `viewBox="0 0 24 24"`) =>
  `<svg xmlns="${SVG_NS}" ${attrs}>${body}</svg>`;
const SQUARE = svg(`<path d="M4 4h16v16H4z"/>`);
const CIRCLE = svg(`<circle cx="12" cy="12" r="8"/>`);
const WITH_IDS = svg(
  `<clipPath id="c"><rect width="12" height="12"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#c)"/>`,
);

let dir: string;
let dataDir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-build-"));
  dataDir = await mkdtemp(join(tmpdir(), "iconavo-data-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

/** Файлы источника; LICENSE и package.json пакета npm — по умолчанию, их можно заменить. */
async function makeSet(files: Record<string, string>, root = dir) {
  const all = {
    LICENSE: LICENSE_TEXT,
    "package.json": JSON.stringify({ name: "demo-icons", license: "MIT" }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
}

const build = (cfg = config(), root = dir) => buildSet(cfg, root, entry());

/** Содержимое icons.json как объект; если набор остановлен — ошибка теста с причинами. */
function parsed(r: Awaited<ReturnType<typeof build>>) {
  if (r.json === undefined) throw new Error(r.stop.join("; "));
  return JSON.parse(r.json) as {
    prefix: string;
    width: number;
    height: number;
    icons: Record<string, { body: string; width?: number; height?: number }>;
    aliases?: Record<string, { parent: string }>;
    lastModified?: number;
  };
}

describe("сборка набора", () => {
  it("icons.json проходит схему; размер набора общий, времени сборки нет", async () => {
    await makeSet({ "icons/square.svg": SQUARE, "icons/circle.svg": CIRCLE });
    const r = await build();
    const data = parsed(r);
    expect(validate("icons", data)).toEqual([]);
    expect(data.prefix).toBe("demo");
    expect([data.width, data.height]).toEqual([24, 24]);
    expect(data.lastModified).toBeUndefined();
    expect(Object.keys(data.icons)).toEqual(["circle", "square"]);
    expect(data.icons.square).toEqual({
      body: `<path fill="currentColor" d="M4 4h16v16H4z"/>`,
    });
    expect(data.icons.circle?.body).toBe(
      `<circle cx="12" cy="12" r="8" fill="currentColor"/>`,
    );
  });

  it("масштаб Material Symbols впечатан на всём пути от файла до icons.json", async () => {
    await makeSet({
      "icons/add.svg": svg(
        `<path d="M450-450H200v-60h250v-250h60v250h250v60H510v250h-60v-250Z"/>`,
        `viewBox="0 -960 960 960" width="24" height="24"`,
      ),
    });
    const r = await build(config({ sourceGrid: 960 }));
    expect(parsed(r).icons.add?.body).toBe(
      `<path fill="currentColor" d="M11.25 12.75H5v-1.5h6.25V5h1.5v6.25H19v1.5h-6.25V19h-1.5z"/>`,
    );
    expect(r.transforms).toEqual({ before: 1, left: 0 });
  });

  it("две сборки подряд дают побайтно одинаковые файлы — и на диске тоже", async () => {
    await makeSet({
      "icons/square.svg": SQUARE,
      "icons/circle.svg": CIRCLE,
      "icons/clip.svg": WITH_IDS,
      "icons/123.svg": SQUARE,
      "icons/360.svg": CIRCLE,
    });
    const first = await build();
    const written = (await writeSetData(dataDir, first)) as string[];
    const read = () => Promise.all(written.map((p) => readFile(p)));
    const before = await read();
    const second = await build();
    await writeSetData(dataDir, second);
    const after = await read();
    expect(second.json).toBe(first.json);
    expect(second.metadata.files).toEqual(first.metadata.files);
    after.forEach((bytes, i) => {
      expect(bytes.equals(before[i] as Buffer)).toBe(true);
    });
    expect(written).toEqual(
      [
        "icons.json",
        "info.json",
        "metadata.json",
        "search.json",
        "LICENSE",
      ].map((name) => join(dataDir, "demo", name)),
    );
    // Ключи-числа — по кодам символов, а не впереди всех.
    expect(Object.keys(parsed(first).icons)).toEqual([
      "123",
      "360",
      "circle",
      "clip",
      "square",
    ]);
    expect(first.json).toMatch(/"123": \{[\s\S]*"360": \{[\s\S]*"circle"/);
  });

  it("порядок появления файлов не влияет на результат", async () => {
    const other = await mkdtemp(join(tmpdir(), "iconavo-build-"));
    try {
      await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": CIRCLE });
      await makeSet({ "icons/b.svg": CIRCLE, "icons/a.svg": SQUARE }, other);
      const a = await build();
      const b = await build(config(), other);
      expect(b.json).toBe(a.json);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("иконка вне сетки получает свой размер, остальные — размер набора", async () => {
    // Одна иконка вне сетки на 101: больше 1% остановили бы набор (правило шага 4).
    const files: Record<string, string> = {
      "icons/b.svg": svg(
        `<path d="M4 4h24v25H4z" fill="#00A6ED"/>`,
        `viewBox="0 0 32 33"`,
      ),
    };
    for (let i = 0; i < 100; i++) {
      files[`icons/a${String(i).padStart(3, "0")}.svg`] = svg(
        `<path d="M4 4h24v24H4z" fill="#F92F60"/>`,
        `viewBox="0 0 32 32"`,
      );
    }
    await makeSet(files);
    const data = parsed(await build(config({ palette: "color", grid: 32 })));
    expect([data.width, data.height]).toEqual([32, 32]);
    expect(data.icons.a000).toEqual({
      body: `<path fill="#f92f60" d="M4 4h24v24H4z"/>`,
    });
    expect(data.icons.b?.height).toBe(33);
    expect(data.icons.b?.width).toBeUndefined();
  });

  it("одинаковые варианты становятся алиасами старшего", async () => {
    await makeSet({
      "icons/add.svg": SQUARE,
      "icons/add-outline.svg": SQUARE,
      "icons/home.svg": SQUARE,
      "icons/home-outline.svg": CIRCLE,
    });
    const r = await build(
      config({ variantAliases: ["", "-outline"], suffixes: OUTLINE }),
    );
    const data = parsed(r);
    expect(data.aliases).toEqual({ "add-outline": { parent: "add" } });
    expect(Object.keys(data.icons)).toEqual(["add", "home", "home-outline"]);
    expect(r.aliases).toEqual([["add-outline", "add"]]);
    expect(r.icons.find((b) => b.entry.name === "add")?.aliases).toEqual([
      "add-outline",
    ]);
    expect(validate("icons", data)).toEqual([]);
  });

  it("набор со «СТОП» не записывается и старый файл не трогает", async () => {
    await makeSet({ "icons/a.svg": SQUARE });
    await mkdir(join(dataDir, "demo"));
    await writeFile(join(dataDir, "demo", "icons.json"), "старый", "utf8");
    const r = await build(config({ grid: 20, sourceGrid: 24 }));
    expect(r.stop.join("\n")).toMatch(/сетка 20 не поддерживается/);
    expect(r.json).toBeUndefined();
    expect(await writeSetData(dataDir, r)).toBeUndefined();
    expect(await readFile(join(dataDir, "demo", "icons.json"), "utf8")).toBe(
      "старый",
    );
  });

  it("одно имя у двух файлов останавливает набор", async () => {
    await makeSet({ "a/x.svg": SQUARE, "b/x.svg": CIRCLE });
    const r = await build(
      config({ svgFolders: [{ path: "a" }, { path: "b" }] }),
    );
    expect(r.conflicts).toEqual([{ name: "x", files: ["a/x.svg", "b/x.svg"] }]);
    expect(r.stop.join("\n")).toMatch(/одно имя у нескольких файлов/);
    expect(r.json).toBeUndefined();
  });

  it("размеры: исходники считаются с переводами строк LF", async () => {
    const crlf = `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">\r\n<path d="M4 4h16v16H4z"/>\r\n</svg>\r\n`;
    await makeSet({ "icons/a.svg": crlf });
    const r = await build();
    expect(r.sizes.source).toBe(
      Buffer.byteLength(crlf.replaceAll("\r\n", "\n")),
    );
    expect(r.sizes.normalized).toBeGreaterThan(0);
    expect(r.sizes.optimized).toBeGreaterThan(0);
    expect(r.sizes.json).toBe(Buffer.byteLength(r.json as string));
  });
});

describe("метаданные и лицензия при сборке", () => {
  it("все файлы набора проходят схему и согласованы с icons.json", async () => {
    await makeSet({
      "icons/home.svg": SQUARE,
      "icons/home-outline.svg": CIRCLE,
      "icons/clip.svg": WITH_IDS,
    });
    const r = await build(
      config({ variantAliases: ["", "-outline"], suffixes: OUTLINE }),
    );
    const icons = parsed(r);
    const files = new Map(
      (r.metadata.files ?? []).map((f) => [f.name, f.text]),
    );
    expect([...files.keys()]).toEqual([
      "info.json",
      "metadata.json",
      "search.json",
      "LICENSE",
    ]);
    const json = (name: string) => JSON.parse(files.get(name) ?? "null");
    expect(validate("info", json("info.json"))).toEqual([]);
    expect(validate("metadata", json("metadata.json"))).toEqual([]);
    expect(validate("search", json("search.json"))).toEqual([]);
    expect(json("info.json")).toMatchObject({
      name: "Demo <b>",
      total: 3,
      author: { name: "Demo", url: "https://example.com/demo" },
      license: {
        spdx: "MIT",
        title: "MIT",
        text: LICENSE_TEXT,
        source: "https://www.npmjs.com/package/demo-icons",
        revision: "1.0.0",
        confirmed: true,
      },
      height: 24,
      samples: ["home", "clip", "home-outline"],
      palette: false,
    });
    expect(json("metadata.json")).toEqual({
      suffixes: { "": "Regular", "-outline": "Outline" },
    });
    expect(Object.keys(json("search.json").icons)).toEqual(
      Object.keys(icons.icons),
    );
    expect(json("search.json").icons["home-outline"].tags).toEqual(["home"]);
    expect(files.get("LICENSE")).toBe(LICENSE_TEXT);
  });

  it("лицензия не подтверждена — «СТОП», старые файлы не тронуты, отчёт полный", async () => {
    await makeSet({ "icons/a.svg": SQUARE });
    await mkdir(join(dataDir, "demo"));
    await writeFile(join(dataDir, "demo", "icons.json"), "старый", "utf8");
    const r = await build(
      config({ license: { spdx: "MIT", file: "LICENSE" } }),
    );
    expect(r.stop).toEqual([
      `лицензия не подтверждена (ADR-0017): прочитайте текст в metadata.html; после подтверждения в sources/demo.ts вписывается license.confirmed: "${licenseHash("MIT", LICENSE_TEXT)}"`,
    ]);
    expect(r.metadata.license?.status).toBe("unconfirmed");
    expect(r.metadata.files).toBeUndefined();
    expect(await writeSetData(dataDir, r)).toBeUndefined();
    expect(await readdir(join(dataDir, "demo"))).toEqual(["icons.json"]);
    const page = [...renderBuildGallery([r])].at(-1)?.html ?? "";
    expect(page).toContain(`<pre>MIT License`);
    expect(page).toContain(licenseHash("MIT", LICENSE_TEXT));
  });

  it("текст лицензии у автора изменился — «СТОП»", async () => {
    await makeSet({
      "icons/a.svg": SQUARE,
      LICENSE: "MIT License\n\nCopyright (c) Другой автор\n",
    });
    const r = await build();
    expect(r.stop.join("\n")).toMatch(/лицензия изменилась у автора/);
    expect(r.json).toBeUndefined();
  });

  it("CRLF в тексте лицензии не меняет отпечаток, в data/ — LF", async () => {
    await makeSet({
      "icons/a.svg": SQUARE,
      LICENSE: LICENSE_TEXT.replaceAll("\n", "\r\n"),
    });
    const r = await build();
    expect(r.stop).toEqual([]);
    expect(r.metadata.files?.find((f) => f.name === "LICENSE")?.text).toBe(
      LICENSE_TEXT,
    );
  });

  it("NOTICE записывается, а пропавший у автора — удаляется", async () => {
    const notice = "Demo icons\nCopyright Demo\n";
    await makeSet({ "icons/a.svg": SQUARE, NOTICE: notice });
    const cfg = config({
      license: {
        spdx: "MIT",
        file: "LICENSE",
        confirmed: licenseHash("MIT", LICENSE_TEXT, notice),
      },
    });
    const first = (await writeSetData(dataDir, await build(cfg))) as string[];
    expect(first.at(-1)).toBe(join(dataDir, "demo", "NOTICE"));
    expect(await readFile(join(dataDir, "demo", "NOTICE"), "utf8")).toBe(
      notice,
    );

    await rm(join(dir, "NOTICE"));
    const again = await build();
    expect(again.stop).toEqual([]);
    await writeSetData(dataDir, again);
    expect((await readdir(join(dataDir, "demo"))).sort()).toEqual([
      "LICENSE",
      "icons.json",
      "info.json",
      "metadata.json",
      "search.json",
    ]);
  });
});

describe("отчёт и галерея сборки", () => {
  it("сводка в терминале", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": CIRCLE });
    const text = formatBuildReport(await build());
    expect(text).toContain(
      "Иконок: 2 · в наборе: 2 · алиасов: 0 · исключено: 0",
    );
    expect(text).toMatch(
      /Размер: исходные SVG .+ → до SVGO .+ → после SVGO .+ \(.\d/,
    );
    expect(text).toContain("transform: было 0 · осталось 0");
    expect(text).toContain("Итог: можно записывать");
  });

  it("третья строка «SVGO», свои ID на плитках, CSP, повтор даёт те же файлы", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": WITH_IDS });
    const r = await build();
    const files = [...renderBuildGallery([r])];
    expect(files.map((f) => f.name)).toEqual([
      "index.html",
      "qc.html",
      "demo-1.html",
      "metadata.html",
    ]);
    const page = files[2]?.html ?? "";
    expect(page.match(/<span class="lbl">SVGO<\/span>/g)).toHaveLength(2);
    expect(page.match(/<span class="lbl">до SVGO<\/span>/g)).toHaveLength(2);
    expect(page).toContain(`<symbol id="p0" viewBox="0 0 24 24">`);
    expect(page.match(/<use href="#p0"\/>/g)).toHaveLength(9);
    // У иконки с ID — 9 копий «до SVGO» (t0–t8) и 9 копий «после SVGO» (t9–t17).
    for (let t = 0; t < 18; t++) expect(page).toContain(`id="demo--b-t${t}-0"`);
    for (const f of files) {
      expect(f.html).toContain(
        `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`,
      );
      expect(f.html).not.toMatch(/<script|<iframe|<foreignObject|\son\w+=/i);
      expect(f.html).toContain("Demo &lt;b&gt;");
    }
    expect([...renderBuildGallery([r])]).toEqual(files);
  });

  it("сводка галереи: таблица размеров и значки алиасов на карточке старшего варианта", async () => {
    await makeSet({ "icons/add.svg": SQUARE, "icons/add-outline.svg": SQUARE });
    const r = await build(
      config({ variantAliases: ["", "-outline"], suffixes: OUTLINE }),
    );
    const [index, , page] = [...renderBuildGallery([r])].map((f) => f.html);
    expect(index).toContain("<th>transform: было → осталось</th>");
    expect(index).toContain(`<span class="ok">можно записывать</span>`);
    expect(page).toContain(
      `<span class="badge alias">алиасы: add-outline</span>`,
    );
    expect(page?.match(/<article /g)).toHaveLength(1);
  });
});

describe("контроль качества при сборке", () => {
  const DOT = svg(`<circle cx="12" cy="12" r=".75"/>`);
  const EDGE = svg(`<circle cx="22" cy="12" r="6"/>`);
  const EMPTY = svg(`<circle cx="12" cy="12" r=".1"/>`);

  /** Прошлая версия из собранного icons.json. */
  const baselineOf = (json: string, sourceChanged = false): Baseline => ({
    label: "коммит ccccccc, demo-icons@1.0.0",
    sourceChanged,
    icons: iconsByName(JSON.parse(json)),
  });

  it("пустая иконка останавливает набор и старый файл не трогает", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/empty.svg": EMPTY });
    await mkdir(join(dataDir, "demo"));
    await writeFile(join(dataDir, "demo", "icons.json"), "старый", "utf8");
    const r = await build();
    expect(r.qc.findings.map((f) => [f.kind, f.name])).toEqual([
      ["empty", "empty"],
    ]);
    expect(r.stop).toEqual([
      "пустые иконки: 1 — закрашено меньше 0,05% холста",
    ]);
    expect(r.json).toBeUndefined();
    expect(await writeSetData(dataDir, r)).toBeUndefined();
    expect(await readFile(join(dataDir, "demo", "icons.json"), "utf8")).toBe(
      "старый",
    );
  });

  it("почти пустая и обрезанная — только в отчёте, набор записывается", async () => {
    await makeSet({ "icons/dot.svg": DOT, "icons/edge.svg": EDGE });
    const r = await build();
    expect(r.qc.findings.map((f) => [f.kind, f.name])).toEqual([
      ["sparse", "dot"],
      ["cropped", "edge"],
    ]);
    expect(r.stop).toEqual([]);
    expect(parsed(r).icons.dot).toBeDefined();
  });

  it("больше 2% изменений при том же источнике — «СТОП»; с acceptChanges или новым источником — запись того же файла", async () => {
    await makeSet({
      "icons/a.svg": SQUARE,
      "icons/b.svg": SQUARE,
      "icons/c.svg": SQUARE,
    });
    const before = (await build()).json as string;
    await makeSet({ "icons/c.svg": CIRCLE });
    // Без прошлой версии сравнивать не с чем — файл записывается.
    expect((await build()).json).toBeDefined();

    const opts = (extra: object) =>
      buildSet(config(), dir, entry(), {
        baseline: baselineOf(before),
        ...extra,
      });
    const stopped = await opts({});
    expect(stopped.json).toBeUndefined();
    expect(stopped.stop.join("\n")).toMatch(
      /изменилось или пропало 33,3% имён/,
    );
    expect(stopped.qc.findings.map((f) => [f.kind, f.name])).toEqual([
      ["changed", "c"],
    ]);
    const accepted = await opts({ acceptChanges: true });
    const updated = await buildSet(config(), dir, entry("2.0.0"), {
      baseline: baselineOf(before, true),
    });
    const fresh = await buildSet(config(), dir, entry("2.0.0"));
    expect(accepted.json).toBeDefined();
    expect(accepted.json).toBe(fresh.json);
    expect(updated.json).toBe(fresh.json);
    expect(fresh.json).not.toBe(before);
  });

  it("с прошлой версией и без неё icons.json побайтно одинаков", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": CIRCLE });
    const first = await build();
    const second = await buildSet(config(), dir, entry(), {
      baseline: baselineOf(first.json as string),
    });
    expect(second.json).toBe(first.json);
    expect([second.qc.changed, second.qc.added, second.qc.missing]).toEqual([
      0,
      [],
      [],
    ]);
  });

  it("отчёт: строки в терминале, раздел в сводке, qc.html, значки на карточках", async () => {
    await makeSet({ "icons/dot.svg": DOT, "icons/edge.svg": EDGE });
    const r = await buildSet(config(), dir, entry(), {
      baselineNote: "data/demo/icons.json ещё нет в истории git",
    });
    const text = formatBuildReport(r);
    expect(text).toContain(
      "Контроль: нарисовано 2 · пустых 0 · почти пустых 1 · обрезанных 1 · отличаются от оригинала 0",
    );
    expect(text).toContain(
      "Прошлая версия: сравнивать не с чем — data/demo/icons.json ещё нет в истории git",
    );
    const files = [...renderBuildGallery([r])];
    const [index, qc, page] = files.map((f) => f.html);
    expect(index).toContain("<h2>Контроль качества</h2>");
    expect(index).toContain(`<a href="qc.html">qc.html</a>`);
    expect(qc).toContain("<h3>Почти пустые (1)</h3>");
    expect(qc).toContain("<h3>Обрезанные (1)</h3>");
    expect(qc).toContain(`<a href="demo-1.html#i-dot">demo:dot</a>`);
    expect(qc?.match(/src="data:image\/png;base64,/g)).toHaveLength(2);
    expect(qc?.match(/src="data:image\/svg\+xml;base64,/g)).toHaveLength(2);
    expect(page).toMatch(/<span class="badge">почти пустая: закрашено \d/);
    for (const f of files) {
      expect(f.html).toContain(
        `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`,
      );
      expect(f.html).not.toMatch(/<script|<iframe|<foreignObject|\son\w+=/i);
      expect(f.html).toContain("Demo &lt;b&gt;");
    }
    expect([...renderBuildGallery([r])]).toEqual(files);
  });
});
