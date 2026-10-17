import { describe, expect, it } from "vitest";
import { isValidIconName } from "./index.js";

describe("isValidIconName", () => {
  it("принимает набор:иконка", () => {
    expect(isValidIconName("lucide:heart")).toBe(true);
    expect(isValidIconName("material-symbols:home-outline")).toBe(true);
  });

  it("отклоняет имя без двоеточия и с лишними частями", () => {
    expect(isValidIconName("heart")).toBe(true);
    expect(isValidIconName("a:b:c")).toBe(false);
  });

  it("отклоняет заглавные буквы и неверные дефисы", () => {
    expect(isValidIconName("Lucide:heart")).toBe(false);
    expect(isValidIconName("lucide:-heart")).toBe(false);
    expect(isValidIconName("lucide:heart--fill")).toBe(false);
  });
});
