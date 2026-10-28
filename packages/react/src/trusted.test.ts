import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = Symbol.for("iconavo.trusted-types");

/** Новый модуль: проба «требуются ли Trusted Types» у каждого теста своя. */
const load = async () => (await import("./trusted.js")).trusted;

/** Документ, у которого запись строки в innerHTML падает, как при require-trusted-types-for. */
const enforced = (on: boolean) => ({
  createElement: () => ({
    set innerHTML(_: string) {
      if (on)
        throw new TypeError("This document requires 'TrustedHTML' assignment");
    },
  }),
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as Record<symbol, unknown>)[KEY];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("iconavo.core.1")];
});

describe("рисунок для innerHTML", () => {
  it("на сервере и без Trusted Types — строка, общий ключ не трогается", async () => {
    const trusted = await load();
    expect(trusted("<g/>")).toBe("<g/>");
    vi.stubGlobal("document", enforced(false));
    expect(trusted("<g/>")).toBe("<g/>");
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBeUndefined();
  });

  it("политика iconavo — одна на страницу, общая с тегом; рисунок — её объект", async () => {
    const createPolicy = vi.fn(
      (_: string, rules: { createHTML(s: string): string }) => ({
        createHTML: (s: string) => ({ trusted: rules.createHTML(s) }),
      }),
    );
    vi.stubGlobal("document", enforced(true));
    vi.stubGlobal("trustedTypes", { createPolicy });
    const trusted = await load();
    expect(trusted("<g/>")).toEqual({ trusted: "<g/>" });
    trusted("<path/>");
    expect(createPolicy).toHaveBeenCalledTimes(1);
    expect(createPolicy.mock.calls[0]?.[0]).toBe("iconavo");
  });

  it("политику не разрешили: Trusted Types не требуются — строка; требуются — null и одно предупреждение", async () => {
    const createPolicy = () => {
      throw new TypeError("Policy iconavo disallowed");
    };
    vi.stubGlobal("trustedTypes", { createPolicy });
    vi.stubGlobal("document", enforced(false));
    expect((await load())("<g/>")).toBe("<g/>");

    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[KEY];
    vi.stubGlobal("document", enforced(true));
    const trusted = await load();
    expect(trusted("<g/>")).toBeNull();
    expect(trusted("<path/>")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Iconavo: Trusted Types blocked icons, allow "trusted-types iconavo"',
    );
  });
});
