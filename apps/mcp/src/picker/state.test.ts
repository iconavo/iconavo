import { type PickerPayload, pickerPayload } from "@iconavo-ui/snippets/picker";
import { describe, expect, it } from "vitest";
import {
  initialState,
  moveTo,
  selectCard,
  setColor,
  setFormat,
  setStroke,
  withPayload,
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
  it("до ответа — ожидание и HTML; ответ: без выбора, формат и цвет от ассистента — начальные", () => {
    const waiting = initialState();
    expect(waiting).toMatchObject({ status: "waiting", format: "html" });
    const ready = withPayload(waiting, payload());
    expect(ready).toMatchObject({
      status: "ready",
      format: "html",
      delivery: "idle",
    });
    expect(ready.selected).toBeUndefined();
    expect(ready.stroke).toBeUndefined();
    expect(
      withPayload(waiting, payload({ format: "react", color: "#E11D48" })),
    ).toMatchObject({ format: "react", color: "#e11d48" });
    expect(withPayload(waiting, payload({ cards: [] })).status).toBe("empty");
  });

  it("выбор — только карточки из ответа; формат, цвет и толщина выбор не снимают", () => {
    const ready = withPayload(initialState(), payload());
    const picked = selectCard(ready, 2);
    expect(picked.selected).toBe(2);
    expect(selectCard(picked, 7)).toBe(picked);
    const look = setStroke(setColor(setFormat(picked, "css"), "#000000"), 1.5);
    expect(look).toMatchObject({
      selected: 2,
      format: "css",
      color: "#000000",
      stroke: 1.5,
    });
    expect(setStroke(look, undefined).stroke).toBeUndefined();
    expect(setColor(look, undefined).color).toBeUndefined();
  });

  it("после отправки любое изменение снова разрешает Select", () => {
    const sent = {
      ...selectCard(withPayload(initialState(), payload()), 1),
      delivery: "sent" as const,
    };
    expect(setColor(sent, "#000000").delivery).toBe("idle");
    expect(setStroke(sent, 1).delivery).toBe("idle");
    expect(setFormat(sent, "svg").delivery).toBe("idle");
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
