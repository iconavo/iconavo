import { describe, expect, it } from "vitest";
import {
  drawnVerdict,
  quietVerdict,
  serverLogVerdict,
  startersCheckFailed,
  trafficVerdict,
} from "./check.js";

describe("вердикты проверки примеров", () => {
  it("иконки: все нарисованы, без заглушек и рамок", () => {
    expect(
      drawnVerdict({ drawn: [true, true], loading: 0, missing: 0 }).ok,
    ).toBe(true);
    expect(
      drawnVerdict({ drawn: [true, false], loading: 1, missing: 0 }).note,
    ).toBe("нарисовано 1 из 2; заглушек осталось: 1");
    expect(drawnVerdict({ drawn: [], loading: 0, missing: 0 }).note).toContain(
      "иконок на странице нет",
    );
  });

  it("консоль: любое предупреждение — нет", () => {
    expect(quietVerdict([], []).ok).toBe(true);
    expect(quietVerdict(["Iconavo: icon x not found"], []).ok).toBe(false);
  });

  it("сеть браузера: иконки спрашивались, скрипт тега — один, больше никуда", () => {
    const icons = ["https://api.iconavo.dev/lucide.json?icons=a"];
    expect(
      trafficVerdict({ icons, scripts: ["s"], stray: [] }, { script: true }).ok,
    ).toBe(true);
    expect(
      trafficVerdict({ icons: [], scripts: [], stray: [] }, { script: false })
        .ok,
    ).toBe(false);
    expect(
      trafficVerdict(
        {
          icons,
          scripts: ["s", "s"],
          stray: ["https://fonts.example.com/a.woff2"],
        },
        { script: true },
      ).note,
    ).toBe("скрипт тега запрошен 2 раз; к другим адресам: fonts.example.com");
  });

  it("журнал сервера Next.js: через превью, без живых адресов", () => {
    expect(
      serverLogVerdict([
        "https://api.iconavo.dev/lucide.json -> http://127.0.0.1:1/lucide.json",
      ]).ok,
    ).toBe(true);
    expect(serverLogVerdict([]).ok).toBe(false);
    expect(
      serverLogVerdict(["unmapped https://mcp.iconavo.dev/x"]).note,
    ).toContain("живым адресам");
  });

  it("итог: нет результатов или хоть одно «нет» — провал", () => {
    expect(startersCheckFailed([])).toBe(true);
    expect(
      startersCheckFailed([
        {
          starter: "html",
          mode: "static",
          browser: "chrome",
          verdicts: { drawn: { ok: true, note: "" } },
          shots: [],
        },
      ]),
    ).toBe(false);
  });
});
