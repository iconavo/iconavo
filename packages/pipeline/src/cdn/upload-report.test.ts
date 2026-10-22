import { describe, expect, it } from "vitest";
import type { SetUploadReport, UploadReport } from "./upload.js";
import {
  formatUploadReport,
  formatUploadSummary,
  formatUploadTable,
  renderUploadPage,
} from "./upload-report.js";

const uploaded: SetUploadReport = {
  id: "demo",
  version: "0123abcd",
  files: 9,
  bytes: 1536,
  present: 2,
  missing: 7,
  uploaded: 7,
  uploadedBytes: 1200,
  ms: 2500,
  status: "uploaded",
  stop: [],
  samples: ["demo/gone.json", "demo/gone.svg"],
};
const stopped: SetUploadReport = {
  ...uploaded,
  id: "other",
  version: "89abcdef",
  uploaded: 0,
  uploadedBytes: 0,
  status: "stopped",
  stop: ["в бакете уже лежат другие файлы этой версии (1): …"],
  samples: ["other/star.json", "other/star.svg"],
};
const report: UploadReport = {
  dryRun: false,
  sets: [uploaded, stopped],
  manifest: '{\n  "sets": {}\n}',
  manifestStatus: "skipped",
  stop: [],
  ms: 3000,
};

describe("отчёт выгрузки", () => {
  it("строки и таблица для терминала", () => {
    expect(formatUploadReport(uploaded)).toBe(
      "demo\n  Версия 0123abcd · файлов 9 (1.5 КБ) · в бакете было 2 · недоставало 7\n  выгружено 7 (1.2 КБ) за 2,5 с, сверка сошлась",
    );
    expect(formatUploadReport(stopped)).toContain(
      "  СТОП — в бакете уже лежат другие файлы",
    );
    const table = formatUploadTable([uploaded, stopped]);
    expect(table.split("\n")[0]).toMatch(
      /^Набор\s+Версия\s+Файлов\s+Было\s+Выгружено\s+Размер\s+Время\s+Итог$/,
    );
    expect(table).toContain("demo   0123abcd");
    expect(table).toContain("выгружено");
    expect(table).toContain("СТОП");
    expect(formatUploadSummary(report)).toEqual([
      "Манифест: не записан — остановлено наборов: 1",
      "Время: 3,0 с",
    ]);
  });

  it("сводка показа и записанного манифеста", () => {
    const planned: UploadReport = {
      ...report,
      dryRun: true,
      sets: [{ ...uploaded, status: "planned", uploaded: 0, uploadedBytes: 0 }],
      manifestStatus: "planned",
    };
    expect(formatUploadSummary(planned)).toEqual([
      "Только показ (--dry-run): в бакет ничего не записано.",
      "Манифест: https://cdn.iconavo.dev/manifest.json — будет записан (в бакете манифеста ещё не было)",
      "Время: 3,0 с",
    ]);
    expect(formatUploadTable(planned.sets)).toContain("(7)");
    const written: UploadReport = {
      ...report,
      sets: [uploaded],
      remoteManifest: "{}",
      manifestStatus: "written",
    };
    expect(formatUploadSummary(written)[0]).toBe(
      "Манифест: https://cdn.iconavo.dev/manifest.json — записан",
    );
    const failed: UploadReport = {
      ...report,
      sets: [],
      stop: ["manifest.json не читается"],
    };
    expect(formatUploadSummary(failed)).toEqual([
      "Манифест: не записан — прогон остановлен",
      "СТОП — manifest.json не читается",
      "Время: 3,0 с",
    ]);
  });

  it("страница: ссылки на файлы выгруженного набора, причины СТОП, манифест", () => {
    const html = renderUploadPage({
      ...report,
      remoteManifest: '{"sets":{"demo":1}}',
      manifestStatus: "written",
    });
    expect(html).toContain("<title>Выгрузка</title>");
    expect(html).toContain(
      'href="https://cdn.iconavo.dev/v/0123abcd/demo/gone.svg"',
    );
    expect(html).toContain(
      'href="https://cdn.iconavo.dev/v/0123abcd/demo.checksums.json"',
    );
    // У остановленного набора ссылок нет: его файлы не выкладывались.
    expect(html).not.toContain("v/89abcdef/other/star.svg");
    expect(html).toContain("СТОП — в бакете уже лежат другие файлы");
    expect(html).toContain(
      "<h3>В бакете</h3><pre>{&quot;sets&quot;:{&quot;demo&quot;:1}}</pre>",
    );
    expect(html).toContain("<h3>Локальный</h3>");
    expect(html).toContain("записан");
    const dry = renderUploadPage({
      ...report,
      dryRun: true,
      manifestStatus: "planned",
    });
    expect(dry).toContain("Только показ (--dry-run)");
    expect(dry).toContain("Манифеста ещё не было.");
  });
});
