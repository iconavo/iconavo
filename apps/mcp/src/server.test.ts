import { describe, expect, it } from "vitest";
import { fakeLimiter } from "../../api/src/fake.testing.js";
import { FEATHER, mcpSetup, PICKER, PNG_SIGNATURE } from "./fake.testing.js";

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.find((c) => c.type === "text")?.text ?? "";

describe("MCP: список инструментов", () => {
  it("шесть инструментов ADR-0011 и ADR-0045 с точными описаниями, схемами входа и ответа, только чтение", async () => {
    const s = mcpSetup();
    const { res, body } = await s.rpc("tools/list");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iconavo-build")).toBe("test");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const tools = (body.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "search_icons",
      "get_icon",
      "get_matching_set",
      "get_usage",
      "list_sets",
      "pick_icon",
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema, String(tool.name)).toBeDefined();
      expect(tool.annotations, String(tool.name)).toMatchObject({
        readOnlyHint: true,
      });
      expect(String(tool.description).length).toBeGreaterThan(150);
    }
    const [search] = tools;
    expect(search?.description).toMatch(/any language/);
    expect(search?.description).toMatch(/ONE PNG image/);
    const input = search?.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(input.properties).sort()).toEqual([
      "license",
      "limit",
      "offset",
      "preview",
      "query",
      "sets",
      "style",
    ]);
    expect(input.required).toEqual(["query"]);
    expect(search?.outputSchema).toBeDefined();
    expect(search?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it("инструкция сервера и имя — для ассистента", async () => {
    const s = mcpSetup();
    const { body } = await s.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const result = body.result as {
      serverInfo: { name: string; version: string };
      instructions: string;
      capabilities: { tools: { listChanged?: boolean } };
    };
    expect(result.serverInfo).toMatchObject({
      name: "iconavo",
      version: "test",
    });
    expect(result.instructions).toMatch(/license/);
    expect(result.instructions).toMatch(/pick_icon/);
    expect(result.capabilities.tools.listChanged).toBe(false);
  });
});

describe("MCP: интерфейс сетки выбора (MCP Apps, ADR-0045)", () => {
  const uri = `ui://picker/${PICKER.version}`;

  it("pick_icon ссылается на интерфейс: адрес с версией страницы, ключ спецификации и прежний плоский", async () => {
    const s = mcpSetup();
    const { body } = await s.rpc("tools/list");
    const tools = (body.result as { tools: Record<string, unknown>[] }).tools;
    const pick = tools.find((t) => t.name === "pick_icon");
    expect(pick?._meta).toEqual({
      ui: { resourceUri: uri },
      "ui/resourceUri": uri,
    });
    expect(pick?.description).toMatch(/MCP Apps/);
    expect(pick?.description).toMatch(/ONE PNG image/);
    const input = pick?.inputSchema as
      | { properties: Record<string, unknown> }
      | undefined;
    expect(Object.keys(input?.properties ?? {}).sort()).toEqual([
      "color",
      "format",
      "license",
      "query",
      "sets",
      "size",
      "style",
    ]);
  });

  it("ресурс: шаблон ui://picker/{version}, в списке — текущий адрес; списки не меняются без выкладки", async () => {
    const s = mcpSetup();
    const init = await s.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(
      (init.body.result as { capabilities: { resources?: unknown } })
        .capabilities.resources,
    ).toEqual({ listChanged: false });
    const templates = await s.rpc("resources/templates/list");
    expect(
      (
        templates.body.result as {
          resourceTemplates: { uriTemplate: string; mimeType?: string }[];
        }
      ).resourceTemplates,
    ).toEqual([
      expect.objectContaining({
        uriTemplate: "ui://picker/{version}",
        mimeType: "text/html;profile=mcp-app",
      }),
    ]);
    const list = await s.rpc("resources/list");
    expect(
      (list.body.result as { resources: { uri: string; mimeType?: string }[] })
        .resources,
    ).toEqual([
      expect.objectContaining({ uri, mimeType: "text/html;profile=mcp-app" }),
    ]);
  });

  it("чтение: страница целиком, MIME MCP Apps, рамку рисует клиент; старая версия — та же страница, не версия — нет ресурса", async () => {
    const s = mcpSetup();
    for (const version of [PICKER.version, "0123abcd"]) {
      const { body } = await s.rpc("resources/read", {
        uri: `ui://picker/${version}`,
      });
      const contents = (
        body.result as {
          contents: {
            uri: string;
            mimeType: string;
            text: string;
            _meta?: unknown;
          }[];
        }
      ).contents;
      expect(contents).toEqual([
        {
          uri: `ui://picker/${version}`,
          mimeType: "text/html;profile=mcp-app",
          text: PICKER.html,
          _meta: { ui: { prefersBorder: true } },
        },
      ]);
    }
    const bad = await s.rpc("resources/read", { uri: "ui://picker/latest" });
    expect(bad.body.error).toBeDefined();
  });
});

