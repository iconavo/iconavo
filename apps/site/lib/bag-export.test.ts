import { afterEach, describe, expect, it, vi } from "vitest";
import { API } from "./api";
import { detailsOf } from "./bag-export";
import { iconDetailsUrl } from "./icon";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("сведения /icon для скачивания рюкзака (ревизия фазы 5, С-12)", () => {
  it("ответ не JSON — без сведений, скачивание не ломается", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    await expect(detailsOf("lucide:house")).resolves.toBeUndefined();
  });

  it("ответ не по форме и не 200 — без сведений", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ icon: 1 }));
    await expect(detailsOf("lucide:house")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(detailsOf("lucide:house")).resolves.toBeUndefined();
  });

  it("сбой сети — без сведений", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(detailsOf("lucide:house")).resolves.toBeUndefined();
  });

  it("тишина — без сведений по тайм-ауту, запрос отменён", async () => {
    let asked: { url: string; signal?: AbortSignal | null } | undefined;
    vi.stubGlobal(
      "fetch",
      (url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          asked = { url, signal: init?.signal };
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(detailsOf("lucide:house", 20)).resolves.toBeUndefined();
    expect(asked?.url).toBe(iconDetailsUrl(API, "lucide:house"));
    expect(asked?.signal?.aborted).toBe(true);
  });
});
