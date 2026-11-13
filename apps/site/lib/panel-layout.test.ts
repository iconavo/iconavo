import { describe, expect, it } from "vitest";
import { PANEL_LAYOUT_KEY, readPanelLayout } from "./panel-layout";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PANEL_LAYOUT_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("вариант панели: в сетке или во всю высоту страницы", () => {
  it("ссылка ?panel-layout= выбирает вариант и запоминает его", () => {
    const storage = memory();
    expect(readPanelLayout("?panel-layout=page", storage)).toBe("page");
    expect(storage.data.get(PANEL_LAYOUT_KEY)).toBe("page");
    expect(readPanelLayout("?icon=lucide:house", storage)).toBe("page");
    expect(readPanelLayout("?panel-layout=grid", storage)).toBe("grid");
    expect(readPanelLayout("", storage)).toBe("grid");
  });

  it("по умолчанию и с чужим значением — нынешний вариант", () => {
    expect(readPanelLayout("", memory())).toBe("grid");
    expect(readPanelLayout("?panel-layout=wide", memory())).toBe("grid");
    expect(readPanelLayout("", memory("wide"))).toBe("grid");
  });

  it("хранилище запрещено — нынешний вариант", () => {
    const denied = {
      getItem(): string | null {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    };
    expect(readPanelLayout("?panel-layout=page", denied)).toBe("grid");
  });
});
