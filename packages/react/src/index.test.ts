import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const dist = (file: string) =>
  readFile(new URL(`../dist/${file}`, import.meta.url), "utf8");

describe("вход пакета", () => {
  it("отдаёт ровно Icon, IconavoProvider и четыре функции README", async () => {
    expect(Object.keys(await import("./index.js")).sort()).toEqual([
      "Icon",
      "IconavoProvider",
      "addIcons",
      "configure",
      "loadIcons",
      "setLoader",
    ]);
  });

  it("импорт на сервере ничего не оставляет на странице: ни хранилища, ни листа стилей", async () => {
    await import("./index.js");
    const symbols = Object.getOwnPropertySymbols(globalThis).map(String);
    expect(symbols).not.toContain("Symbol(iconavo.core.1)");
    expect(symbols).not.toContain("Symbol(iconavo.react.css.1)");
  });

  it('"use client" — первой строкой модулей компонентов и не у входа: loadIcons — и в серверном компоненте', async () => {
    expect(await dist("icon.js")).toMatch(/^"use client";\n/);
    expect(await dist("provider.js")).toMatch(/^"use client";\n/);
    expect(await dist("index.js")).not.toMatch(/^\s*["']use client["']/);
  });
});
