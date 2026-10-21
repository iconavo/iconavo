import { describe, expect, it } from "vitest";
import { svgOf, widthEm } from "./svg.js";

describe("widthEm", () => {
  it("пропорция вверх до сотых, как у Iconify", () => {
    expect(widthEm(24, 24)).toBe("1em");
    expect(widthEm(32, 33)).toBe("0.97em");
    expect(widthEm(48, 24)).toBe("2em");
    expect(widthEm(11, 10)).toBe("1.1em");
    expect(widthEm(1, 3)).toBe("0.34em");
  });
});

describe("svgOf", () => {
  it("высота 1em, ширина по пропорции, viewBox из размеров", () => {
    expect(
      svgOf({
        body: '<path d="M0 0h24v24H0z"/>',
        width: 24,
        height: 24,
        left: 0,
        top: 0,
      }),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    );
  });

  it("left и top попадают в viewBox", () => {
    expect(
      svgOf({ body: "<g/>", width: 32, height: 33, left: -1, top: 0.5 }),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0.97em" height="1em" viewBox="-1 0.5 32 33"><g/></svg>',
    );
  });
});
