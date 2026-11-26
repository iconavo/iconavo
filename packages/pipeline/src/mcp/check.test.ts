// Проверка живого MCP-сервера: чистые части без сети (ревизия фазы 5, И-22).

import { describe, expect, it } from "vitest";
import { licenseProblems, svgVsApi } from "./check.js";
import { renderMcpCheckMarkdown } from "./check-report.js";

describe("pnpm mcp check: сверки", () => {
  it("SVG против адреса edge API: ответ не 200 или сбой сети — так и сказано, а не «не совпадает»", async () => {
    expect(await svgVsApi("<svg/>", new Response("<svg/>"))).toEqual([]);
    expect(await svgVsApi("<svg/>", new Response("<svg></svg>"))).toEqual([
      "SVG не совпадает с адресом SVG edge API",
    ]);
    expect(
      await svgVsApi("<svg/>", new Response("not found", { status: 404 })),
    ).toEqual(["адрес SVG edge API ответил HTTP 404"]);
    expect(await svgVsApi("<svg/>", new Error("fetch failed"))).toEqual([
      "адрес SVG edge API не ответил: fetch failed",
    ]);
  });

  it("нет сведений о наборе — одна строка на набор, а не на каждую иконку", () => {
    const icon = (name: string) => ({
      icon: `demo:${name}`,
      set: "demo",
      license: "MIT",
      author: "Demo",
    });
    expect(
      licenseProblems({ results: [icon("a"), icon("b"), icon("c")], sets: [] }),
    ).toEqual(["нет сведений о наборе demo"]);
  });

  it("сводка CI: «|» и перевод строки в тексте проблемы не ломают таблицу", () => {
    const md = renderMcpCheckMarkdown({
      base: "https://mcp.iconavo.dev",
      build: "abc",
      rows: [{ name: "HTTP", problems: ["a|b\nc"] }],
      calls: [
        {
          era: "2025",
          tool: "search_icons",
          args: { query: "house" },
          ms: 12,
          isError: true,
          text: "",
          images: [],
          problems: ["ошибка SDK:\nx|y"],
        },
      ],
    });
    const lines = md.split("\n");
    const row = lines.find((line) => line.startsWith("| HTTP"));
    const call = lines.find((line) => line.startsWith("| search_icons"));
    // Колонки — только свои: «|» из текста экранирован, перевод строки — пробел.
    expect(row).toBe("| HTTP | нет: a\\|b c |");
    expect(call).toContain("нет: ошибка SDK: x\\|y |");
    expect(lines.some((line) => line === "c |" || line === "x|y |")).toBe(
      false,
    );
  });
});
