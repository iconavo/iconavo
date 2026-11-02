import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_TAG,
  CONTENT_META,
  REFRESH_SKEW_MS,
  RENDERED_META,
} from "./config.js";
import {
  compareSite,
  invalidateGroups,
  type LivePage,
  pageRefreshed,
  refreshState,
  waitRefreshed,
} from "./refresh.js";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const site = (file: string) =>
  readFileSync(join(root, "apps", "site", "lib", file), "utf8");

const page = (path: string, content?: string, rendered?: string): LivePage => ({
  path,
  status: 200,
  ...(content === undefined ? {} : { content }),
  ...(rendered === undefined ? {} : { rendered }),
});

describe("сброс кэша страниц по наборам (шаг 4 фазы 4, ADR-0039)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("метки и имена меток — те же, что у сайта", () => {
    expect(site("catalog.ts")).toContain(
      `export const CATALOG_TAG = "${CATALOG_TAG}";`,
    );
    // Метка набора на сайте — `set-${prefix}`: та же, что сбрасывает workflow «Сайт».
    expect(site("catalog.ts")).toContain(["`set-$", "{prefix}`"].join(""));
    expect(site("catalog-view.ts")).toContain(
      `export const CONTENT_META = "${CONTENT_META}";`,
    );
    expect(site("catalog-view.ts")).toContain(
      `export const RENDERED_META = "${RENDERED_META}";`,
    );
  });

  it("состояние набора: свежий, устарел, нет страницы", () => {
    expect(refreshState([page("/a", "x"), page("/ru/a", "x")], "x")).toBe(
      "fresh",
    );
    expect(refreshState([page("/a", "x"), page("/ru/a", "y")], "x")).toBe(
      "stale",
    );
    // Страница собрана до сброса по наборам — метки нет.
    expect(refreshState([page("/a"), page("/ru/a", "x")], "x")).toBe("stale");
    expect(
      refreshState([{ path: "/a", status: 404 }, page("/ru/a", "x")], "x"),
    ).toBe("missing");
    expect(
      refreshState([{ path: "/a", status: 500 }, page("/ru/a", "x")], "x"),
    ).toBe("stale");
  });

  it("страница обновилась: тот отпечаток, а с since — и собрана не раньше сброса, с допуском на часы", () => {
    const since = Date.parse("2026-11-02T12:00:00Z");
    expect(
      pageRefreshed(page("/a", "x", "2026-11-02T12:00:05Z"), "x", since),
    ).toBe(true);
    const early = new Date(since - REFRESH_SKEW_MS / 2).toISOString();
    expect(pageRefreshed(page("/a", "x", early), "x", since)).toBe(true);
    const old = new Date(since - REFRESH_SKEW_MS * 2).toISOString();
    expect(pageRefreshed(page("/a", "x", old), "x", since)).toBe(false);
    expect(
      pageRefreshed(page("/a", "y", "2026-11-02T12:01:00Z"), "x", since),
    ).toBe(false);
    expect(pageRefreshed(page("/a", "x"), "x", since)).toBe(false);
    expect(pageRefreshed({ path: "/a", status: 404 }, "x", since)).toBe(false);
    // Без since — только отпечаток: выкладка кода между сравнением и сбросом даёт страницы чуть старше.
    expect(pageRefreshed(page("/a", "x", old), "x")).toBe(true);
    expect(pageRefreshed(page("/a", "y", old), "x")).toBe(false);
  });

  it("метки для сброса: catalog один раз, группы не больше 16", () => {
    expect(invalidateGroups([])).toEqual([]);
    expect(invalidateGroups(["lucide", "ph"])).toEqual([
      "catalog,set-lucide,set-ph",
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const groups = invalidateGroups(many);
    expect(groups.map((g) => g.split(",").length)).toEqual([16, 5]);
    expect(
      groups
        .join(",")
        .split(",")
        .filter((t) => t === "catalog"),
    ).toHaveLength(1);
  });

  it("сравнение и ожидание по живым страницам", async () => {
    const html = (content: string, rendered: string) =>
      `<html><head><meta name="${CONTENT_META}" content="${content}"/><meta name="${RENDERED_META}" content="${rendered}"/></head></html>`;
    // Живой сайт: lucide со старым отпечатком, после второго опроса — с новым; tabler — без страницы.
    let polls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.includes("tabler")) return new Response("", { status: 404 });
      if (path === "/lucide/house") polls++;
      const fresh = polls >= 2;
      return new Response(
        html(
          fresh ? "new" : "old",
          fresh ? "2026-11-02T12:00:30Z" : "2026-11-01T00:00:00Z",
        ),
        { status: 200 },
      );
    });
    const sets = {
      lucide: { content: "new", sample: "house" },
      tabler: { content: "t1" },
    };
    const rows = await compareSite("https://site", sets);
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ["lucide", "stale"],
      ["tabler", "missing"],
    ]);
    const forced = await compareSite(
      "https://site",
      { lucide: sets.lucide },
      true,
    );
    expect(forced[0]?.state).toBe("stale");
    const result = await waitRefreshed({
      base: "https://site",
      sets,
      ids: ["lucide"],
      since: Date.parse("2026-11-02T12:00:00Z"),
      timeoutMs: 10_000,
      pollMs: 1,
    });
    expect(result.done).toBe(true);
    const timeout = await waitRefreshed({
      base: "https://site",
      sets: { lucide: { content: "other", sample: "house" } },
      ids: ["lucide"],
      since: Date.parse("2026-11-02T12:00:00Z"),
      timeoutMs: 0,
      pollMs: 1,
    });
    expect(timeout.done).toBe(false);
    expect(timeout.pending.map((p) => p.path)).toEqual([
      "/lucide",
      "/ru/lucide",
      "/lucide/house",
    ]);
  });
});
