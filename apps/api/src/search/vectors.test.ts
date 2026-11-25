import { SEARCH_MODEL } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { ModelError, modelVector, modelVectors } from "./vectors.js";

const POLZA = "https://polza.ai/api/v1/embeddings";

/** Polza, которая отвечает по вектору на текст: первое число — номер текста. */
function polza(order: (n: number) => number[] = (n) => [...Array(n).keys()]) {
  const bodies: { input: string[]; dimensions: number }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(POLZA);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const data = order(body.input.length).map((index) => ({
      index,
      embedding: Array.from({ length: body.dimensions }, (_, i) =>
        i === 0 ? index + 1 : 0,
      ),
    }));
    return Response.json({ data });
  }) as typeof fetch;
  return { fn, bodies };
}

describe("modelVectors", () => {
  it("один запрос на все тексты, векторы — в порядке текстов по index ответа", async () => {
    const p = polza((n) => [...Array(n).keys()].reverse());
    const vectors = await modelVectors(p.fn, "key", ["a", "b", "c"], 1000);
    expect(p.bodies).toEqual([
      {
        model: SEARCH_MODEL.id,
        input: ["a", "b", "c"],
        dimensions: SEARCH_MODEL.dims,
      },
    ]);
    expect(vectors.map((v) => v.length)).toEqual([
      SEARCH_MODEL.dims,
      SEARCH_MODEL.dims,
      SEARCH_MODEL.dims,
    ]);
    // Первое число — номер текста + 1, после нормировки — 1: вектор нужного текста на своём месте.
    expect(vectors.map((v) => v[0])).toEqual([1, 1, 1]);
  });

  it("пустой список — без запроса; modelVector — тот же запрос с одним текстом", async () => {
    const p = polza();
    expect(await modelVectors(p.fn, "key", [], 1000)).toEqual([]);
    expect(p.bodies).toHaveLength(0);
    const one = await modelVector(p.fn, "key", "дом", 1000);
    expect(one.length).toBe(SEARCH_MODEL.dims);
    expect(p.bodies[0]?.input).toEqual(["дом"]);
  });

  it("векторов меньше, чем текстов, или повтор index — ошибка модели", async () => {
    const short = polza(() => [0]);
    await expect(
      modelVectors(short.fn, "key", ["a", "b"], 1000),
    ).rejects.toThrow(ModelError);
    const twice = polza(() => [0, 0]);
    await expect(
      modelVectors(twice.fn, "key", ["a", "b"], 1000),
    ).rejects.toThrow(ModelError);
  });

  it("ответ не JSON — ошибка модели без куска ответа: он мог бы попасть в журнал (ревизия фазы 5, А-1)", async () => {
    const html = (async () =>
      new Response("<html>секретный запрос человека</html>", {
        status: 200,
      })) as unknown as typeof fetch;
    const error = await modelVectors(html, "key", ["a"], 1000).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ModelError);
    expect((error as Error).message).toBe("Polza: ответ не JSON");
  });
});
