import { describe, expect, it } from "vitest";
import { parsePhosphorModule } from "./phosphor.js";
import { PHOSPHOR_MODULE } from "./phosphor.testing.js";

describe("метаданные Phosphor из dist/index.mjs", () => {
  it("читает массив иконок без запуска модуля", () => {
    expect(parsePhosphorModule(PHOSPHOR_MODULE)).toEqual([
      {
        name: "acorn",
        categories: ["arrows", "technology & development"],
        tags: ["*new*", "savings", 911],
      },
      {
        name: "asclepius",
        categories: ["arrows"],
        tags: ["medicine"],
        alias: "caduceus",
      },
    ]);
  });

  it.each([
    [
      "неизвестное значение перечисления",
      PHOSPHOR_MODULE.replace("cat.DEVELOPMENT", "cat.NOPE"),
      /неизвестное значение cat\.NOPE/,
    ],
    [
      "вызов функции",
      PHOSPHOR_MODULE.replace(`["medicine"]`, `[f("medicine")]`),
      /неожиданное «f»/,
    ],
    [
      "шаблонная строка",
      PHOSPHOR_MODULE.replace(`"medicine"`, "`medicine`"),
      /неожиданный символ «`»/,
    ],
    [
      "строка в одинарных кавычках",
      PHOSPHOR_MODULE.replace(`"medicine"`, "'medicine'"),
      /неожиданный символ «'»/,
    ],
    [
      "нет строки export",
      PHOSPHOR_MODULE.slice(0, PHOSPHOR_MODULE.indexOf("export")),
      /нет строки export/,
    ],
    [
      "icons не экспортируется",
      PHOSPHOR_MODULE.replace("list as icons", "list as all"),
      /не экспортирует icons/,
    ],
    [
      "массив не закрыт",
      `export { list as icons };\nconst list = [{ name: "a" }`,
      /не закрыт/,
    ],
    [
      "иконка без имени",
      PHOSPHOR_MODULE.replace(`name: "acorn",`, ""),
      /не по формату/,
    ],
  ])("незнакомый формат — ошибка: %s", (_n, text, error) => {
    expect(() => parsePhosphorModule(text)).toThrow(error);
  });
});
