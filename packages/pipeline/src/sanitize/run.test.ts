import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceConfigSchema } from "../sources/config.js";
import { SVG_NS } from "../svg/xml.js";
import {
  formatFixtures,
  formatSanitizeReport,
  renderSanitizeHtml,
} from "./report.js";
import { listIcons, sanitizeFixtures, sanitizeSet } from "./run.js";

const FIXTURES = fileURLToPath(
  new URL("../../fixtures/harmful-svg/", import.meta.url),
);

const config = sourceConfigSchema.parse({
  id: "demo",
  name: "Demo",
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [
    { path: "icons" },
    {
      path: "filled",
      naming: { replace: [{ pattern: "$", with: "-filled" }] },
    },
  ],
  palette: "monochrome",
  grid: 24,
  author: { name: "Demo" },
  license: { spdx: "MIT", file: "LICENSE" },
});

const icon = (body = `<path d="M4 4h16v16H4z"/>`, attrs = "") =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"${attrs}>${body}</svg>`;
const BROKEN = "<svg><g></svg>";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-sanitize-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeSet(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
  }
}

describe("список иконок набора", () => {
  it("имена по правилам папок, по алфавиту, без чужих файлов", async () => {
    await makeSet({
      "icons/b.svg": icon(),
      "icons/a.svg": icon(),
      "filled/a.svg": icon(),
      "icons/a.json": "{}",
      "other/c.svg": icon(),
      LICENSE: "MIT",
    });
    expect(await listIcons(config, dir)).toEqual([
      { name: "a", file: "icons/a.svg" },
      { name: "a-filled", file: "filled/a.svg" },
      { name: "b", file: "icons/b.svg" },
    ]);
  });
});

describe("прогон набора", () => {
  it("чистый набор — можно обновлять", async () => {
    await makeSet({ "icons/a.svg": icon(), "icons/b.svg": icon() });
    const r = await sanitizeSet(config, dir, "demo-icons@1.0.0");
    expect(r).toMatchObject({
      total: 2,
      unchanged: 2,
      cleaned: 0,
      excluded: [],
      dangerous: 0,
      stop: [],
    });
    expect(r.samples.map((s) => s.name).sort()).toEqual(["a", "b"]);
    expect(formatSanitizeReport(r)).toContain("Итог: можно обновлять");
  });

  it("опасное в настоящем наборе — стоп, хотя иконка очищена", async () => {
    await makeSet({
      "icons/a.svg": icon(),
      "icons/b.svg": icon(`<script>alert(1)</script><path d="M0 0"/>`),
    });
    const r = await sanitizeSet(config, dir, "demo");
    expect(r).toMatchObject({ cleaned: 1, dangerous: 1, excluded: [] });
    expect(r.stop).toEqual([
      "найдено опасное содержимое — в нормальном наборе его не бывает, проверьте источник",
    ]);
    expect(r.samples.map((s) => s.name)).toEqual(["b"]);
    expect(formatSanitizeReport(r)).toMatch(/СТОП: найдено опасное/);
  });

  it("исключено ровно 1% — можно, больше 1% — стоп", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 99; i++) files[`icons/i${i}.svg`] = icon();
    files["icons/x0.svg"] = BROKEN;
    await makeSet(files);
    const one = await sanitizeSet(config, dir, "demo");
    expect(one.excluded).toHaveLength(1);
    expect(one.stop).toEqual([]);

    await makeSet({ "icons/i0.svg": BROKEN });
    const two = await sanitizeSet(config, dir, "demo");
    expect(two.excluded.map((e) => e.name)).toEqual(["i0", "x0"]);
    expect(two.stop).toEqual(["исключено 2,0% иконок — больше 1%"]);
    expect(two.excludedPreviews.map((p) => p.name)).toEqual(["i0", "x0"]);
  });

  it("ПРОВЕРИТЬ: потеря фигуры или атрибута рисунка останавливает набор", async () => {
    await makeSet({
      "icons/a.svg": icon(
        `<path d="M0 0" fill="url(x.svg#p)"/><use href="b.svg#b"/>`,
      ),
    });
    const r = await sanitizeSet(config, dir, "demo");
    expect(r.lostShapes).toEqual(["a"]);
    expect(r.lostAttrs).toEqual([{ name: "a", attrs: ["<path> fill"] }]);
    expect(r.stop).toContain(
      "ПРОВЕРИТЬ: у части иконок удалены фигуры или атрибуты рисунка",
    );
    expect(formatSanitizeReport(r)).toMatch(/ПРОВЕРИТЬ a: фигур стало меньше/);
  });

  it("пустой набор — стоп", async () => {
    await makeSet({ LICENSE: "MIT" });
    const r = await sanitizeSet(config, dir, "demo");
    expect(r.stop).toEqual(["в наборе не найдено ни одной иконки"]);
  });
});

describe("вредные SVG и отчёт", () => {
  it("заголовок каждого файла — из первого комментария", async () => {
    const fixtures = await sanitizeFixtures(FIXTURES);
    expect(fixtures).toHaveLength(15);
    for (const f of fixtures) expect(f.title).not.toBe(f.file);
    expect(formatFixtures(fixtures)).toMatch(
      /^Вредные SVG: 15 файлов — очищено 9, исключено 6/,
    );
  });

  it("HTML-отчёт: CSP, ничего исполняемого, всё экранировано", async () => {
    await makeSet({
      "icons/a.svg": icon(`<script>alert(1)</script><path d="M0 0"/>`),
      "icons/b.svg": BROKEN,
    });
    const r = await sanitizeSet(config, dir, "demo");
    const html = renderSanitizeHtml([r], await sanitizeFixtures(FIXTURES));
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
    expect(html).not.toMatch(
      /<script|<iframe|<foreignObject|<img[^>]+\son\w+=/i,
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/<img src="data:image\/svg\+xml;base64,/);
    expect(html).toBe(
      renderSanitizeHtml([r], await sanitizeFixtures(FIXTURES)),
    );
  });
});
