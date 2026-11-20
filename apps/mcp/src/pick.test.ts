import {
  PICKER_META_KEY,
  type PickerPayload,
  parsePickerPayload,
  pickerChoice,
} from "@iconavo-ui/snippets/picker";
import { describe, expect, it } from "vitest";
import { fakeLimiter } from "../../api/src/fake.testing.js";
import { FEATHER, mcpSetup, PNG_SIGNATURE, USAGE } from "./fake.testing.js";

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.find((c) => c.type === "text")?.text ?? "";

function payloadOf(result: { _meta?: Record<string, unknown> }): PickerPayload {
  const payload = parsePickerPayload(result._meta?.[PICKER_META_KEY]);
  if (payload === undefined) throw new Error("нет данных сетки в _meta");
  return payload;
}

describe("MCP: pick_icon (сетка выбора в чате, ADR-0045)", () => {
  it("варианты поиска: текст и картинка — модели, данные сетки — в _meta: рисунки всех стилей, наборы, установка", async () => {
    const s = mcpSetup();
    const result = await s.call("pick_icon", { query: "house" });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toMatch(/The picker shows 3 icons for "house"/);
    expect(text).toMatch(/1\. demo:house — Demo, outline \(exact name\)/);
    expect(text).toMatch(/ask the user for a number, then call get_icon/);
    expect(text).toMatch(/Licenses/);
    const image = result.content.find((c) => c.type === "image");
    expect([...Buffer.from(image?.data ?? "", "base64")].slice(0, 8)).toEqual(
      PNG_SIGNATURE,
    );
    expect(result.structuredContent).toMatchObject({
      query: "house",
      count: 3,
      format: "html",
      size: 24,
      preview: true,
    });
    const payload = payloadOf(result);
    expect(payload.cards).toEqual([
      {
        n: 1,
        icon: "demo:house",
        style: "outline",
        styles: { outline: "demo:house", filled: "demo:house-fill" },
        exact: true,
      },
      {
        n: 2,
        icon: "color:swan",
        style: "color",
        styles: { color: "color:swan" },
      },
      {
        n: 3,
        icon: "demo:heart",
        style: "outline",
        styles: { outline: "demo:heart", filled: "demo:heart-fill" },
      },
    ]);
    expect(Object.keys(payload.icons)).toEqual([
      "color:swan",
      "demo:heart",
      "demo:heart-fill",
      "demo:house",
      "demo:house-fill",
    ]);
    // Feather — только у иконок из его списка, как у /icon.
    expect(payload.icons["demo:house"]?.credits).toEqual([
      {
        name: FEATHER.name,
        author: FEATHER.author,
        license: FEATHER.license,
        url: FEATHER.url,
      },
    ]);
    expect(payload.icons["demo:house-fill"]?.credits).toBeUndefined();
    expect(payload.sets.map((set) => [set.prefix, set.palette])).toEqual([
      ["demo", false],
      ["color", true],
    ]);
    expect(payload.install).toEqual(USAGE.install);
    expect(payload).toMatchObject({
      api: "https://api.iconavo.dev",
      site: "https://iconavo.dev",
      format: "html",
      size: 24,
    });
  });

  it.each(["html", "react", "svg"] as const)(
    "код выбора в сетке — побайтно как у get_icon (%s, свой цвет, стиль «Заливка»)",
    async (format) => {
      const s = mcpSetup();
      const picked = await s.call("pick_icon", { query: "house", format });
      const payload = payloadOf(picked);
      const card = payload.cards[0];
      if (card === undefined) throw new Error("нет карточки");
      const choice = pickerChoice(payload, card, "filled", "#e11d48");
      const icon = await s.call("get_icon", {
        icon: "demo:house-fill",
        format,
        color: "#e11d48",
      });
      const out = icon.structuredContent as {
        code: string;
        svgUrl?: string;
        setup?: unknown;
        attribution: string;
      };
      expect(choice?.code).toBe(out.code);
      expect(choice?.svgUrl).toBe(out.svgUrl);
      expect(choice?.setup).toEqual(out.setup);
      expect(choice?.attribution).toBe(out.attribution);
      expect(choice?.color).toBe("#e11d48");
    },
  );

  it("SVG иконки из Feather — с той же строкой об авторстве, что у get_icon", async () => {
    const s = mcpSetup();
    const payload = payloadOf(
      await s.call("pick_icon", { query: "house", format: "svg" }),
    );
    const card = payload.cards[0];
    if (card === undefined) throw new Error("нет карточки");
    const choice = pickerChoice(payload, card, "any", undefined);
    const icon = await s.call("get_icon", {
      icon: "demo:house",
      format: "svg",
    });
    expect(choice?.code).toBe(
      (icon.structuredContent as { code: string }).code,
    );
    expect(choice?.code).toMatch(/Based on Feather by Cole Bemis/);
  });

  it("старое имя в выдаче — каноническое в данных сетки, как у get_icon", async () => {
    const s = mcpSetup();
    const result = await s.call("pick_icon", { query: "demo:home" });
    const payload = payloadOf(result);
    expect(payload.cards[0]?.icon).toBe("demo:house");
    expect(payload.icons["demo:home"]).toBeUndefined();
  });

  it("цвет и стиль от ассистента — начальные в сетке; у цветного набора цвет в код не идёт", async () => {
    const s = mcpSetup();
    const payload = payloadOf(
      await s.call("pick_icon", {
        query: "house",
        color: "#E11",
        style: "filled",
        size: 32,
      }),
    );
    expect(payload).toMatchObject({
      color: "#ee1111",
      style: "filled",
      size: 32,
    });
    const all = payloadOf(await s.call("pick_icon", { query: "house" }));
    const swan = all.cards.find((card) => card.icon === "color:swan");
    if (swan === undefined) throw new Error("нет лебедя");
    const choice = pickerChoice(all, swan, "any", "#e11d48");
    expect(choice?.color).toBeUndefined();
    expect(choice?.notes).toEqual([
      "Color is not applied: Color is a multicolor set.",
    ]);
  });

  it("ничего не нашлось — без картинки, сетка покажет пустую выдачу", async () => {
    const s = mcpSetup();
    const result = await s.call("pick_icon", {
      query: "house",
      sets: ["demo"],
      style: "color",
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^No icons found for "house"/);
    expect(result.content.some((c) => c.type === "image")).toBe(false);
    expect(payloadOf(result).cards).toEqual([]);
  });

  it("лимит частоты — общий с search_icons: ошибка инструмента с подсказкой", async () => {
    const s = mcpSetup({ limiter: fakeLimiter(0) });
    const result = await s.call("pick_icon", { query: "house" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rate_limited/);
  });
});
