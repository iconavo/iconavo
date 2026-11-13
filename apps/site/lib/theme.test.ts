import { describe, expect, it } from "vitest";
import { THEME_KEY, THEME_SCRIPT, withThemeTransition } from "./theme";

// Скрипт темы выполняется в <head> до отрисовки; здесь — на поддельных document и localStorage.
function run(storage: { getItem(key: string): string | null }) {
  const dataset: Record<string, string> = {};
  const document = { documentElement: { dataset } };
  new Function("localStorage", "document", THEME_SCRIPT)(storage, document);
  return dataset.theme;
}

const stored = (value: string | null) => ({
  getItem: (key: string) => (key === THEME_KEY ? value : null),
});

describe("скрипт темы в <head>", () => {
  it("ставит выбранную светлую или тёмную тему", () => {
    expect(run(stored("light"))).toBe("light");
    expect(run(stored("dark"))).toBe("dark");
  });

  it("без выбора и с чужим значением — тема системы, атрибута нет", () => {
    expect(run(stored(null))).toBeUndefined();
    expect(run(stored("system"))).toBeUndefined();
    expect(run(stored("blue"))).toBeUndefined();
  });

  it("запрещённое хранилище не роняет страницу", () => {
    const denied = {
      getItem(): string | null {
        throw new Error("SecurityError");
      },
    };
    expect(() => run(denied)).not.toThrow();
    expect(run(denied)).toBeUndefined();
  });
});

describe("смена темы — плавно, если можно", () => {
  it("браузер умеет View Transitions — смена внутри перехода", () => {
    const calls: string[] = [];
    const doc = {
      startViewTransition(update?: unknown) {
        calls.push("переход");
        if (typeof update === "function") update();
        return {} as ViewTransition;
      },
    };
    withThemeTransition(
      () => calls.push("смена"),
      doc,
      () => false,
    );
    expect(calls).toEqual(["переход", "смена"]);
  });

  it("«уменьшить движение» или нет API — тема меняется сразу", () => {
    const calls: string[] = [];
    const doc = {
      startViewTransition() {
        calls.push("переход");
        return {} as ViewTransition;
      },
    };
    withThemeTransition(
      () => calls.push("смена"),
      doc,
      () => true,
    );
    withThemeTransition(
      () => calls.push("смена без API"),
      {} as Pick<Document, "startViewTransition">,
      () => false,
    );
    expect(calls).toEqual(["смена", "смена без API"]);
  });
});
