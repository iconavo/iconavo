import { describe, expect, it } from "vitest";
import { fakeLimiter, VERSION } from "../../api/src/fake.testing.js";
import { parseSvgOptions, svgBody } from "../../api/src/svg.js";
import { mcpSetup, USAGE } from "./fake.testing.js";

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.find((c) => c.type === "text")?.text ?? "";

type Out = Record<string, unknown>;

describe("MCP: get_icon", () => {
  it("по умолчанию — веб-компонент 24 px, установка из README, автор, лицензия, стили, описание и похожие", async () => {
    const s = mcpSetup();
    const result = await s.call("get_icon", { icon: "demo:house" });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Out;
    expect(out.code).toBe(
      '<iconavo-icon icon="demo:house" width="24"></iconavo-icon>',
    );
    expect(out.format).toBe("html");
    expect(out.setup).toEqual({
      install: "npm install @iconavo-ui/icon",
      import: USAGE.install.tag.import,
      script: USAGE.install.script,
    });
    expect(out.set).toMatchObject({
      prefix: "demo",
      license: { spdx: "ISC" },
      author: { name: "Demo Authors" },
    });
    expect(out.attribution).toMatch(/^Icons: Demo by Demo Authors/);
    expect(out.attribution).toContain("Feather");
    expect(out.style).toBe("outline");
    expect(out.styles).toEqual([
      { style: "outline", icons: ["demo:house"] },
      { style: "filled", icons: ["demo:house-fill"] },
    ]);
    expect(out.description).toEqual({ en: "A house", ru: "Дом" });
    expect((out.similar as string[]).length).toBeGreaterThan(0);
    expect(out.page).toBe("https://iconavo.dev/demo/house");
    const text = textOf(result);
    expect(text).toContain(
      '<iconavo-icon icon="demo:house" width="24"></iconavo-icon>',
    );
    expect(text).toContain("License — keep this attribution: Icons: Demo");
    expect(text).toContain("Other styles: filled — demo:house-fill.");
  });

  it("React с размером, цветом, толщиной и поворотом — как у генератора сайта", async () => {
    const s = mcpSetup();
    const result = await s.call("get_icon", {
      icon: "demo:house",
      format: "react",
      size: 32,
      color: "#E13",
      strokeWidth: 1.5,
      rotate: 90,
    });
    const out = result.structuredContent as Out;
    expect(out.code).toBe(
      'import { Icon } from "@iconavo-ui/react";\n\n<Icon icon="demo:house" width={32} color="#ee1133" strokeWidth={1.5} rotate="90deg" />',
    );
    expect(out.applied).toEqual({
      size: 32,
      color: "#ee1133",
      strokeWidth: 1.5,
      rotate: 90,
    });
    expect(out.notes).toEqual([]);
    expect(out.setup).toEqual({
      install: "npm install @iconavo-ui/react",
      import: USAGE.install.react.import,
    });
  });

  it("SVG — только по просьбе: комментарий об авторстве и рисунок побайтно как у адреса SVG edge API", async () => {
    const s = mcpSetup();
    const result = await s.call("get_icon", {
      icon: "demo:house",
      format: "svg",
      color: "#e11d48",
      strokeWidth: 1.5,
    });
    const out = result.structuredContent as Out;
    const [comment, svg] = String(out.code).split("\n");
    expect(comment).toMatch(/^<!-- demo:house\. Icons: Demo by Demo Authors/);
    expect(out.svgUrl).toBe(
      "https://api.iconavo.dev/demo/house.svg?width=24&color=e11d48&stroke-width=1.5",
    );
    const file = JSON.parse(
      s.bucket.files.get(`v/${VERSION}/demo/house.json`) as string,
    );
    expect(svg).toBe(
      svgBody(
        file,
        "house",
        parseSvgOptions(new URL(String(out.svgUrl)).searchParams),
      ),
    );
    expect(out.setup).toBeUndefined();
  });

  it("старое имя — сведения об основной иконке и пометка", async () => {
    const s = mcpSetup();
    const result = await s.call("get_icon", { icon: "demo:home" });
    const out = result.structuredContent as Out;
    expect(out.icon).toBe("demo:house");
    expect(out.requested).toBe("demo:home");
    expect(textOf(result)).toContain("demo:home is an old name of this icon.");
  });

  it("цветной набор: цвет и толщина не применяются — и это сказано", async () => {
    const s = mcpSetup();
    const result = await s.call("get_icon", {
      icon: "color:swan",
      color: "#ff0000",
      strokeWidth: 2,
    });
    const out = result.structuredContent as Out;
    expect(out.code).toBe(
      '<iconavo-icon icon="color:swan" width="24"></iconavo-icon>',
    );
    expect(out.applied).toEqual({ size: 24 });
    expect(out.notes).toEqual([
      "Color is not applied: Color is a multicolor set.",
      "Stroke width is not applied: this icon has no lines that change with it.",
    ]);
  });

  it("Meilisearch не ответил — код всё равно есть, без описания и похожих", async () => {
    const s = mcpSetup({ meiliStatus: 500 });
    const result = await s.call("get_icon", { icon: "demo:house" });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Out;
    expect(out.code).toBe(
      '<iconavo-icon icon="demo:house" width="24"></iconavo-icon>',
    );
    expect(out.set).toMatchObject({ license: { spdx: "ISC" } });
    expect(out.description).toBeNull();
    expect(textOf(result)).toContain("temporarily unavailable");
  });

  it("нет иконки — 404; лимит сведений — 300 в минуту с адреса, ошибка с подсказкой", async () => {
    const s = mcpSetup();
    const missing = await s.call("get_icon", { icon: "demo:nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/icon_not_found/);
    const limited = mcpSetup({ iconLimiter: fakeLimiter(0) });
    const result = await limited.call("get_icon", { icon: "demo:house" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/at most 300 icon details per minute/);
  });
});

describe("MCP: get_matching_set", () => {
  it("по образцу like: набор, стиль и вариант образца у всех иконок", async () => {
    const s = mcpSetup();
    const result = await s.call("get_matching_set", {
      concepts: ["love", "home"],
      like: "demo:house-fill",
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Out;
    expect(out.set).toMatchObject({ prefix: "demo", license: { spdx: "ISC" } });
    expect(out.style).toBe("filled");
    expect(out.variant).toBe("-fill");
    expect(
      (out.icons as { concept: string; icon: string; code: string }[]).map(
        (x) => [x.concept, x.icon, x.code],
      ),
    ).toEqual([
      [
        "love",
        "demo:heart-fill",
        '<iconavo-icon icon="demo:heart-fill" width="24"></iconavo-icon>',
      ],
      [
        "home",
        "demo:house-fill",
        '<iconavo-icon icon="demo:house-fill" width="24"></iconavo-icon>',
      ],
    ]);
    expect(out.attribution).toMatch(/^Icons: Demo by Demo Authors/);
    expect(textOf(result)).toContain(
      "Matching icons from Demo (filled, variant -fill):",
    );
  });

  it("без образца — набор, где нашлись все понятия, стиль — первый по шкале; векторы — одним вызовом модели", async () => {
    const s = mcpSetup();
    const result = await s.call("get_matching_set", {
      concepts: ["house", "heart"],
      format: "react",
    });
    const out = result.structuredContent as Out;
    expect(out.set).toMatchObject({ prefix: "demo" });
    expect(out.style).toBe("outline");
    expect(out.variant).toBeNull();
    expect(
      (out.icons as { icon: string; code: string }[]).map((x) => x.code),
    ).toEqual([
      '<Icon icon="demo:house" width={24} />',
      '<Icon icon="demo:heart" width={24} />',
    ]);
    expect(out.setup).toMatchObject({ import: USAGE.install.react.import });
    expect(s.net.polza).toHaveLength(1);
    expect(s.net.polza[0]?.input).toEqual(["house", "heart"]);
  });

  it("лимит поиска — один на вызов, по адресу человека", async () => {
    const limiter = fakeLimiter(0);
    const s = mcpSetup({ limiter });
    const result = await s.call("get_matching_set", {
      concepts: ["house", "heart"],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rate_limited/);
    expect([...limiter.counts.values()]).toEqual([1]);
  });

  it("одно понятие — ошибка схемы: нужно от двух", async () => {
    const s = mcpSetup();
    const result = await s.call("get_matching_set", { concepts: ["house"] });
    expect(result.isError).toBe(true);
  });
});

describe("MCP: get_usage", () => {
  it("по умолчанию — веб-компонент из npm: команда, строка подключения, пример, советы и лицензии из README", async () => {
    const s = mcpSetup();
    const result = await s.call("get_usage", {});
    const out = result.structuredContent as Out;
    expect(out).toMatchObject({
      framework: "html",
      package: "@iconavo-ui/icon",
      version: USAGE.version,
      install: "npm install @iconavo-ui/icon",
      setup: USAGE.install.tag.import,
      docs: "https://iconavo.dev/docs",
    });
    expect(out.example).toContain("<iconavo-icon");
    expect(out.tips).toContain(USAGE.sections.label);
    expect(out.licenses).toBe(USAGE.sections.license);
    expect(textOf(result)).toContain("MIT");
  });

  it("без сборщика — строки <script> с хэшем; Next.js через pnpm — рецепт с IconavoProvider", async () => {
    const s = mcpSetup();
    const script = (await s.call("get_usage", { framework: "script" }))
      .structuredContent as Out;
    expect(script.install).toBeUndefined();
    expect(script.setup).toBe(USAGE.install.script);
    expect(script.example).toBe(USAGE.sections.html);
    const next = (
      await s.call("get_usage", { framework: "next", packageManager: "pnpm" })
    ).structuredContent as Out;
    expect(next.install).toBe("pnpm add @iconavo-ui/react");
    expect(next.example).toContain("IconavoProvider");
  });
});

describe("MCP: list_sets", () => {
  it("наборы с автором, лицензией, стилями и пометкой о коммерческих проектах; тексты лицензий — по просьбе", async () => {
    const s = mcpSetup();
    const result = await s.call("list_sets", {});
    const out = result.structuredContent as {
      sets: Record<string, unknown>[];
    };
    // Порядок — как в оглавлении каталога раздачи: по префиксам.
    expect(out.sets.map((x) => x.prefix)).toEqual(["color", "demo"]);
    expect(out.sets[1]).toMatchObject({
      name: "Demo",
      total: 4,
      author: { name: "Demo Authors" },
      license: { spdx: "ISC" },
      styles: ["outline", "filled"],
      commercialUse: true,
      page: "https://iconavo.dev/demo",
    });
    expect(out.sets[1]?.licenseText).toBeUndefined();
    expect(textOf(result)).toMatch(/^2 icon sets, all allow commercial use/);
    const full = (await s.call("list_sets", { licenseText: true }))
      .structuredContent as { sets: Record<string, unknown>[] };
    expect(full.sets[1]?.licenseText).toBe("ISC License");
  });
});
