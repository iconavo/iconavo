import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_ICONS } from "./icons";

const root = join(import.meta.dirname, "..", "..", "..");

/** Имена набора, которые можно показывать: видимые иконки и алиасы. */
function visible(set: string): Set<string> {
  const data = JSON.parse(
    readFileSync(join(root, "data", set, "icons.json"), "utf8"),
  ) as {
    icons: Record<string, { hidden?: boolean }>;
    aliases?: Record<string, { hidden?: boolean }>;
  };
  return new Set(
    [...Object.entries(data.icons), ...Object.entries(data.aliases ?? {})]
      .filter(([, entry]) => !entry.hidden)
      .map(([name]) => name),
  );
}

describe("иконки сайта", () => {
  it("каждое имя есть в data/ и не скрыто", () => {
    const missing = SITE_ICONS.filter((name) => {
      const [set, icon] = name.split(":") as [string, string];
      return !visible(set).has(icon);
    });
    expect(missing).toEqual([]);
  });
});
