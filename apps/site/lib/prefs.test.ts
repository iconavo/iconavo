import { afterEach, describe, expect, it, vi } from "vitest";
import { choiceStore, readChoice } from "./prefs";

/** Хранилище браузера на Map. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("выбор генератора кода (шаг 5 фазы 4)", () => {
  it("из хранилища — только значение из списка", () => {
    const allowed = ["npm", "pnpm", "yarn"] as const;
    expect(readChoice("pnpm", allowed, "npm")).toBe("pnpm");
    expect(readChoice("bun", allowed, "npm")).toBe("npm");
    expect(readChoice(null, allowed, "npm")).toBe("npm");
  });

  it("запоминается в localStorage и читается новой копией хранилища", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const first = choiceStore("iconavo-pm", ["npm", "pnpm", "yarn"], "npm");
    expect(first.get()).toBe("npm");
    first.set("yarn");
    expect(storage.map.get("iconavo-pm")).toBe("yarn");
    const again = choiceStore("iconavo-pm", ["npm", "pnpm", "yarn"], "npm");
    expect(again.get()).toBe("yarn");
  });

  it("хранилище запрещено — по умолчанию, а выбор держится до перезагрузки", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    const store = choiceStore("iconavo-code", ["tag", "react"], "tag");
    expect(store.get()).toBe("tag");
    store.set("react");
    expect(store.get()).toBe("react");
  });
});
