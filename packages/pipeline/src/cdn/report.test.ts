import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoConfig } from "../search/fixture.testing.js";
import { writeCdnDemoSet } from "./fixture.testing.js";
import {
  formatCdnReport,
  formatCdnSummary,
  formatCdnTable,
  renderCdnPage,
} from "./report.js";
import { buildCdn, type CdnReport } from "./run.js";

const HOUSE = '<path d="M1 1h2"/>';
const configs = [demoConfig("demo"), demoConfig("other")];

let root: string;
let dataDir: string;
let outDir: string;
let version: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "iconavo-cdn-"));
  dataDir = join(root, "data");
  outDir = join(root, "dist-cdn");
  version = (
    await writeCdnDemoSet(dataDir, {
      id: "demo",
      icons: { house: { body: HOUSE } },
      aliases: { home: { parent: "house" } },
      samples: ["house"],
    })
  ).version;
  await writeCdnDemoSet(dataDir, {
    id: "other",
    icons: { star: { body: "<g/>" } },
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const build = (): Promise<CdnReport> =>
  buildCdn(configs, { dataDir, outDir, concurrency: 2 });

describe("отчёт раздачи", () => {
  it("строки, таблица и итог для терминала", async () => {
    const report = await build();
    const first = report.sets[0];
    if (!first) throw new Error("нет набора");
    expect(formatCdnReport(first)).toBe(
      `demo — Demo demo\n  Версия ${version} · иконок 1 · алиасов 1 · файлов 4 · ${first.bytes} Б\n  записано dist-cdn/v/${version}/demo/`,
    );
    const table = formatCdnTable(report.sets);
    expect(table.split("\n")[0]).toMatch(
      /^Набор\s+Версия\s+Иконок\s+Алиасов\s+Файлов\s+Размер\s+Итог$/,
    );
    expect(table).toContain("записано");
    expect(formatCdnSummary(report)).toEqual([
      "Манифест: dist-cdn/manifest.json — записан",
      "Удалено устаревших: нет",
    ]);
    const again = await build();
    expect(formatCdnReport(again.sets[0] as typeof first)).toContain(
      "без изменений",
    );
    expect(formatCdnSummary(again)[0]).toBe(
      "Манифест: dist-cdn/manifest.json — без изменений",
    );
  });

  it("страница: дерево, примеры с адресами и превью, без абсолютных путей", async () => {
    const report = await build();
    const page = renderCdnPage(report);
    expect(page).toContain(
      `      demo/\n        home.json\n        home.svg\n        house.json\n        house.svg`,
    );
    expect(page).toContain(
      `https://cdn.iconavo.dev/v/${version}/demo/house.svg`,
    );
    expect(page).toContain("data:image/svg+xml;base64,");
    expect(page).toContain("&quot;aliases&quot;:{&quot;home&quot;");
    expect(page).toContain(`v/${version}/demo.checksums.json`);
    expect(page).toContain("&quot;sets&quot;: {");
    expect(page).not.toContain(root);
    expect(renderCdnPage(await build())).toBe(renderCdnPage(await build()));
  });

  it("СТОП виден в строках, таблице и на странице", async () => {
    await rm(join(dataDir, "other", "info.json"));
    const report = await build();
    const other = report.sets[1];
    if (!other) throw new Error("нет набора");
    expect(formatCdnReport(other)).toContain(
      "СТОП — info.json не читается — запустите pnpm data other",
    );
    expect(formatCdnTable(report.sets)).toContain("СТОП");
    expect(formatCdnSummary(report)[0]).toContain("не записан");
    const page = renderCdnPage(report);
    expect(page).toContain('<p class="stop">СТОП — info.json не читается');
    expect(page).toContain("Не записан: сборка остановлена.");
  });
});
