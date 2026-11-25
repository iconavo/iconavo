import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCollection, type Release, setCards } from "./catalog";
import type { IconDetails, IconSetSummary } from "./icon";
import {
  downloadComment,
  gridPath,
  iconDates,
  resolveAlias,
  styleTiles,
  svgBase64,
  svgToJsx,
  withBrowserDetails,
} from "./icon-page";

const root = join(import.meta.dirname, "..", "..", "..");

/** /collection набора из data/ — как его отдаёт edge API: суффиксы и стили без дефиса. */
function collectionOf(prefix: string) {
  const icons = JSON.parse(
    readFileSync(join(root, "data", prefix, "icons.json"), "utf8"),
  ) as {
    icons: Record<string, { hidden?: boolean }>;
    aliases?: Record<string, { parent: string }>;
  };
  const meta = JSON.parse(
    readFileSync(join(root, "data", prefix, "metadata.json"), "utf8"),
  ) as {
    suffixes?: Record<string, string>;
    styles?: Record<string, string[]>;
  };
  const undash = (s: string) => s.replace(/^-/, "");
  return parseCollection({
    prefix,
    title: prefix,
    total: 0,
    uncategorized: Object.entries(icons.icons)
      .filter(([, icon]) => !icon.hidden)
      .map(([name]) => name),
    aliases: Object.fromEntries(
      Object.entries(icons.aliases ?? {}).map(([name, a]) => [name, a.parent]),
    ),
    suffixes: Object.fromEntries(
      Object.entries(meta.suffixes ?? {}).map(([s, title]) => [
        undash(s),
        title,
      ]),
    ),
    styles: Object.fromEntries(
      Object.entries(meta.styles ?? {}).map(([style, list]) => [
        style,
        list.map(undash),
      ]),
    ),
  });
}

const release = (r: Partial<Release> & { date: string }): Release => ({
  prefix: "lucide",
  version: r.date.slice(0, 10),
  revision: "r",
  total: 1,
  ...r,
});

