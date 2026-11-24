import type { Route } from "playwright";
import { describe, expect, it } from "vitest";
import { guarded } from "./search.js";

/** Подделка route: только то, что берёт guarded. */
function fakeRoute() {
  const calls: string[] = [];
  const route = {
    request: () => ({ url: () => "http://127.0.0.1:4281/search?query=house" }),
    abort: async () => {
      calls.push("abort");
    },
  } as unknown as Route;
  return { route, calls };
}

describe("подмена ответов в проверке поиска (ревизия фазы 5, И-18)", () => {
  it("закрытая страница — не ошибка, прочее — в проблемах; отказа наружу нет", async () => {
    const problems: string[] = [];
    const closed = fakeRoute();
    await guarded(problems, async () => {
      throw new Error(
        "route.fetch: Target page, context or browser has been closed",
      );
    })(closed.route);
    expect(problems).toEqual([]);
    expect(closed.calls).toEqual(["abort"]);

    const broken = fakeRoute();
    await guarded(problems, async () => {
      throw new SyntaxError("Unexpected token < in JSON\nat line 1");
    })(broken.route);
    expect(problems).toEqual([
      "подмена ответа http://127.0.0.1:4281/search?query=house: Unexpected token < in JSON",
    ]);
    expect(broken.calls).toEqual(["abort"]);
  });

  it("обработчик без ошибки — запрос не трогается", async () => {
    const problems: string[] = [];
    const ok = fakeRoute();
    await guarded(problems, async () => {})(ok.route);
    expect(problems).toEqual([]);
    expect(ok.calls).toEqual([]);
  });
});
