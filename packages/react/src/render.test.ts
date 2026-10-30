import type { IconavoIconSet } from "@iconavo-ui/core";
import { createElement as h, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addIcons, Icon, IconavoProvider } from "./index.js";

// Серверная разметка — то, что получит браузер и с чем сверит гидратацию (ADR-0033). Эффектов на
// сервере нет, поэтому здесь видно ровно правило «только пропсы, данные обёртки и чистые функции».

const DEMO: IconavoIconSet = {
  prefix: "demo",
  width: 24,
  height: 24,
  icons: {
    house: {
      body: '<path d="M3 10l9-7 9 7" stroke="currentColor" stroke-width="2"/>',
    },
    wide: { body: '<path d="M0 0h48v24z"/>', width: 48 },
    gradient: {
      body: '<defs><linearGradient id="a"><stop stop-color="red"/></linearGradient></defs><path fill="url(#a)" d="M0 0h24v24z"/>',
    },
  },
  aliases: { home: { parent: "house" }, loop: { parent: "loop" } },
  not_found: ["nope"],
};

const html = (node: ReactNode, icons: IconavoIconSet[] = [DEMO]) =>
  renderToString(h(IconavoProvider, { icons }, node));

const icon = (props: Parameters<typeof Icon>[0]) => h(Icon, props);

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("иконки обёртки — в серверном HTML", () => {
  it("рисунок, холст и высота 1em; без подписи — aria-hidden, без style", () => {
    expect(html(icon({ icon: "demo:house" }))).toBe(
      '<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-7 9 7" stroke="currentColor" stroke-width="2"/></svg>',
    );
  });

  it("алиас — рисунок родителя; широкая иконка — ширина по пропорции", () => {
    expect(html(icon({ icon: "demo:home" }))).toContain("M3 10l9-7 9 7");
    expect(html(icon({ icon: "demo:wide" }))).toContain(
      'width="2em" height="1em" viewBox="0 0 48 24"',
    );
  });

  it("настройки: размеры числом, поворот четвертью, отражение, толщина линии, цвет, подпись", () => {
    const out = html(
      icon({
        icon: "demo:wide",
        width: 32,
        rotate: 1,
        flip: "horizontal",
        color: "crimson",
        label: " Delete ",
      }),
    );
    expect(out).toContain('width="32" height="64" viewBox="0 0 24 48"');
    expect(out).toContain('<g transform="rotate(90');
    expect(out).toContain("scale(-1 1)");
    expect(out).toContain('color="crimson" role="img" aria-label="Delete"');
    expect(out).not.toContain("aria-hidden");
    expect(html(icon({ icon: "demo:house", strokeWidth: "1.5" }))).toContain(
      'stroke-width="1.5"',
    );
  });

  it("ID внутри рисунка — от useId: у копий разные, при повторной отрисовке те же", () => {
    const tree = h(
      "p",
      null,
      icon({ icon: "demo:gradient" }),
      icon({ icon: "demo:gradient" }),
    );
    const out = html(tree);
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^iconavo\w+$/);
    expect(out).toContain(`url(#${ids[0]})`);
    expect(html(tree)).toBe(out);
  });

  it("inline, className и свои пропсы — на <svg>; свои aria-* главнее", () => {
    const out = html(
      icon({
        icon: "demo:house",
        inline: true,
        className: "big",
        "data-x": "1",
        "aria-hidden": false,
      } as Parameters<typeof Icon>[0]),
    );
    expect(out).toContain('class="iconavo-inline big"');
    expect(out).toContain('data-x="1"');
    expect(out).toContain('aria-hidden="false"');
    expect(
      html(icon({ icon: "demo:house", style: { opacity: 0.5 } })),
    ).toContain('style="opacity:0.5"');
  });
});

