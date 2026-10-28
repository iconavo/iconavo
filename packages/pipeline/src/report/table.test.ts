import { describe, expect, it } from "vitest";
import { markdownTable, textTable } from "./table.js";

describe("таблицы отчётов", () => {
  it("терминал: колонки по самой длинной ячейке, числа — по правому краю", () => {
    expect(
      textTable(
        ["Набор", "Иконок"],
        [
          ["lucide", "1924"],
          ["ph", "9072"],
        ],
      ),
    ).toBe(["Набор   Иконок", "lucide    1924", "ph        9072"].join("\n"));
  });

  it("Markdown: строка-разделитель, «|» и переводы строк в ячейках не ломают таблицу", () => {
    expect(
      markdownTable(["Проверка", "Chrome"], [["a | b", "да\nи\n нет"]]),
    ).toBe(
      ["| Проверка | Chrome |", "| --- | --- |", "| a \\| b | да и нет |"].join(
        "\n",
      ),
    );
  });
});
