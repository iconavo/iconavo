import { describe, expect, it } from "vitest";
import { THEME_KEY, THEME_SCRIPT } from "./theme";

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
