import { describe, expect, it } from "vitest";
import type { CheckReport, TargetReport } from "./check.js";
import {
  formatCheckSummary,
  formatCheckTable,
  formatCheckTotal,
} from "./check-report.js";

const MANIFEST: TargetReport = {
  kind: "manifest",
  path: "manifest.json",
  status: 200,
  checked: [
    "status",
    "cors",
    "security",
    "type",
    "cache",
    "edge",
    "encoding",
    "body",
  ],
  issues: [],
};
const MISSING: TargetReport = {
  kind: "missing",
  path: "v/abcd1234/demo/_missing.json",
  status: 404,
  checked: ["status", "cors", "security"],
  issues: [
    { group: "cors", message: "Access-Control-Allow-Origin: нет вместо «*»" },
  ],
};
const SILENT: TargetReport = {
  kind: "svg",
  path: "v/abcd1234/demo/house.svg",
  checked: ["status"],
  issues: [{ group: "status", message: "нет ответа за 30 с" }],
};

const report = (
  targets: TargetReport[],
  extra: Partial<CheckReport> = {},
): CheckReport => ({
  host: "cdn.test",
  provider: "cloudflare",
  set: "demo",
  icon: "house",
  version: "abcd1234",
  targets,
  stop: [],
  requests: 9,
  ms: 1200,
  ...extra,
});

describe("formatCheckTable", () => {
  it("«ок», «не так», код ответа и «—» у непроверенного", () => {
    const lines = formatCheckTable(report([MANIFEST, MISSING, SILENT])).split(
      "\n",
    );
    expect(lines[0]).toMatch(
      /^Адрес\s+Ответ\s+Тип\s+Кэш\s+CDN\s+CORS\s+Защита\s+Сжатие\s+Файл\s+Итог$/,
    );
    expect(lines[1]).toMatch(/^manifest\.json\s+200(\s+ок){8}$/);
    expect(lines[2]).toMatch(
      /^v\/abcd1234\/demo\/_missing\.json\s+404\s+—\s+—\s+—\s+не так\s+ок\s+—\s+—\s+не так$/,
    );
    expect(lines[3]).toMatch(
      /^v\/abcd1234\/demo\/house\.svg\s+нет(\s+—){7}\s+не так$/,
    );
  });
});

describe("formatCheckSummary", () => {
  it("что не так и где поправить — по группам с проблемами", () => {
    const lines = formatCheckSummary(report([MANIFEST, MISSING]));
    expect(lines).toContain(
      "  v/abcd1234/demo/_missing.json — CORS: Access-Control-Allow-Origin: нет вместо «*»",
    );
    expect(lines).toContain(
      "  CORS — правило заголовков Cloudflare «Раздача: CORS и защита» (ADR-0023)",
    );
    expect(lines.filter((l) => l.startsWith("  Ответ —"))).toEqual([]);
    expect(lines.at(-2)).toBe(
      "Хост https://cdn.test, образец demo:house, версия abcd1234; запросов 9 за 1,2 с.",
    );
    expect(lines.at(-1)).toBe("Итог: не так — проблем 1.");
  });

  it("всё в порядке — только расшифровка, хост и итог", () => {
    const lines = formatCheckSummary(report([MANIFEST]));
    expect(lines).not.toContain("Не так:");
    expect(lines.at(-1)).toBe("Итог: ок — заголовки раздачи как в ADR-0023.");
  });

  it("манифест не прочитан — СТОП и без версии", () => {
    const lines = formatCheckSummary(
      report([SILENT], {
        version: undefined,
        stop: ["версия набора «demo» неизвестна — файлы версии не проверялись"],
      }),
    );
    expect(lines).toContain(
      "СТОП — версия набора «demo» неизвестна — файлы версии не проверялись",
    );
    expect(lines.at(-2)).toBe(
      "Хост https://cdn.test, образец demo:house; запросов 9 за 1,2 с.",
    );
    expect(lines.at(-1)).toBe("Итог: не так — проблем 2.");
  });

  it("второй хост — подсказки про правила зоны CDN Bunny и запись DNS only", () => {
    const edge: TargetReport = {
      ...MANIFEST,
      issues: [
        {
          group: "edge",
          message: "ответ пришёл не от BunnyCDN: Server «cloudflare»",
        },
      ],
    };
    const lines = formatCheckSummary(
      report([edge, MISSING], { host: "cdn2.test", provider: "bunny" }),
    );
    expect(lines[0]).toContain("кэш на серверах Bunny (CDN-Cache)");
    const cors = lines.find((l) => l.startsWith("  CORS —"));
    expect(cors).toContain("«Раздача: CORS и защита»");
    expect(cors).toContain("встроенный CORS зоны выключен");
    const cdn = lines.find((l) => l.startsWith("  CDN —"));
    expect(cdn).toContain("«Раздача: манифест мимо кэша»");
    expect(cdn).toContain("«DNS only»");
  });
});

describe("formatCheckTotal", () => {
  it("оба хоста в порядке и манифесты совпадают", () => {
    expect(
      formatCheckTotal(
        [
          report([MANIFEST]),
          report([MANIFEST], { host: "cdn2.test", provider: "bunny" }),
        ],
        [],
      ),
    ).toEqual([
      "Итог по хостам: ок — cdn.test и cdn2.test, манифесты совпадают.",
    ]);
  });

  it("не так на хосте и манифесты различаются", () => {
    const lines = formatCheckTotal(
      [
        report([MANIFEST]),
        report([MISSING], { host: "cdn2.test", provider: "bunny" }),
      ],
      [
        "манифест https://cdn2.test/manifest.json не тот, что на https://cdn.test/manifest.json: demo — a и b",
      ],
    );
    expect(lines[0]).toBe("Хосты между собой — не так:");
    expect(lines).toContain(
      "  манифест https://cdn2.test/manifest.json не тот, что на https://cdn.test/manifest.json: demo — a и b",
    );
    expect(lines.at(-1)).toBe(
      "Итог по хостам: не так — cdn2.test, манифесты различаются.",
    );
  });
});
