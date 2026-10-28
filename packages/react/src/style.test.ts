import { afterEach, describe, expect, it, vi } from "vitest";
import { adopt, css } from "./style.js";

const KEY = Symbol.for("iconavo.react.css.1");

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe("лист стилей", () => {
  it("вид iconavo-loading — заглушка по умолчанию из configure(); none — без правил", () => {
    expect(css("skeleton", false)).toContain(
      ".iconavo-skeleton,.iconavo-loading{",
    );
    expect(css("spinner", false)).toContain(
      ".iconavo-spinner,.iconavo-loading{",
    );
    expect(css("none", false)).not.toContain("iconavo-loading");
  });

  it("рамка «нет» — только в режиме разработки; анимации без движения — как у тега", () => {
    expect(css("skeleton", true)).toContain(
      ".iconavo-missing{outline:1px dashed}",
    );
    expect(css("skeleton", false)).not.toContain("iconavo-missing");
    expect(css("skeleton", false)).toContain(
      "@media(prefers-reduced-motion:reduce){.iconavo-skeleton,.iconavo-loading,.iconavo-spinner{animation:iconavo-h .15s step-end}}",
    );
    expect(css("skeleton", false)).not.toMatch(/display/);
  });

  it("один лист на страницу: новый текст переписывает его", () => {
    class Sheet {
      text = "";
      replaceSync(text: string) {
        this.text = text;
      }
    }
    const document = { adoptedStyleSheets: [] as Sheet[] };
    vi.stubGlobal("CSSStyleSheet", Sheet);
    vi.stubGlobal("document", document);
    adopt("a{}");
    adopt("a{}");
    expect(document.adoptedStyleSheets).toHaveLength(1);
    const [sheet] = document.adoptedStyleSheets;
    adopt("b{}");
    expect(sheet?.text).toBe("b{}");
    expect(document.adoptedStyleSheets).toEqual([sheet]);
  });

  it("без листов в среде (как jsdom) — без стилей и без ошибок", () => {
    vi.stubGlobal("CSSStyleSheet", undefined);
    vi.stubGlobal("document", { adoptedStyleSheets: [] });
    expect(() => adopt("a{}")).not.toThrow();
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBeNull();
  });
});
