import { describe, expect, it } from "vitest";
import { slug, slugger } from "./slug";

// Якоря, которые строит сам GitHub для заголовков README (проверено по его HTML 29 октября 2026).
describe("якоря как у GitHub", () => {
  it.each([
    ["configure(options)", "configureoptions"],
    ["setLoader(prefix, loader)", "setloaderprefix-loader"],
    ["IconavoProvider (React)", "iconavoprovider-react"],
    ["Next.js and server rendering", "nextjs-and-server-rendering"],
    ["Hosts, privacy and security", "hosts-privacy-and-security"],
    ["Icon data: /{set}.json?icons=a,b", "icon-data-setjsoniconsab"],
    ["SVG: /{set}/{icon}.svg", "svg-seticonsvg"],
    ["CSS: /{set}.css?icons=a,b", "css-setcssiconsab"],
    ["Search: /search?query=…", "search-searchquery"],
    ["What your own host must serve", "what-your-own-host-must-serve"],
  ])("%j → %s", (text, anchor) => {
    expect(slug(text)).toBe(anchor);
  });

  it("повтор в документе — с -1 и -2", () => {
    const next = slugger();
    expect([next("HTML"), next("HTML"), next("HTML"), next("React")]).toEqual([
      "html",
      "html-1",
      "html-2",
      "react",
    ]);
  });
});
