import { describe, expect, it } from "vitest";
import { parseMs } from "./motion";

describe("длительности анимаций из переменных CSS", () => {
  it("миллисекунды и секунды", () => {
    expect(parseMs("240ms", 0)).toBe(240);
    expect(parseMs(" 260ms ", 0)).toBe(260);
    expect(parseMs("0.3s", 0)).toBe(300);
    expect(parseMs("120", 0)).toBe(120);
  });

  it("пусто или не число — значение по умолчанию", () => {
    expect(parseMs("", 240)).toBe(240);
    expect(parseMs("fast", 240)).toBe(240);
  });
});
