import { addIcons } from "@iconavo-ui/react";
import { describe, expect, it } from "vitest";
import { knownIconData } from "./icon-data";

const PAGE = [
  {
    prefix: "demo",
    width: 24,
    height: 24,
    icons: {
      house: { body: '<path d="M3 10l9-7 9 7v10H3z"/>' },
      broken: { body: 5 as unknown as string },
    },
    aliases: { home: { parent: "house" }, lost: { parent: "nowhere" } },
  },
];

describe("рисунок иконки, который уже есть в браузере", () => {
  it("иконка страницы — сразу, с размерами набора", () => {
    const icon = knownIconData("demo:house", PAGE);
    expect(icon?.body).toBe('<path d="M3 10l9-7 9 7v10H3z"/>');
    expect(icon?.width).toBe(24);
  });

  it("старое имя (алиас) — рисунок основной иконки", () => {
    expect(knownIconData("demo:home", PAGE)?.body).toBe(
      knownIconData("demo:house", PAGE)?.body,
    );
  });

  it("нет ни в иконках страницы, ни в ядре — undefined: рисунок спросит ядро", () => {
    expect(knownIconData("demo:star", PAGE)).toBeUndefined();
    expect(knownIconData("other:house", PAGE)).toBeUndefined();
    expect(knownIconData("demo:house", [])).toBeUndefined();
  });

  it("сломанные данные страницы — не ошибка, а «нет в них»", () => {
    expect(knownIconData("demo:lost", PAGE)).toBeUndefined();
    expect(knownIconData("demo:broken", PAGE)).toBeUndefined();
  });

  it("иконка, которую сетка загрузила через ядро, — из его хранилища", () => {
    addIcons({
      prefix: "demo-core",
      icons: {
        star: { body: '<path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/>' },
      },
    });
    expect(knownIconData("demo-core:star", [])?.body).toContain("M12 2l3 7");
  });
});
