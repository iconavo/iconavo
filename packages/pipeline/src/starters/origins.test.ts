import { describe, expect, it } from "vitest";
import { hostMap, isOurHost, LIVE_ORIGINS, mapUrl } from "./origins.js";

describe("живые хосты → превью", () => {
  const map = hostMap("http://127.0.0.1:5000");

  it("API — на превью, статика — на его /_static/", () => {
    expect(mapUrl("https://api.iconavo.dev/lucide.json?icons=heart", map)).toBe(
      "http://127.0.0.1:5000/lucide.json?icons=heart",
    );
    for (const origin of LIVE_ORIGINS.slice(1)) {
      expect(mapUrl(`${origin}/manifest.json`, map)).toBe(
        "http://127.0.0.1:5000/_static/manifest.json",
      );
    }
  });

  it("наш хост без пары — null, чужой — undefined", () => {
    expect(mapUrl("https://mcp.iconavo.dev/x", map)).toBeNull();
    expect(mapUrl("https://iconavo.dev/docs", map)).toBeNull();
    expect(mapUrl("https://registry.npmjs.org/next", map)).toBeUndefined();
    expect(isOurHost("evil-iconavo.dev")).toBe(false);
  });
});
