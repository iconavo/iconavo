import { describe, expect, it } from "vitest";
import { SIDEBAR_KEY, SIDEBAR_SCRIPT } from "./sidebar";

// Скрипт панели выполняется в <head> до отрисовки; здесь — на поддельных document и localStorage.
function run(storage: { getItem(key: string): string | null }) {
  const dataset: Record<string, string> = {};
  const document = { documentElement: { dataset } };
  new Function("localStorage", "document", SIDEBAR_SCRIPT)(storage, document);
  return dataset.sidebar;
}

describe("скрипт боковой панели в <head>", () => {
  it("свёрнутая панель — data-sidebar, иначе атрибута нет", () => {
    const stored = (value: string | null) => ({
      getItem: (key: string) => (key === SIDEBAR_KEY ? value : null),
    });
    expect(run(stored("collapsed"))).toBe("collapsed");
    expect(run(stored(null))).toBeUndefined();
    expect(run(stored("open"))).toBeUndefined();
  });

  it("запрещённое хранилище не роняет страницу", () => {
    const denied = {
      getItem(): string | null {
        throw new Error("SecurityError");
      },
    };
    expect(() => run(denied)).not.toThrow();
  });
});
