import { describe, expect, it } from "vitest";
import { isValidIconName, isValidNamePart } from "./index.js";

describe("isValidNamePart", () => {
  it("одна часть имени: набор или иконка", () => {
    expect(isValidNamePart("material-symbols")).toBe(true);
    expect(isValidNamePart("123")).toBe(true);
    expect(isValidNamePart("lucide:heart")).toBe(false);
    expect(isValidNamePart("_missing")).toBe(false);
    expect(isValidNamePart("")).toBe(false);
  });
});

describe("isValidIconName", () => {
  it("принимает набор:иконка", () => {
    expect(isValidIconName("lucide:heart")).toBe(true);
    expect(isValidIconName("material-symbols:home-outline")).toBe(true);
  });

  it("отклоняет имя без двоеточия и с лишними частями", () => {
    expect(isValidIconName("heart")).toBe(false);
    expect(isValidIconName("a:b:c")).toBe(false);
  });

  it("отклоняет заглавные буквы и неверные дефисы", () => {
    expect(isValidIconName("Lucide:heart")).toBe(false);
    expect(isValidIconName("lucide:-heart")).toBe(false);
    expect(isValidIconName("lucide:heart--fill")).toBe(false);
  });
});
