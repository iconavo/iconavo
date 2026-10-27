import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("входы пакета", () => {
  it("каждый вход отдаёт ровно четыре функции README", async () => {
    for (const entry of [
      () => import("./index.js"),
      () => import("./development.js"),
      () => import("./script.js"),
    ]) {
      vi.resetModules();
      expect(Object.keys(await entry()).sort()).toEqual([
        "addIcons",
        "configure",
        "loadIcons",
        "setLoader",
      ]);
    }
  });

  it("импорт без DOM, как на сервере, не падает и тег не регистрирует", async () => {
    expect(typeof customElements).toBe("undefined");
    vi.resetModules();
    await expect(import("./index.js")).resolves.toBeDefined();
    vi.resetModules();
    await expect(import("./script.js")).resolves.toBeDefined();
    expect(Object.getOwnPropertySymbols(globalThis).map(String)).not.toContain(
      "Symbol(iconavo.core.1)",
    );
  });
});
