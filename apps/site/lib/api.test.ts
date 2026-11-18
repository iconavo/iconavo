import { describe, expect, it } from "vitest";
import { fetchApi } from "./api";

/** Подменный fetch: ответы по очереди — код ответа или ошибка сети. */
function fake(answers: (number | Error)[]) {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(String(url));
    const next = answers.shift();
    if (next === undefined) throw new Error("лишний запрос");
    if (next instanceof Error) throw next;
    return new Response(`{"status":${next}}`, { status: next });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const URL = "https://api.iconavo.dev/collection?prefix=ph&info=true";

describe("запрос к edge API с одним повтором", () => {
  it("сбой сети, затем ответ — один повтор", async () => {
    const { fetchFn, calls } = fake([new TypeError("fetch failed"), 200]);
    const res = await fetchApi(URL, undefined, fetchFn, 0);
    expect(res.status).toBe(200);
    expect(calls).toEqual([URL, URL]);
  });

  it("ответ 500 или 503, затем 200 — один повтор", async () => {
    for (const status of [500, 503]) {
      const { fetchFn, calls } = fake([status, 200]);
      expect((await fetchApi(URL, undefined, fetchFn, 0)).status).toBe(200);
      expect(calls).toHaveLength(2);
    }
  });

  it("второй сбой — его ответ или ошибка: решает вызывающий", async () => {
    const twice = fake([500, 502]);
    expect((await fetchApi(URL, undefined, twice.fetchFn, 0)).status).toBe(502);
    const offline = fake([new TypeError("fetch failed"), new TypeError("x")]);
    await expect(fetchApi(URL, undefined, offline.fetchFn, 0)).rejects.toThrow(
      "x",
    );
  });

  it("200 и 4xx — без повтора: повтор ничего не изменит", async () => {
    for (const status of [200, 400, 404]) {
      const { fetchFn, calls } = fake([status]);
      expect((await fetchApi(URL, undefined, fetchFn, 0)).status).toBe(status);
      expect(calls).toHaveLength(1);
    }
  });

  it("отменённый запрос не повторяется", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const { fetchFn, calls } = fake([abort]);
    await expect(fetchApi(URL, undefined, fetchFn, 0)).rejects.toThrow(
      "aborted",
    );
    expect(calls).toHaveLength(1);
  });

  it("пауза перед повтором — по умолчанию 300 мс", async () => {
    const { fetchFn } = fake([503, 200]);
    const started = performance.now();
    await fetchApi(URL, undefined, fetchFn);
    expect(performance.now() - started).toBeGreaterThanOrEqual(290);
  });
});
