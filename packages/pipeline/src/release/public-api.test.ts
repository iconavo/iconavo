// Подсказки редактора у публичного API — по-английски (ADR-0051): описания из .d.ts разработчик видит
// при наведении на configure, Icon или их пропсы. Проверяются объявления, до которых он дойдёт из
// входов пакетов; внутренние модули пишутся по-русски, как весь репозиторий. Нужна сборка tsc -b.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..", "..");

/** Файл .d.ts → публичные имена в нём. */
const PUBLIC: Record<string, string[]> = {
  "packages/core/dist/index.d.ts": [
    "configure",
    "addIcons",
    "setLoader",
    "loadIcons",
  ],
  "packages/core/dist/icon.d.ts": [
    "IconavoIcon",
    "IconavoAlias",
    "IconavoIconSet",
  ],
  "packages/core/dist/store.d.ts": ["Loader", "Settings"],
  "packages/react/dist/icon.d.ts": ["IconProps", "Icon"],
  "packages/react/dist/options.d.ts": ["Placeholder", "IconOptions"],
  "packages/react/dist/provider.d.ts": ["IconavoProvider"],
};

/** Объявление с его описанием /** … *\/ и телом — до следующего объявления верхнего уровня. */
function declaration(text: string, name: string): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((l) =>
    new RegExp(
      `^export (declare )?(interface|type|function|const) ${name}\\b`,
    ).test(l),
  );
  if (at === -1) return undefined;
  let start = at;
  if (lines[at - 1]?.trimEnd().endsWith("*/")) {
    while (start > 0 && !lines[start - 1]?.startsWith("/**")) start--;
    start--;
  }
  let end = at + 1;
  while (
    end < lines.length &&
    !/^(export |\/\*\*|declare |interface |type )/.test(lines[end] as string)
  ) {
    end++;
  }
  return lines.slice(start, end).join("\n");
}

describe("подсказки публичного API — по-английски", () => {
  for (const [file, names] of Object.entries(PUBLIC)) {
    it(file, () => {
      const text = readFileSync(join(root, file), "utf8");
      for (const name of names) {
        const block = declaration(text, name);
        expect(
          block,
          `${name}: объявления нет — проверьте список`,
        ).toBeDefined();
        expect(
          block?.match(/[А-Яа-яЁё][^\n]*/)?.[0],
          `${name} в ${file}`,
        ).toBeUndefined();
      }
    });
  }
});
