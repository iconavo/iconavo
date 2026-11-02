import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { batchUrls, parseBatch, SITE_ICONS } from "./icons";

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

describe("пачки edge API на сервере (шаг 4 фазы 4)", () => {
  const api = "https://api.example";

  it("по набору, имена по порядку, без повторов", () => {
    expect(
      batchUrls(api, ["lucide:x", "ph:house", "lucide:menu", "lucide:x"]),
    ).toEqual([
      ["lucide", `${api}/lucide.json?icons=menu,x`],
      ["ph", `${api}/ph.json?icons=house`],
    ]);
  });

  it("куски — до 100 имён и до 2000 знаков адреса", () => {
    const many = Array.from({ length: 250 }, (_, i) => `lucide:i${i}`);
    const urls = batchUrls(api, many);
    expect(urls.length).toBe(3);
    expect(urls.map(([, url]) => url.split(",").length)).toEqual([
      100, 100, 50,
    ]);
    const long = Array.from(
      { length: 90 },
      (_, i) => `material-symbols:arrow-circle-left-outline-rounded-${i}`,
    );
    const parts = batchUrls(api, long);
    expect(parts.length).toBeGreaterThan(1);
    for (const [, url] of parts) expect(url.length).toBeLessThanOrEqual(2000);
    expect(
      parts.flatMap(([, url]) => url.split("=")[1]?.split(",")),
    ).toHaveLength(90);
  });

  it("имя не по правилу — ошибка", () => {
    expect(() => batchUrls(api, ["house"])).toThrow(/СТОП/);
    expect(() => batchUrls(api, ["lucide:House"])).toThrow(/СТОП/);
    expect(() => batchUrls(api, ["lucide:a:b"])).toThrow(/СТОП/);
  });

  it("ответ — IconifyJSON того же набора", () => {
    const set = { prefix: "lucide", icons: { x: { body: "<path/>" } } };
    expect(parseBatch("lucide", set)).toBe(set);
    expect(() => parseBatch("ph", set)).toThrow(/СТОП/);
    expect(() => parseBatch("lucide", { prefix: "lucide" })).toThrow(/СТОП/);
    expect(() => parseBatch("lucide", null)).toThrow(/СТОП/);
  });
});
