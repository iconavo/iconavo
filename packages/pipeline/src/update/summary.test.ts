import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BuildOptions,
  buildSet,
  type SetBuildReport,
} from "../build/run.js";
import { licenseHash } from "../metadata/license.js";
import { type Baseline, baselineFromTexts } from "../qc/baseline.js";
import {
  type SourceConfig,
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { SVG_NS } from "../svg/xml.js";
import { buildSummarySchema, setSummary, summaryText } from "./summary.js";

const LICENSE_TEXT = "MIT License\n\nCopyright (c) Demo\n";
const base: SourceConfigInput = {
  id: "demo",
  name: "Demo",
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
const ENTRY: LockEntry = {
  type: "npm",
  version: "1.0.0",
  integrity: "sha512-AAAA",
};

const svg = (body: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">${body}</svg>`;
const SQUARE = svg(`<path d="M4 4h16v16H4z"/>`);
const CIRCLE = svg(`<circle cx="12" cy="12" r="8"/>`);
const DOT = svg(`<circle cx="12" cy="12" r=".75"/>`);
const EDGE = svg(`<circle cx="22" cy="12" r="6"/>`);
const EMPTY = svg(`<circle cx="12" cy="12" r=".1"/>`);

/** Время сборки в тестах — постоянное: 20 октября 2026, 09:00 UTC. */
const NOW = Date.UTC(2026, 9, 20, 9) / 1000;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-summary-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Файлы источника; LICENSE и package.json пакета npm — по умолчанию. */
async function makeSet(files: Record<string, string>) {
  const all = {
    LICENSE: LICENSE_TEXT,
    "package.json": JSON.stringify({ name: "demo-icons", license: "MIT" }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }
}

const build = (options: BuildOptions = {}, cfg = config()) =>
  buildSet(cfg, dir, ENTRY, { now: NOW, ...options });

/** Прошлая версия — то, что записала сборка r, как будто её слили в main; источник обновился. */
const baselineFrom = (r: SetBuildReport): Baseline =>
  baselineFromTexts({
    label: "коммит ccccccc, demo-icons@0.9.0",
    sourceChanged: true,
    icons: r.json as string,
    changelog: r.changelog.files?.find((f) => f.name === "changelog.json")
      ?.text,
  });

/** Сводка как у pnpm data: записан набор, если сборка не остановилась. */
const summaryOf = (r: SetBuildReport, cfg: SourceConfig = config()) =>
  setSummary(cfg, r, ENTRY, r.json !== undefined);

describe("сводка сборки для робота обновления", () => {
  it("собранный набор: выпуск, счётчики, лицензия; summary.json проходит схему", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": CIRCLE });
    const r = await build();
    const s = summaryOf(r);
    expect(s).toMatchObject({
      id: "demo",
      name: "Demo",
      source: "demo-icons@1.0.0",
      entry: ENTRY,
      written: true,
      stop: [],
      excluded: [],
      release: {
        status: "new",
        version: r.changelog.version,
        total: 2,
        needsApproval: false,
      },
      qc: { checked: 2, attention: [] },
      license: { spdx: "MIT", status: "confirmed" },
    });
    expect(s.release.top?.version).toBe(r.changelog.version);
    expect(s.qc.counts).toEqual({
      failed: 0,
      empty: 0,
      sparse: 0,
      cropped: 0,
      changed: 0,
      original: 0,
    });
    const text = summaryText({ base: "версия в main", sets: [s], errors: [] });
    expect(text.endsWith("}\n")).toBe(true);
    expect(buildSummarySchema.parse(JSON.parse(text))).toEqual({
      base: "версия в main",
      sets: [s],
      errors: [],
    });
  });

  it("«СТОП» из-за пустой иконки: набор не записан, причина и счётчики — в сводке", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/empty.svg": EMPTY });
    const s = summaryOf(await build());
    expect(s.written).toBe(false);
    expect(s.stop).toEqual([
      "пустые иконки: 1 — закрашено меньше 0,05% холста",
    ]);
    expect(s.qc.counts.empty).toBe(1);
    expect(s.release.status).toBe("new");
  });

  it("новые находки — только у добавленных и изменённых иконок; без прошлой версии новое всё", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/edge.svg": EDGE });
    const first = await build();
    expect(summaryOf(first).qc.attention.map((f) => [f.kind, f.name])).toEqual([
      ["cropped", "edge"],
    ]);

    await makeSet({ "icons/dot.svg": DOT });
    const second = await build({ baseline: baselineFrom(first) });
    const s = summaryOf(second);
    // Обрезанная edge была и в прошлой версии — не новая; почти пустая dot только что появилась.
    expect(s.qc.attention.map((f) => [f.kind, f.name])).toEqual([
      ["sparse", "dot"],
    ]);
    expect(s.qc.attention[0]?.text).toMatch(/^закрашено /);
    expect(s.qc.counts).toMatchObject({ sparse: 1, cropped: 1 });
    expect(s.release.changes.added).toBe(1);
    expect(s.qc.baseline).toBe("коммит ccccccc, demo-icons@0.9.0");
  });

  it("выпуск «same»: верхний выпуск журнала старый — одобрение не нужно, выпуска в сводке нет", async () => {
    await makeSet({ "icons/a.svg": SQUARE, "icons/b.svg": CIRCLE });
    const first = await build();
    await rm(join(dir, "icons", "b.svg"));
    const second = await build({
      baseline: baselineFrom(first),
      now: NOW + 3600,
    });
    const hidden = summaryOf(second);
    expect(hidden.release.changes.hidden).toBe(1);
    expect(hidden.release.needsApproval).toBe(true);

    // Та же версия ещё раз: журнал не меняется, а наверху в нём — выпуск со скрытой b.
    const third = await build({
      baseline: baselineFrom(second),
      now: NOW + 7200,
    });
    expect(third.changelog.release).toBe("same");
    const s = summaryOf(third);
    expect(s.release.status).toBe("same");
    expect(s.release.needsApproval).toBe(false);
    expect(s.release.top).toBeUndefined();
    expect(s.release.changes.hidden).toBe(0);
  });

  it("исключённая при очистке иконка — в сводке, хотя набор записан", async () => {
    // Одна сломанная на 101: меньше 1% набор не останавливает (правило шага 4).
    const files: Record<string, string> = {
      "icons/x-broken.svg": "<svg><g></svg>",
    };
    for (let i = 0; i < 100; i++) {
      files[`icons/a${String(i).padStart(3, "0")}.svg`] = SQUARE;
    }
    await makeSet(files);
    const s = summaryOf(await build());
    expect(s.written).toBe(true);
    expect(s.excluded.map((e) => e.name)).toEqual(["x-broken"]);
    expect(s.excluded[0]?.reason).toMatch(/^очистка: /);
  });

  it("лицензия изменилась у автора: статус changed и ровно одна причина «СТОП»", async () => {
    await makeSet({ "icons/a.svg": SQUARE });
    const cfg = config({
      license: {
        spdx: "MIT",
        file: "LICENSE",
        confirmed: licenseHash("MIT", "Другой текст лицензии\n"),
      },
    });
    const s = summaryOf(await build({}, cfg), cfg);
    expect(s.written).toBe(false);
    expect(s.license.status).toBe("changed");
    expect(s.stop).toHaveLength(1);
    expect(s.stop[0]).toMatch(/лицензия изменилась у автора/);
  });
});