describe("страница иконки по макету (редизайн, шаг 4)", () => {
  it("старое имя ведёт к основному по цепочке алиасов", () => {
    const aliases = { a: "b", b: "c", loop: "loop2", loop2: "loop" };
    expect(resolveAlias(aliases, "a")).toBe("c");
    expect(resolveAlias(aliases, "c")).toBe("c");
    expect(resolveAlias(undefined, "house")).toBe("house");
    expect(resolveAlias(aliases, "loop")).toBeUndefined();
    // Имя, совпавшее со свойством Object.prototype, — не алиас.
    expect(resolveAlias({}, "constructor")).toBe("constructor");
  });

  it("плитки «Other styles» — по таблице стилей набора, с названиями автора", () => {
    const ms = collectionOf("material-symbols");
    const cards = setCards(ms);
    const card = cards.cards.find((c) => c.base === "home");
    expect(card).toBeDefined();
    if (card === undefined) return;
    // Стиль базы — первым; home-sharp и home-outline-sharp у Material Symbols — алиасы одинаковых
    // рисунков (ADR-0002), их плиток нет.
    expect(styleTiles(card, ms)).toEqual([
      { name: "home", label: "Regular" },
      { name: "home-rounded", label: "Rounded" },
      { name: "home-outline", label: "Outline" },
      { name: "home-outline-rounded", label: "Outline Rounded" },
    ]);
    expect(ms.aliases?.["home-sharp"]).toBe("home");

    const ph = collectionOf("ph");
    const house = setCards(ph).cards.find((c) => c.base === "house");
    if (house === undefined) throw new Error("нет ph:house");
    // Внутри стиля — порядок таблицы автора: у Phosphor — по толщине.
    expect(styleTiles(house, ph).map((t) => t.label)).toEqual([
      "Thin",
      "Light",
      "Regular",
      "Bold",
      "Fill",
      "Duotone",
    ]);

    // У Lucide вариантов нет — одна плитка, блока на странице не будет.
    const lucide = collectionOf("lucide");
    const lh = setCards(lucide).cards.find((c) => c.base === "house");
    if (lh === undefined) throw new Error("нет lucide:house");
    expect(styleTiles(lh, lucide)).toEqual([{ name: "house", label: "house" }]);
  });

  it("даты: добавлена после первого выпуска, менялась, переименована, скрыта", () => {
    const releases: Release[] = [
      release({ date: "2026-10-20T10:00:00Z" }),
      release({ date: "2026-10-25T10:00:00Z", added: ["new-one"] }),
      release({
        date: "2026-11-01T10:00:00Z",
        changed: ["house", "new-one"],
      }),
      release({
        date: "2026-11-05T10:00:00Z",
        renamed: { "new-one": "renamed-one" },
      }),
      release({ date: "2026-11-06T10:00:00Z", hidden: ["gone"] }),
      release({
        date: "2026-11-07T10:00:00Z",
        prefix: "tabler",
        added: ["house"],
      }),
    ];
    // Из первого выпуска — без «Added».
    expect(iconDates("lucide", "house", releases)).toEqual({
      changed: "2026-11-01T10:00:00Z",
    });
    // Переименованная — по истории старого имени.
    expect(iconDates("lucide", "renamed-one", releases)).toEqual({
      added: "2026-10-25T10:00:00Z",
      changed: "2026-11-01T10:00:00Z",
    });
    expect(iconDates("lucide", "gone", releases)).toEqual({
      removed: {
        date: "2026-11-06T10:00:00Z",
        version: "2026-11-06",
        revision: "r",
      },
    });
    // Возвращённая после скрытия — не «Removed».
    expect(
      iconDates("lucide", "gone", [
        ...releases,
        release({ date: "2026-11-08T10:00:00Z", restored: ["gone"] }),
      ]),
    ).toEqual({});
    // Выпуски другого набора не в счёт; ленты нет — дат нет.
    expect(iconDates("tabler", "house", releases)).toEqual({
      added: "2026-11-07T10:00:00Z",
    });
    expect(iconDates("lucide", "house", [])).toEqual({});
  });

  it("JSX — атрибуты в camelCase, data- и aria- как есть", () => {
    expect(
      svgToJsx(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"><path fill-rule="evenodd" clip-rule="evenodd" d="M1 2h3"/></g><stop stop-color="#fff" data-x="1" aria-hidden="true" class="a"/></svg>',
      ),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2"><path fillRule="evenodd" clipRule="evenodd" d="M1 2h3"/></g><stop stopColor="#fff" data-x="1" aria-hidden="true" className="a"/></svg>',
    );
  });

  it("base64 — картинка data: в UTF-8", () => {
    expect(svgBase64("<svg/>")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
    expect(atob(svgBase64("<svg>é</svg>").split(",")[1] ?? "")).toBe(
      "<svg>Ã©</svg>",
    );
  });

  it("сетка превью — линия на каждую единицу холста", () => {
    expect(gridPath(2, 1)).toBe("M0 0V1M1 0V1M2 0V1M0 0H2M0 1H2");
    expect(gridPath(24, 24).match(/M/g)?.length).toBe(50);
  });
});

describe("скачанный SVG страницы иконки — со сведениями из браузера (ревизия фазы 5, С-6)", () => {
  const set: IconSetSummary = {
    prefix: "lucide",
    name: "Lucide",
    author: { name: "Lucide Contributors" },
    license: { title: "ISC License", spdx: "ISC" },
    palette: false,
  };
  const feather = {
    name: "Feather",
    author: "Cole Bemis",
    license: "MIT",
    url: "https://github.com/feathericons/feather",
  };
  // Сведения /icon пришли только в браузере: при сборке страницы поиск не ответил.
  const page = { icon: "lucide:circle-alert", set };
  const details = {
    icon: "lucide:circle-alert",
    set: { ...set, credits: [feather] },
    credits: [feather],
  } as unknown as IconDetails;

  it("без сведений — без строк про Feather", () => {
    expect(downloadComment(page)).not.toContain("Feather");
  });

  it("сведения из браузера — строки про Feather набора и самой иконки", () => {
    const comment = downloadComment(withBrowserDetails(page, details));
    expect(comment).toContain("Includes icons from Feather by Cole Bemis");
    expect(comment).toContain("Based on Feather by Cole Bemis, MIT license.");
  });

  it("те же сведения, что при сборке, — та же страница", () => {
    const built = { ...page, details };
    expect(withBrowserDetails(built, details)).toBe(built);
    expect(withBrowserDetails(page, undefined)).toBe(page);
  });
});