describe("остальное на сервере — заглушка или «нет», одинаково в браузере при гидратации", () => {
  it("имя не из обёртки — пустой <svg> 1em с классом iconavo-loading", () => {
    expect(html(icon({ icon: "demo:other" }))).toBe(
      '<svg width="1em" height="1em" aria-hidden="true" class="iconavo-loading"></svg>',
    );
    expect(renderToString(icon({ icon: "demo:house" }))).toContain(
      'class="iconavo-loading"',
    );
  });

  it("размеры резерва — как у тега: одна сторона — квадрат, auto — 1em", () => {
    expect(html(icon({ icon: "demo:other", width: 32 }))).toContain(
      'width="32" height="32"',
    );
    expect(
      html(icon({ icon: "demo:other", height: "2em", width: "auto" })),
    ).toContain('width="2em" height="2em"');
  });

  it("заглушка из пропа: spinner — свой класс, none — без класса, неверная — по умолчанию", () => {
    expect(
      html(icon({ icon: "demo:other", placeholder: "spinner" })),
    ).toContain('class="iconavo-spinner"');
    expect(
      html(icon({ icon: "demo:other", placeholder: "none" })),
    ).not.toContain("class=");
    expect(
      html(icon({ icon: "demo:other", placeholder: "big" as "none" })),
    ).toContain('class="iconavo-loading"');
  });

  it("подпись есть и у заглушки: у кнопки из одной иконки есть имя, пока иконка грузится", () => {
    expect(html(icon({ icon: "demo:other", label: "Delete" }))).toBe(
      '<svg width="1em" height="1em" role="img" aria-label="Delete" class="iconavo-loading"></svg>',
    );
  });

  it("not_found обёртки, неверное имя и петля алиасов — «нет»: класс iconavo-missing", () => {
    for (const name of ["demo:nope", "Demo:House", "demo:loop"]) {
      expect(html(icon({ icon: name }))).toContain('class="iconavo-missing"');
    }
  });

  it("размеры строкой в данных обёртки — «нет», а не падение отрисовки", () => {
    const odd = {
      prefix: "odd",
      width: "24",
      height: "24",
      icons: { logo: { body: "<path/>" } },
    } as unknown as IconavoIconSet;
    expect(html(icon({ icon: "odd:logo" }), [odd])).toContain(
      'class="iconavo-missing"',
    );
  });

  it("из JS — дети и подпись числом: дети отброшены, подпись не строка — иконка декоративная", () => {
    const child = h("title", null, "Info");
    const loaded = html(
      h(Icon, { icon: "demo:house", label: 5 as unknown as string }, child),
    );
    expect(loaded).not.toContain("<title>");
    expect(loaded).toContain('aria-hidden="true"');
    const waiting = html(
      h(Icon, { icon: "demo:later", label: 5 as unknown as string }, child),
    );
    expect(waiting).not.toContain("<title>");
    expect(waiting).toContain('aria-hidden="true"');
  });

  it("вложенная обёртка: своя иконка, иконки внешней, свой not_found не заслоняет внешнюю", () => {
    const inner: IconavoIconSet = {
      prefix: "demo",
      icons: { cat: { body: "<circle/>" } },
      not_found: ["house"],
    };
    const out = html(
      h(
        IconavoProvider,
        { icons: [inner] },
        icon({ icon: "demo:cat" }),
        icon({ icon: "demo:house" }),
      ),
    );
    expect(out).toContain("<circle/>");
    expect(out).toContain("M3 10l9-7 9 7");
  });

  it("ядро сервера не читается: иконка из addIcons — всё равно заглушка; в сеть ни запроса", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    addIcons({ prefix: "core", icons: { star: { body: "<rect/>" } } });
    expect(html(icon({ icon: "core:star" }))).toContain(
      'class="iconavo-loading"',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("неверные значения пропускаются молча: предупреждения печатает только браузер", () => {
    const out = html(
      icon({
        icon: "demo:house",
        width: "50%",
        rotate: 90,
        strokeWidth: -1,
        flip: "diagonal",
        placeholder: "big" as "none",
        color: "bogus",
      }),
    );
    expect(out).toContain('width="1em" height="1em" viewBox="0 0 24 24"');
    expect(out).toContain('stroke-width="2"');
    expect(out).not.toContain("transform");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