describe("MCP: search_icons", () => {
  it("по смыслу: имена, стили, лицензия и автор каждой иконки, одна PNG-картинка", async () => {
    const s = mcpSetup();
    const result = await s.call("search_icons", { query: "house" });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      results: Record<string, unknown>[];
      sets: Record<string, unknown>[];
      ranking: string;
      count: number;
      preview: boolean;
    };
    expect(out.ranking).toBe("meaning");
    expect(out.count).toBe(3);
    expect(out.results[0]).toEqual({
      n: 1,
      icon: "demo:house",
      set: "demo",
      style: "outline",
      styles: { outline: "demo:house", filled: "demo:house-fill" },
      exact: true,
      license: "ISC",
      author: "Demo Authors",
    });
    expect(out.results.map((r) => r.icon)).toEqual([
      "demo:house",
      "color:swan",
      "demo:heart",
    ]);
    expect(out.sets).toEqual([
      {
        prefix: "demo",
        name: "Demo",
        author: { name: "Demo Authors", url: "https://example.com/demo" },
        license: {
          title: "ISC License",
          spdx: "ISC",
          url: "https://spdx.org/licenses/ISC.html",
        },
        palette: false,
        credits: [
          {
            name: FEATHER.name,
            author: FEATHER.author,
            license: FEATHER.license,
            url: FEATHER.url,
          },
        ],
      },
      {
        prefix: "color",
        name: "Color",
        author: { name: "Color Authors" },
        license: { title: "MIT License", spdx: "MIT" },
        palette: true,
      },
    ]);
    // Лицензия и автор — и в тексте: клиенты без structuredContent видят то же.
    const text = textOf(result);
    expect(text).toMatch(/^Found 3 icons for "house", ranked by meaning/);
    expect(text).toContain("1. demo:house — Demo, outline (exact name)");
    expect(text).toContain("Demo [demo] — ISC");
    expect(text).toContain("Includes icons from Feather by Cole Bemis, MIT.");
    expect(text).toContain("Color [color] — MIT — Color Authors.");
    // Одна картинка: сетка 4 × 1 с номерами, у клетки цветной иконки свои ID.
    const images = result.content.filter((c) => c.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect([
      ...Buffer.from(images[0]?.data ?? "", "base64").subarray(0, 8),
    ]).toEqual(PNG_SIGNATURE);
    expect(s.rendered).toHaveLength(1);
    expect(s.rendered[0]).toContain('viewBox="0 0 384 96"');
    expect(s.rendered[0]).toContain('id="c1_0"');
    expect(s.rendered[0]).not.toContain('id="g"');
  });

  it("повтор — картинка из кэша дата-центра, не рисуется заново", async () => {
    const s = mcpSetup();
    await s.call("search_icons", { query: "house" });
    await s.flush();
    const again = await s.call("search_icons", { query: "house" });
    expect(again.content.filter((c) => c.type === "image")).toHaveLength(1);
    expect(s.rendered).toHaveLength(1);
  });

  it("preview: false — без картинки; стиль и лимит — как у поиска API, следующая страница — nextOffset", async () => {
    const s = mcpSetup();
    const result = await s.call("search_icons", {
      query: "house",
      style: "filled",
      limit: 1,
      preview: false,
    });
    expect(result.content.map((c) => c.type)).toEqual(["text"]);
    expect(s.rendered).toHaveLength(0);
    const out = result.structuredContent as {
      results: { icon: string; style: string }[];
      nextOffset?: number;
      preview: boolean;
    };
    expect(out.results).toEqual([
      expect.objectContaining({ icon: "demo:house-fill", style: "filled" }),
    ]);
    expect(out.nextOffset).toBe(1);
    expect(out.preview).toBe(false);
    expect(textOf(result)).toContain(
      "More results: call search_icons with offset 1.",
    );
  });

  it("ассистент ждёт смысл: фразы нет — вектор от модели, выдача полная", async () => {
    const s = mcpSetup();
    const result = await s.call("search_icons", { query: "love" });
    expect((result.structuredContent as { ranking: string }).ranking).toBe(
      "meaning",
    );
    expect(s.net.polza).toHaveLength(1);
  });

  it("модель не ответила — выдача по словам, и это сказано", async () => {
    const s = mcpSetup({
      polza: async () => {
        throw new Error("boom");
      },
    });
    const result = await s.call("search_icons", { query: "love" });
    expect((result.structuredContent as { ranking: string }).ranking).toBe(
      "words",
    );
    expect(textOf(result)).toContain("ranked by words only");
  });

  it("ничего не нашлось — понятный текст без картинки", async () => {
    const s = mcpSetup();
    const result = await s.call("search_icons", {
      query: "house",
      sets: ["demo"],
      style: "color",
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^No icons found for "house"/);
    expect(result.content.map((c) => c.type)).toEqual(["text"]);
  });

  it("лимит частоты — ошибка инструмента с подсказкой; счёт — по адресу человека", async () => {
    const limiter = fakeLimiter(0);
    const s = mcpSetup({ limiter });
    const result = await s.call("search_icons", { query: "house" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/at most 60 per minute/);
    expect(textOf(result)).toMatch(/Wait about a minute/);
    expect(textOf(result)).toMatch(/rate_limited/);
    expect([...limiter.counts.keys()]).toEqual(["203.0.113.7"]);
  });

  it("Meilisearch недоступен — ошибка «поиск недоступен», без адреса сервиса", async () => {
    const s = mcpSetup({ meiliStatus: 500 });
    const result = await s.call("search_icons", { query: "house" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/search_unavailable/);
    expect(textOf(result)).not.toContain("meilisearch.io");
  });

  it("неизвестный набор — подсказка про list_sets; неверный вход — ошибка схемы", async () => {
    const s = mcpSetup();
    const unknown = await s.call("search_icons", {
      query: "house",
      sets: ["nope"],
    });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toMatch(/Icon set "nope" not found/);
    expect(textOf(unknown)).toMatch(/list_sets/);
    const empty = await s.call("search_icons", { query: "" });
    expect(empty.isError).toBe(true);
    const big = await s.call("search_icons", { query: "house", limit: 25 });
    expect(big.isError).toBe(true);
  });
});

describe("MCP: HTTP", () => {
  it("/ — страница для людей с меткой сборки; HEAD без тела; другой метод — 405", async () => {
    const s = mcpSetup();
    const home = await s.request("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(home.headers.get("x-iconavo-build")).toBe("test");
    expect(await home.text()).toContain("https://mcp.iconavo.dev/mcp");
    const head = await s.request("/", { method: "HEAD" });
    expect(await head.text()).toBe("");
    expect((await s.request("/", { method: "POST" })).status).toBe(405);
  });

  it("robots.txt закрывает всё; чужой адрес — 404", async () => {
    const s = mcpSetup();
    expect(await (await s.request("/robots.txt")).text()).toBe(
      "User-agent: *\nDisallow: /\n",
    );
    expect((await s.request("/sse")).status).toBe(404);
  });

  it("OPTIONS /mcp — CORS для клиентов в браузере", async () => {
    const s = mcpSetup();
    const res = await s.request("/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("GET /mcp — 405: сервер без состояния, потока событий нет", async () => {
    const s = mcpSetup();
    const res = await s.request("/mcp", {
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });

  it("пачка сообщений — 400, тело больше 64 КБ — 413", async () => {
    const s = mcpSetup();
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const batch = await s.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
    });
    expect(batch.status).toBe(400);
    expect(await batch.json()).toMatchObject({ error: { code: -32600 } });
    const big = await s.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_icons",
          arguments: { query: "x".repeat(70_000) },
        },
      }),
    });
    expect(big.status).toBe(413);
  });
});
