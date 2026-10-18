import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SourceConfigInput,
  sourceConfigSchema,
} from "../sources/config.js";
import { SVG_NS } from "../svg/xml.js";
import {
  formatNormalizeReport,
  type GalleryFile,
  PAGE_SIZE,
  renderGallery,
} from "./gallery.js";
import { normalizeSet, type SetNormalizeReport } from "./run.js";

const base: SourceConfigInput = {
  id: "demo",
  name: "Demo <b>",
  source: { type: "npm", package: "demo-icons" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  license: { spdx: "MIT", file: "LICENSE" },
};
const config = (extra: Partial<SourceConfigInput> = {}) =>
  sourceConfigSchema.parse({ ...base, ...extra });

const icon = (
  body = `<path d="M4 4h16v16H4z"/>`,
  attrs = `viewBox="0 0 24 24"`,
) => `<svg xmlns="${SVG_NS}" ${attrs}>${body}</svg>`;
const WITH_IDS = icon(
  `<clipPath id="c"><rect width="12" height="12"/></clipPath><path d="M0 0h24v24H0z" clip-path="url(#c)"/>`,
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-normalize-"));
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

async function iconsFiles(n: number, make = (_i: number) => icon()) {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    files[`icons/i${String(i).padStart(3, "0")}.svg`] = make(i);
  }
  await makeSet(files);
}

const gallery = (...sets: SetNormalizeReport[]) => [...renderGallery(sets)];
const file = (files: GalleryFile[], name: string) => {
  const found = files.find((f) => f.name === name);
  if (!found) throw new Error(`нет файла ${name}`);
  return found.html;
};

describe("прогон набора", () => {
  it("чистый набор: сводка по шагам и «можно обновлять»", async () => {
    await makeSet({
      "icons/a.svg": icon(
        `<path d="M4 4h16v16H4z"/>`,
        `viewBox="0 -960 960 960"`,
      ),
      "icons/b.svg": icon(
        `<path d="M4 4h16v16H4z"/>`,
        `viewBox="0 -960 960 960" fill="#000"`,
      ),
    });
    const r = await normalizeSet(
      config({ sourceGrid: 960 }),
      dir,
      "demo-icons@1.0.0",
    );
    expect(r).toMatchObject({
      total: 2,
      grid: 24,
      sourceGrid: 960,
      excluded: [],
      offGrid: [],
      unsafe: [],
      stop: [],
      counts: { moved: 1, scaled: 2, defaults: 1, recolored: 1, withIds: 0 },
    });
    expect(r.icons.map((e) => e.name)).toEqual(["a", "b"]);
    expect(r.icons[0]?.icon.body).toBe(
      `<g transform="scale(0.025) translate(0 960)"><path d="M4 4h16v16H4z" fill="currentColor"/></g>`,
    );
    expect(r.icons[0]?.source).toContain(`viewBox="0 -960 960 960"`);
    const text = formatNormalizeReport(r);
    expect(text).toContain("Холст: источник 960 → сетка 24");
    expect(text).toContain("Итог: можно обновлять");
  });

  it("исключённые при очистке и при нормализации считаются вместе; больше 1% — стоп", async () => {
    await iconsFiles(98);
    await makeSet({
      "icons/x-broken.svg": "<svg><g></svg>",
      "icons/x-canvas.svg": icon(
        `<path d="M4 4h16v16H4z"/>`,
        `viewBox="0 0 24"`,
      ),
    });
    const r = await normalizeSet(config(), dir, "demo");
    expect(r.excluded.map((e) => e.name)).toEqual(["x-broken", "x-canvas"]);
    expect(r.excluded[0]?.reason).toMatch(/^очистка: /);
    expect(r.stop).toEqual(["исключено 2,0% иконок — больше 1%"]);
    expect(formatNormalizeReport(r)).toMatch(/СТОП: исключено 2,0%/);
  });

  it("вне сетки ровно 1% — можно, больше 1% — стоп: автор сменил холст", async () => {
    await iconsFiles(99);
    await makeSet({
      "icons/z0.svg": icon(`<path d="M4 4h16v16H4z"/>`, `viewBox="0 0 24 30"`),
    });
    const one = await normalizeSet(config(), dir, "demo");
    expect(one.offGrid).toEqual(["z0"]);
    expect(one.stop).toEqual([]);
    expect(one.icons.find((e) => e.name === "z0")?.attention).toEqual([
      "холст 24×30 — не на сетке 24",
    ]);

    await makeSet({
      "icons/z1.svg": icon(`<path d="M4 4h16v16H4z"/>`, `viewBox="0 0 24 30"`),
    });
    const two = await normalizeSet(config(), dir, "demo");
    expect(two.stop).toEqual([
      "вне сетки 2,0% иконок — больше 1%: похоже, автор сменил холст, проверьте sourceGrid в конфиге",
    ]);
  });

  it("опасное, найденное санитайзером, останавливает набор и здесь", async () => {
    await makeSet({
      "icons/a.svg": icon(`<script>alert(1)</script><path d="M4 4h16v16H4z"/>`),
    });
    const r = await normalizeSet(config(), dir, "demo");
    expect(r.dangerous).toBe(1);
    expect(r.stop).toEqual([
      "найдено опасное содержимое — в нормальном наборе его не бывает, проверьте источник",
    ]);
  });

  it("пустой набор — стоп", async () => {
    await makeSet({ LICENSE: "MIT" });
    const r = await normalizeSet(config(), dir, "demo");
    expect(r.stop).toEqual(["в наборе не найдено ни одной иконки"]);
  });
});

describe("галерея", () => {
  it("CSP, ничего исполняемого, имена экранированы, повтор даёт те же файлы", async () => {
    await makeSet({ "icons/a.svg": icon(), "icons/b.svg": WITH_IDS });
    const r = await normalizeSet(config(), dir, "demo");
    const files = gallery(r);
    expect(files.map((f) => f.name)).toEqual(["index.html", "demo-1.html"]);
    for (const f of files) {
      expect(f.html).toContain(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
      );
      expect(f.html).not.toMatch(/<script|<iframe|<foreignObject|\son\w+=/i);
      expect(f.html).toContain("Demo &lt;b&gt;");
      expect(f.html).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    }
    expect(gallery(r)).toEqual(files);
  });

  it("иконка без ID — общий <symbol> и <use>; с ID — своя копия на каждую плитку", async () => {
    await makeSet({ "icons/a.svg": icon(), "icons/b.svg": WITH_IDS });
    const r = await normalizeSet(config(), dir, "demo");
    const page = file(gallery(r), "demo-1.html");
    expect(page).toContain(
      `<svg class="sprite" aria-hidden="true"><symbol id="s0" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></symbol></svg>`,
    );
    expect(page.match(/<use href="#s0"\/>/g)).toHaveLength(9);
    expect(page).not.toContain(`id="s1"`);
    // 3 тона × 3 размера = 9 копий иконки b, у каждой свои ID.
    for (let t = 0; t < 9; t++) {
      expect(page).toContain(`id="demo--b-t${t}-0"`);
      expect(page).toContain(`clip-path="url(#demo--b-t${t}-0)"`);
    }
    expect(page).not.toContain(`id="demo--b-0"`);
    // Исходник — картинкой в стилях, по одному разу на иконку.
    expect(
      page.match(
        /\.o0 \{ background-image: url\("data:image\/svg\+xml;base64,/g,
      ),
    ).toHaveLength(1);
    expect(page).toContain(
      `<i class="o o0 s48"></i><i class="o o0 s24"></i><i class="o o0 s16"></i>`,
    );
  });

  it(`по ${PAGE_SIZE} иконок на странице`, async () => {
    await iconsFiles(PAGE_SIZE + 1);
    const r = await normalizeSet(config(), dir, "demo");
    const files = gallery(r);
    expect(files.map((f) => f.name)).toEqual([
      "index.html",
      "demo-1.html",
      "demo-2.html",
    ]);
    expect(file(files, "demo-1.html").match(/<article /g)).toHaveLength(
      PAGE_SIZE,
    );
    expect(file(files, "demo-2.html").match(/<article /g)).toHaveLength(1);
    expect(file(files, "demo-2.html")).toContain(
      `<a href="demo-1.html">← назад</a>`,
    );
  });

  it("«Сначала посмотрите» ведёт на карточку иконки; исключённые перечислены с причиной", async () => {
    await makeSet({
      "icons/a.svg": icon(),
      "icons/b.svg": WITH_IDS,
      "icons/c.svg": icon(`<path d="M4 4h16v16H4z"/>`, `viewBox="0 0 24"`),
    });
    const r = await normalizeSet(config(), dir, "demo");
    const index = file(gallery(r), "index.html");
    expect(index).toContain(
      `<a href="demo-1.html#i-b">demo:b</a> — ID переименованы: 1</li>`,
    );
    expect(index).toContain(
      `<b>demo:c</b> — исключена: viewBox «0 0 24» не читается: нужно четыре числа`,
    );
    expect(index).not.toContain(`demo-1.html#i-a`);
  });

  it("цветной набор: исходник и на тёмном фоне", async () => {
    await makeSet({
      "icons/a.svg": icon(`<path d="M4 4h16v16H4z" fill="#F92F60"/>`),
    });
    const r = await normalizeSet(config({ palette: "color" }), dir, "demo");
    const page = file(gallery(r), "demo-1.html");
    expect(page).toContain(`<span class="t dark"><i class="o o0 s48">`);
    expect(formatNormalizeReport(r)).toContain(
      "Цветной набор: цвета не меняются",
    );
  });
});
