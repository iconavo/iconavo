import { describe, expect, it } from "vitest";
import type {
  HostUploadReport,
  SetUploadReport,
  UploadReport,
} from "./upload.js";
import {
  formatHostTitle,
  formatUploadReport,
  formatUploadSummary,
  formatUploadTable,
  formatVerifyVerdict,
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
  stop: ["в хранилище уже лежат другие файлы этой версии (1): …"],
  samples: ["other/star.json", "other/star.svg"],
};
const primary: HostUploadReport = {
  host: "cdn.iconavo.dev",
  storage: "бакет R2 iconavo-cdn",
  sets: [uploaded, stopped],
  manifestStatus: "skipped",
  manifestNote: "остановлено наборов: 1",
  stop: [],
  ms: 2600,
};
const secondary: HostUploadReport = {
  host: "cdn2.iconavo.dev",
  storage: "хранилище Bunny iconavo-cdn",
  sets: [],
  manifestStatus: "skipped",
  manifestNote: "работа с хостом остановлена",
  stop: ["не выгружался: «СТОП» на cdn.iconavo.dev — иначе хосты разойдутся"],
  ms: 0,
};
const report: UploadReport = {
  dryRun: false,
  manifest: '{\n  "sets": {}\n}',
  hosts: [primary, secondary],
  stop: [],
  ms: 3000,
};

describe("отчёт выгрузки", () => {
  it("строки и таблица для терминала", () => {
    expect(formatHostTitle(primary)).toBe(
      "Хост https://cdn.iconavo.dev — бакет R2 iconavo-cdn",
    );
    expect(formatUploadReport(uploaded)).toBe(
      "demo\n  Версия 0123abcd · файлов 9 (1.5 КБ) · в хранилище было 2 · недоставало 7\n  выгружено 7 (1.2 КБ) за 2,5 с, сверка сошлась",
    );
    expect(formatUploadReport(stopped)).toContain(
      "  СТОП — в хранилище уже лежат другие файлы",
    );
    const table = formatUploadTable([uploaded, stopped]);
    expect(table.split("\n")[0]).toMatch(
      /^Набор\s+Версия\s+Файлов\s+Было\s+Выгружено\s+Размер\s+Время\s+Итог$/,
    );
    expect(table).toContain("demo   0123abcd");
    expect(table).toContain("выгружено");
    expect(table).toContain("СТОП");
    expect(formatUploadSummary(report)).toEqual([
      "Манифест https://cdn.iconavo.dev/manifest.json — не записан: остановлено наборов: 1",
      "Манифест https://cdn2.iconavo.dev/manifest.json — не записан: работа с хостом остановлена",
      "СТОП — cdn2.iconavo.dev: не выгружался: «СТОП» на cdn.iconavo.dev — иначе хосты разойдутся",
      "Время: 3,0 с",
    ]);
  });

  it("сводка показа и записанного манифеста", () => {
    const planned: UploadReport = {
      ...report,
      dryRun: true,
      hosts: [
        {
          ...primary,
          sets: [
            { ...uploaded, status: "planned", uploaded: 0, uploadedBytes: 0 },
          ],
          manifestStatus: "planned",
          manifestNote: undefined,
        },
      ],
    };
    expect(formatUploadSummary(planned)).toEqual([
      "Только показ: в хранилища ничего не записано.",
      "Манифест https://cdn.iconavo.dev/manifest.json — будет записан (в хранилище манифеста ещё не было)",
      "Время: 3,0 с",
    ]);
    expect(formatUploadTable(planned.hosts[0]?.sets ?? [])).toContain("(7)");
    const written: UploadReport = {
      ...report,
      hosts: [
        {
          ...primary,
          sets: [uploaded],
          remoteManifest: "{}",
          manifestStatus: "written",
          manifestNote: undefined,
        },
      ],
    };
    expect(formatUploadSummary(written)[0]).toBe(
      "Манифест https://cdn.iconavo.dev/manifest.json — записан",
    );
    const failed: UploadReport = {
      ...report,
      hosts: [],
      stop: ["manifest.json не читается"],
    };
    expect(formatUploadSummary(failed)).toEqual([
      "Манифесты: не записаны — прогон остановлен",
      "СТОП — manifest.json не читается",
      "Время: 3,0 с",
    ]);
  });

  it("итог сверки: совпадают или что разошлось", () => {
    const same: UploadReport = {
      ...report,
      dryRun: true,
      hosts: [
        {
          ...primary,
          sets: [{ ...uploaded, status: "unchanged" }],
          manifestStatus: "unchanged",
        },
        {
          ...secondary,
          sets: [{ ...uploaded, status: "unchanged" }],
          manifestStatus: "unchanged",
          stop: [],
        },
      ],
    };
    expect(formatVerifyVerdict(same)).toEqual([
      "Сверка: cdn.iconavo.dev и cdn2.iconavo.dev совпадают со сборкой — файлы версий и манифесты на месте.",
    ]);
    const differs: UploadReport = {
      ...same,
      hosts: [
        same.hosts[0] as HostUploadReport,
        {
          ...secondary,
          sets: [{ ...uploaded, status: "planned", missing: 12 }],
          manifestStatus: "planned",
          stop: [],
        },
      ],
    };
    const verdict = formatVerifyVerdict(differs);
    expect(verdict[0]).toBe(
      "Сверка: расхождения — cdn2.iconavo.dev: недостаёт файлов 12 (demo), манифест отличается.",
    );
    expect(verdict[1]).toContain("повторите сверку после неё");
  });

  it("страница: раздел на хост, ссылки на файлы выгруженного набора, причины СТОП, манифест", () => {
    const html = renderUploadPage({
      ...report,
      hosts: [
        {
          ...primary,
          remoteManifest: '{"sets":{"demo":1}}',
          manifestStatus: "written",
          manifestNote: undefined,
        },
        secondary,
      ],
    });
    expect(html).toContain("<title>Выгрузка</title>");
    expect(html).toContain(
      "<h2>Хост https://cdn.iconavo.dev — бакет R2 iconavo-cdn</h2>",
    );
    expect(html).toContain(
      "<h2>Хост https://cdn2.iconavo.dev — хранилище Bunny iconavo-cdn</h2>",
    );
    expect(html).toContain(
      'href="https://cdn.iconavo.dev/v/0123abcd/demo/gone.svg"',
    );
    expect(html).toContain(
      'href="https://cdn.iconavo.dev/v/0123abcd/demo.checksums.json"',
    );
    // У остановленного набора ссылок нет: его файлы не выкладывались.
    expect(html).not.toContain("v/89abcdef/other/star.svg");
    expect(html).toContain("СТОП — в хранилище уже лежат другие файлы");
    expect(html).toContain("СТОП — не выгружался");
    expect(html).toContain(
      "<p>В хранилище:</p><pre>{&quot;sets&quot;:{&quot;demo&quot;:1}}</pre>",
    );
    expect(html).toContain("<h2>Локальный манифест</h2>");
    expect(html).toContain("записан");
    const dry = renderUploadPage(
      {
        ...report,
        dryRun: true,
        hosts: [
          { ...primary, manifestStatus: "planned", manifestNote: undefined },
        ],
      },
      "Сверка хостов",
    );
    expect(dry).toContain("<title>Сверка хостов</title>");
    expect(dry).toContain("Только показ");
    expect(dry).toContain("В хранилище манифеста ещё не было.");
  });
});
