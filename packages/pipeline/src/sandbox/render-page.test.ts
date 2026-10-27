import { fileURLToPath } from "node:url";
import {
  iconData,
  parseFlip,
  parseRotate,
  parseSize,
} from "@iconavo-ui/core/internal";
import { describe, expect, it } from "vitest";
import { DEMO_SET, VARIANTS } from "./render-page.js";
import { visibleNames } from "./server.js";

const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));
const variants = VARIANTS.flatMap((s) => s.variants);

describe("сетка вариантов рендера", () => {
  it("иконки каталога — видимые иконки data/, свои — из набора sandbox", async () => {
    const names = new Map<string, string[]>();
    const unknown: string[] = [];
    for (const { icon } of variants) {
      const [prefix, name] = icon.split(":") as [string, string];
      if (prefix === DEMO_SET.prefix) {
        if (iconData(DEMO_SET, name) === null) unknown.push(icon);
        continue;
      }
      if (!names.has(prefix))
        names.set(prefix, await visibleNames(DATA, prefix));
      if (!names.get(prefix)?.includes(name)) unknown.push(icon);
    }
    expect(unknown).toEqual([]);
  });

  it("настройки клеток разбираются ядром, как атрибуты тега", () => {
    const invalid = variants.filter(
      (v) =>
        (v.width !== undefined && parseSize(v.width) === null) ||
        (v.height !== undefined && parseSize(v.height) === null) ||
        (v.rotate !== undefined && parseRotate(v.rotate) === null) ||
        (v.flip !== undefined && parseFlip(v.flip) === null) ||
        (v.strokeWidth !== undefined && !(Number(v.strokeWidth) > 0)),
    );
    expect(invalid.map((v) => v.caption)).toEqual([]);
  });

  it('свой набор: маска и две разные иконки с одним id="a" — раньше «как было бы» стоит солнце', () => {
    expect(DEMO_SET.icons.moon?.body).toContain("<mask");
    const withA = Object.entries(DEMO_SET.icons)
      .filter(([, icon]) => icon.body.includes('id="a"'))
      .map(([name]) => name);
    expect(withA).toEqual(["sun", "sea"]);
    const raw = variants.filter((v) => v.raw).map((v) => v.icon);
    expect(raw).toEqual(["sandbox:sun", "sandbox:sea"]);
  });
});
