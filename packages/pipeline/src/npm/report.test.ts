import { describe, expect, it } from "vitest";
import type { NpmPackageReport, NpmPrepareReport } from "./prepare.js";
import {
  formatNpmVerdict,
  formatNpmVerifyTable,
  formatPrepareReport,
  formatPrepareSummary,
  formatPrepareTable,
  renderNpmVerifyPage,
  renderPreparePage,
} from "./report.js";
import type { NpmVerifyReport } from "./verify.js";

const pkg = (extra: Partial<NpmPackageReport>): NpmPackageReport => ({
  id: "demo",
  name: "@iconavo-ui/icons-demo",
  setName: "Demo <set>",
  setVersion: "aaaaaaaa",
  action: "minor",
  version: "1.1.0",
  base: "1.0.0",
  added: ["moon"],
  icons: 3,
  aliases: 1,
  hidden: 0,
  fingerprint: "f".repeat(64),
  files: [
    { path: "icons.json", bytes: 2048 },
    { path: "package.json", bytes: 900 },
  ],
  packageJson: '{"name":"@iconavo-ui/icons-demo"}\n',
  readme: "# <readme>\n",
  written: true,
  stop: [],
  ...extra,
});

const prepared = (packages: NpmPackageReport[]): NpmPrepareReport => ({
  tag: "next",
  packages,
  planWritten: true,
  removed: [],
});

describe("отчёт подготовки", () => {
  it("строки пакета: набор, решение, новые имена, папка", () => {
    const text = formatPrepareReport(pkg({}), "next");
    expect(text).toContain("Набор aaaaaaaa · иконок 3 · алиасов 1 · файлов 2");
    expect(text).toContain("next → 1.0.0: новых имён 1 — 1.1.0");
    expect(text).toContain("Новые имена: moon");
    expect(text).toContain("записано dist-npm/demo/");
  });

  it("итог: что выйдет и что ждёт первой публикации", () => {
    const lines = formatPrepareSummary(
      prepared([
        pkg({}),
        pkg({ id: "new", name: "@iconavo-ui/icons-new", action: "awaiting" }),
      ]),
    );
    expect(lines).toEqual([
      "План: dist-npm/plan.json — записан",
      "К публикации под тегом next: @iconavo-ui/icons-demo@1.1.0",
      expect.stringContaining("Ждут первой публикации: @iconavo-ui/icons-new"),
    ]);
  });

  it("«СТОП» — плана нет, CI ничего не опубликует", () => {
    const report = prepared([pkg({ action: undefined, stop: ["сломано"] })]);
    expect(formatPrepareSummary(report)).toEqual([
      "План: не записан — остановлено пакетов: 1; CI ничего не опубликует",
    ]);
    expect(formatPrepareTable(report)).toContain("СТОП");
  });

  it("страница: экранирование, ссылка на npm, одинаковый вход — одинаковая страница", () => {
    const report = prepared([pkg({})]);
    const html = renderPreparePage(report);
    expect(html).toContain("Demo &lt;set&gt;");
    expect(html).toContain("# &lt;readme&gt;");
    expect(html).toContain(
      'href="https://www.npmjs.com/package/@iconavo-ui/icons-demo"',
    );
    expect(html).not.toContain("<readme>");
    expect(renderPreparePage(report)).toBe(html);
  });
});

describe("отчёт проверки", () => {
  const report: NpmVerifyReport = {
    tag: "next",
    packages: [
      {
        id: "demo",
        name: "@iconavo-ui/icons-demo",
        status: "ok",
        version: "1.0.1",
        latest: "1.0.0",
        fingerprint: "f1",
        published: "f1",
        publisher: "trusted",
        provenance: {
          repository: "https://github.com/iconavo/iconavo",
          workflow: ".github/workflows/publish.yml",
          ref: "refs/heads/main",
        },
        files: 8,
        problems: [],
        notes: [],
      },
      {
        id: "new",
        name: "@iconavo-ui/icons-new",
        status: "awaiting",
        problems: [],
        notes: [],
      },
    ],
  };

  it("таблица и итог", () => {
    const table = formatNpmVerifyTable(report);
    expect(table).toContain("iconavo/iconavo, publish.yml, main");
    expect(table).toContain("доверенная публикация");
    expect(formatNpmVerdict(report)).toBe(
      "Итог: ок; ждут первой публикации: @iconavo-ui/icons-new",
    );
    expect(
      formatNpmVerdict({
        ...report,
        packages: [{ ...report.packages[0], status: "failed" } as never],
      }),
    ).toBe("Итог: не так — @iconavo-ui/icons-demo");
  });

  it("страница проверки детерминирована", () => {
    const html = renderNpmVerifyPage(report);
    expect(html).toContain("Итог: ок");
    expect(renderNpmVerifyPage(report)).toBe(html);
  });
});
