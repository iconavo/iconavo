import { describe, expect, it } from "vitest";
import {
  formatSearchIndexReport,
  formatSetsTable,
  renderSearchIndexPage,
} from "./report.js";
import type { SearchIndexReport } from "./run.js";

const report = (extra: Partial<SearchIndexReport> = {}): SearchIndexReport => ({
  mode: "write",
  stop: [],
  notes: [],
  sets: [
    { id: "lucide", version: "dbde54d2", live: "dbde54d2", cards: 1903 },
    { id: "ph", version: "2070c023", live: "11111111", cards: 1512 },
  ],
  cards: 3415,
  withText: 3415,
  settings: "update",
  settingsChanged: ["rankingRules"],
  documents: {
    add: 2,
    update: 1,
    delete: 1,
    same: 3411,
    samples: [
      { id: "lucide_house", change: "update" },
      { id: "ph_<x>", change: "delete" },
    ],
  },
  vectors: {
    stored: 3414,
    reused: 3413,
    missing: 2,
    computed: 2,
    brokenSets: [],
  },
  phrases: { total: 9000, stored: 8990, missing: 10, computed: 10 },
  rub: { estimate: 0.01, spent: 0.005, limit: 60 },
  version: { before: "aaaaaaaa", after: "bbbbbbbb", written: true },
  ms: 12_500,
  ...extra,
});

describe("отчёт робота индекса", () => {
  it("итог для терминала: документы, векторы, рубли, версия", () => {
    const text = formatSearchIndexReport(report()).join("\n");
    expect(text).toContain("запись");
    expect(text).toContain("Настройки: обновить (rankingRules)");
    expect(text).toMatch(/добавить 2 · изменить 1 · удалить 1/);
    expect(text).toContain("посчитано 2");
    expect(text).toContain("aaaaaaaa → bbbbbbbb (записана)");
  });

  it("«СТОП» и заметки — отдельными строками", () => {
    const text = formatSearchIndexReport(
      report({ stop: ["нет ключей"], notes: ["заметка"] }),
    ).join("\n");
    expect(text).toContain("  заметка");
    expect(text).toContain("  СТОП — нет ключей");
  });

  it("таблица наборов: раздача та же или другая версия", () => {
    const table = formatSetsTable(report());
    expect(table).toMatch(/lucide\s+dbde54d2\s+та же/);
    expect(table).toMatch(/ph\s+2070c023\s+11111111/);
  });

  it("страница экранирует имена и показывает изменения", () => {
    const html = renderSearchIndexPage(report());
    expect(html).toContain("ph_&lt;x&gt;");
    expect(html).not.toContain("ph_<x>");
    expect(html).toContain("Без остановок.");
    const stopped = renderSearchIndexPage(report({ stop: ["оценка выше"] }));
    expect(stopped).toContain("СТОП");
    expect(stopped).toContain("оценка выше");
  });
});
