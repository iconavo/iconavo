import { type PickerPayload, pickerPayload } from "@iconavo-ui/snippets/picker";
import { describe, expect, it } from "vitest";
import {
  initialState,
  moveTo,
  selectCard,
  setColor,
  setStyle,
  withPayload,
  withQuery,
} from "./state.js";

const ICON = { body: "<path/>", left: 0, top: 0, width: 24, height: 24 };

function payload(over: Partial<PickerPayload> = {}): PickerPayload {
  return {
    ...pickerPayload({
      query: "house",
      api: "https://api.example",
      site: "https://site.example",
      format: "html",
      size: 24,
      cards: [
        {
          n: 1,
          icon: "demo:a",
          style: "outline",
          styles: { outline: "demo:a", filled: "demo:a-fill" },
        },
        {
          n: 2,
          icon: "demo:b",
          style: "outline",
          styles: { outline: "demo:b" },
        },
      ],
      icons: new Map([
        ["demo:a", ICON],
        ["demo:a-fill", ICON],
        ["demo:b", ICON],
      ]),
      sets: [
        {
          prefix: "demo",
          name: "Demo",
          author: { name: "A" },
          license: { title: "MIT", spdx: "MIT" },
          palette: false,
        },
      ],
      install: {
        script: "",
        tag: { package: "t", import: "i" },
        react: { package: "r", import: "i" },
      },
    }),
    ...over,
  };
}

describe("состояние сетки", () => {
  it("запрос до ответа, затем ответ: «Любой», без выбора; стиль и цвет от ассистента — начальные", () => {
    const waiting = withQuery(initialState(), "house");
    expect(waiting).toMatchObject({ status: "waiting", query: "house" });
    const ready = withPayload(waiting, payload());
    expect(ready).toMatchObject({
      status: "ready",
      style: "any",
      delivery: "idle",
    });
    expect(ready.selected).toBeUndefined();
    expect(
      withPayload(waiting, payload({ style: "filled", color: "#E11D48" })),
    ).toMatchObject({ style: "filled", color: "#e11d48" });
    expect(withPayload(waiting, payload({ cards: [] })).status).toBe("empty");
  });

  it("выбор только доступной карточки; другой стиль снимает выбор карточки без него", () => {
    const ready = withPayload(initialState(), payload());
    const picked = selectCard(ready, 2);
    expect(picked.selected).toBe(2);
    const filled = setStyle(picked, "filled");
    expect(filled.selected).toBeUndefined();
    expect(selectCard(filled, 2)).toBe(filled);
    expect(selectCard(selectCard(filled, 1), 1).selected).toBe(1);
    expect(setStyle(selectCard(ready, 1), "filled").selected).toBe(1);
  });

  it("после отправки любое изменение снова разрешает «Выбрать»", () => {
    const sent = {
      ...selectCard(withPayload(initialState(), payload()), 1),
      delivery: "sent" as const,
    };
    expect(setColor(sent, "#000000").delivery).toBe("idle");
    expect(
      setColor(setColor(sent, "#000000"), undefined).color,
    ).toBeUndefined();
    expect(setStyle(sent, "outline").delivery).toBe("idle");
    expect(selectCard(sent, 2).delivery).toBe("idle");
  });

  it("стрелки: соседи, ряд через cols, Home и End; недоступные пропускаются, за край — никуда", () => {
    const cells = [1, 2, 3, 4, 5, 6].map((n) => ({ n, available: n !== 2 }));
    expect(moveTo(cells, 1, "ArrowRight", 3)).toBe(3);
    expect(moveTo(cells, 3, "ArrowLeft", 3)).toBe(1);
    expect(moveTo(cells, 1, "ArrowLeft", 3)).toBeUndefined();
    expect(moveTo(cells, 1, "ArrowDown", 3)).toBe(4);
    expect(moveTo(cells, 5, "ArrowUp", 3)).toBeUndefined();
    expect(moveTo(cells, 6, "ArrowUp", 3)).toBe(3);
    expect(moveTo(cells, 4, "Home", 3)).toBe(1);
    expect(moveTo(cells, 1, "End", 3)).toBe(6);
    expect(moveTo(cells, 1, "Enter", 3)).toBeUndefined();
  });
});
