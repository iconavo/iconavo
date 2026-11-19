// Проверка поиска на настоящем обработчике функции (apps/api) с поддельными R2, Meilisearch и Polza.

import {
  SEARCH_MODEL,
  STORE_KEYS,
  truncateUnit,
  vectorBytes,
  vectorHash,
} from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import {
  type FakeDoc,
  fakeBucket,
  fakeCache,
  fakeSearchFetch,
  MEILI_URL,
  manifestText,
  waiter,
} from "../../../../apps/api/src/fake.testing.js";
import { createHandler } from "../../../../apps/api/src/handler.js";
import type { FetchFn } from "../sources/npm.js";
import { HIT_ATTEMPTS } from "./config.js";
import {
  checkSearch,
  formatSearchCheck,
  searchCheckFailed,
} from "./search-check.js";

const DOCS: FakeDoc[] = [
  {
    icon: "lucide:house",
    set: "lucide",
    names: ["house", "lucide:house"],
    words: ["house", "дом"],
    style: ["outline"],
    styles: { outline: "house" },
  },
  {
    icon: "lucide:trash",
    set: "lucide",
    names: ["trash", "lucide:trash"],
    words: ["trash", "мусорное", "ведро"],
    style: ["outline"],
    styles: { outline: "trash" },
  },
  {
    icon: "ph:house",
    set: "ph",
    names: ["house", "house-fill", "ph:house", "ph:house-fill"],
    words: ["house", "дом"],
    variants: ["house-fill"],
    style: ["outline", "filled"],
    styles: { outline: "house", filled: "house-fill" },
  },
];

async function world(
  o: {
    index?: boolean;
    polzaDown?: boolean;
    meiliStatus?: number;
    /** Подмена ответов функции: как отвечает живой API из разных дата-центров. */
    wrap?: (fetchFn: FetchFn) => FetchFn;
  } = {},
) {
  const search: Record<string, string | Uint8Array> = {
    [STORE_KEYS.phrase(await vectorHash(SEARCH_MODEL.id, "house"))]:
      vectorBytes(
        truncateUnit(
          Array.from({ length: SEARCH_MODEL.dims }, (_, i) => Math.sin(i)),
          SEARCH_MODEL.dims,
        ),
      ),
  };
  if (o.index !== false) {
    search[STORE_KEYS.index] = JSON.stringify({ version: "abcd1234" });
  }
  const net = fakeSearchFetch({
    docs: DOCS,
    ...(o.polzaDown
      ? {
          polza: async () => {
            throw new Error("down");
          },
        }
      : {}),
    ...(o.meiliStatus === undefined ? {} : { meiliStatus: o.meiliStatus }),
  });
  const handler = createHandler({
    bucket: fakeBucket({
      "manifest.json": manifestText({ lucide: "0123abcd", ph: "4567cdef" }),
    }),
    cache: fakeCache(),
    build: "b1",
    search: {
      bucket: fakeBucket(search),
      meili: { url: MEILI_URL, key: "k" },
      polzaKey: "p",
      fetch: net.fn,
    },
  });
  const w = waiter();
  const fetchFn: FetchFn = async (input, init) => {
    const res = await handler(new Request(String(input), init), w.waitUntil);
    await w.flush();
    return res;
  };
  return checkSearch({
    fetch: o.wrap ? o.wrap(fetchFn) : fetchFn,
    sleep: async () => {},
    maxAttempts: 1,
  });
}

/** Тот же ответ с другими заголовками: так отвечает другой дата-центр, где записи в кэше ещё нет. */
async function withHeaders(
  res: Response,
  headers: Record<string, string>,
): Promise<Response> {
  const merged = new Headers(res.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: merged,
  });
}

/** Поиск «Точное имя»: n — номер запроса к нему, с 1. */
function exactName(change: (res: Response, n: number) => Promise<Response>) {
  let n = 0;
  const wrap =
    (fetchFn: FetchFn): FetchFn =>
    async (input, init) => {
      const res = await fetchFn(input, init);
      if (!String(input).endsWith("search?query=house&limit=8")) return res;
      n++;
      return change(res, n);
    };
  return { wrap, count: () => n };
}

describe("pnpm api check — поиск", () => {
  it("всё в порядке: точное имя первым, русский запрос, повтор из кэша, ответы 400", async () => {
    const r = await world();
    expect(searchCheckFailed(r)).toBe(false);
    expect(r.index).toBe("abcd1234");
    expect(r.targets.map((t) => [t.name, t.status])).toEqual([
      ["Точное имя", 200],
      ["Стиль", 200],
      ["По-русски", 200],
      ["Без query", 400],
      ["Неизвестный набор", 400],
      ["Неизвестный стиль", 400],
    ]);
    expect(r.targets[0]?.notes).toContain("вектор: store");
    expect(formatSearchCheck(r).at(-1)).toBe("Итог поиска: всё в порядке.");
  });

  it("повтор не из кэша с первого раза — ещё попытка, в порядке", async () => {
    const flaky = exactName((res, n) =>
      n === 2
        ? withHeaders(res, { "x-cache": "MISS", "cf-ray": "1a2b-LHR" })
        : Promise.resolve(res),
    );
    const r = await world({ wrap: flaky.wrap });
    expect(r.targets[0]?.issues).toEqual([]);
    expect(flaky.count()).toBe(3);
    expect(searchCheckFailed(r)).toBe(false);
  });

  it("повтор так и не из кэша — проблема, в сообщении дата-центры", async () => {
    const colos = ["AMS", "LHR", "CDG", "AMS"];
    const misses = exactName((res, n) =>
      withHeaders(res, {
        "x-cache": "MISS",
        "cf-ray": `8f3a${n}-${colos[n - 1]}`,
      }),
    );
    const r = await world({ wrap: misses.wrap });
    expect(misses.count()).toBe(1 + HIT_ATTEMPTS);
    expect(r.targets[0]?.issues.map((i) => i.message)).toEqual([
      "X-Cache: «MISS» вместо «HIT» — повтор не из кэша (попыток: 3); дата-центры: первый ответ — AMS, повторы — LHR, CDG, AMS",
    ]);
    expect(searchCheckFailed(r)).toBe(true);
  });

  it("версии индекса нет — проблема с подсказкой про робота", async () => {
    const r = await world({ index: false });
    expect(searchCheckFailed(r)).toBe(true);
    expect(r.targets[0]?.issues.map((i) => i.message).join(" ")).toMatch(
      /робот «Поисковый индекс»/,
    );
  });

  it("Polza недоступна — semantic: text отмечен", async () => {
    const r = await world({ polzaDown: true });
    const russian = r.targets.find((t) => t.name === "По-русски");
    expect(russian?.issues.map((i) => i.message).join(" ")).toMatch(
      /semantic: text/,
    );
  });

  it("Meilisearch недоступен — 503 вместо 200", async () => {
    const r = await world({ meiliStatus: 500 });
    expect(r.targets[0]?.status).toBe(503);
    expect(searchCheckFailed(r)).toBe(true);
  });
});
